#!/usr/bin/env python3
# Dependencies: pyyaml, requests (pip install pyyaml requests)

import argparse
import csv
import json
import os
import sys
import time
from collections import namedtuple
from datetime import datetime, timezone
from pathlib import Path

import requests
import yaml

HTTP_TIMEOUT_SECONDS = 60
HTTP_MAX_ATTEMPTS = 5
CACHE_SAVE_INTERVAL_SECONDS = 120
USER_CACHE_TTL_SECONDS = 30 * 24 * 3600

_SESSION = None


def http_session():
    global _SESSION
    if _SESSION is None:
        token = os.environ.get("GITLAB_TOKEN")
        if not token:
            print(
                "GITLAB_TOKEN env var required "
                + "(personal access token with 'read_api', 'read_user' and 'read_repository' scope)",
                file=sys.stderr,
            )
            sys.exit(1)
        _SESSION = requests.Session()
        _SESSION.headers["PRIVATE-TOKEN"] = token
        _SESSION.headers["User-Agent"] = "contributor-atlas/0.1"
    return _SESSION


def next_link(link_header):
    # RFC 5988: '<url>; rel="next", <url>; rel="last"'
    for part in link_header.split(","):
        segs = part.split(";")
        if len(segs) < 2:
            continue
        url = segs[0].strip()
        if not (url.startswith("<") and url.endswith(">")):
            continue
        url = url[1:-1]
        for s in segs[1:]:
            if s.strip() == 'rel="next"':
                return url
    return None


Kind = namedtuple("Kind", "api cache_key label sigil")
ISSUES = Kind("issues", "issues", "issue", "#")
MRS = Kind("merge_requests", "mrs", "MR", "!")


def parse_args():
    script_dir = Path(__file__).parent
    parser = argparse.ArgumentParser(
        description="Fetch GitLab issues and MRs into a profile cache, then write a filtered CSV."
    )
    parser.add_argument(
        "--profile",
        default=str(script_dir / "gimp" / "gimp.yaml"),
        metavar="FILE",
        help="Profile YAML with host, project, bug_labels, and exclude_users (default: gimp/gimp.yaml next to this script)",
    )
    parser.add_argument(
        "--out",
        metavar="FILE",
        default=None,
        help="Output CSV (default: _contributions_<profile-stem>_gitlab.csv in cwd)",
    )
    args = parser.parse_args()
    if args.out is None:
        args.out = f"_contributions_{Path(args.profile).stem}_gitlab.csv"
    return args


def load_profile(path):
    with open(path) as f:
        return yaml.safe_load(f)


def cache_path(profile_path):
    p = Path(profile_path)
    return p.parent / (p.stem + ".cache.json")


def load_cache(profile_path):
    p = cache_path(profile_path)
    if p.exists():
        with open(p) as f:
            return json.load(f)
    return {"issues": {}, "mrs": {}}


def save_cache(profile_path, data):
    p = cache_path(profile_path)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, p)


def maybe_save_cache(state, profile_path, cache):
    if time.monotonic() - state["last_save"] >= CACHE_SAVE_INTERVAL_SECONDS:
        save_cache(profile_path, cache)
        state["last_save"] = time.monotonic()


def users_cache_path():
    return Path(__file__).parent / "users.cache.json"


def load_users_cache():
    p = users_cache_path()
    if p.exists():
        with open(p) as f:
            return json.load(f)
    return {}


def save_users_cache(data):
    p = users_cache_path()
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, p)


def fetch_user(host, user_id):
    session = http_session()
    url = f"https://{host}/api/v4/users/{user_id}"
    for attempt in range(HTTP_MAX_ATTEMPTS):
        try:
            resp = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
        except requests.Timeout:
            if attempt == HTTP_MAX_ATTEMPTS - 1:
                print(f"\n  timeout fetching user {user_id}, giving up", file=sys.stderr)
                return None
            delay = 2**attempt
            print(
                f"\n  timeout fetching user {user_id}, retrying in {delay}s (attempt {attempt + 1}/{HTTP_MAX_ATTEMPTS})...",
                file=sys.stderr,
            )
            time.sleep(delay)
            continue
        except requests.RequestException as e:
            if attempt == HTTP_MAX_ATTEMPTS - 1:
                print(f"\n  request failed for user {user_id}: {e}", file=sys.stderr)
                return None
            time.sleep(2**attempt)
            continue
        if resp.status_code == 429 or resp.status_code >= 500:
            if attempt == HTTP_MAX_ATTEMPTS - 1:
                return None
            delay = int(resp.headers.get("Retry-After", 2**attempt))
            print(
                f"\n  HTTP {resp.status_code} for user {user_id}, retrying in {delay}s (attempt {attempt + 1}/{HTTP_MAX_ATTEMPTS})...",
                file=sys.stderr,
            )
            time.sleep(delay)
            continue
        break
    if resp.status_code != 200:
        return None
    return resp.json()


def collect_user_ids(cache):
    ids = set()
    for entry in cache["issues"].values():
        author = entry.get("data", {}).get("author")
        if author and "id" in author:
            ids.add(str(author["id"]))
        for note in entry.get("notes", []):
            author = note.get("author")
            if author and "id" in author:
                ids.add(str(author["id"]))
    for entry in cache["mrs"].values():
        author = entry.get("data", {}).get("author")
        if author and "id" in author:
            ids.add(str(author["id"]))
        for note in entry.get("notes", []):
            author = note.get("author")
            if author and "id" in author:
                ids.add(str(author["id"]))
    return ids


def needs_user_fetch(entry):
    if entry is None:
        return True
    age = datetime.now(timezone.utc).timestamp() - iso_to_seconds(entry["fetched_at"])
    return age >= USER_CACHE_TTL_SECONDS


def update_users_cache(cache, host, users_cache):
    host_users = users_cache.setdefault(host, {})
    all_ids = collect_user_ids(cache)
    to_fetch = [uid for uid in all_ids if needs_user_fetch(host_users.get(uid))]
    tty = sys.stderr.isatty()
    print(f"Fetching public email for {len(to_fetch)}/{len(all_ids)} user(s)...", file=sys.stderr)
    if not to_fetch:
        return
    for i, uid in enumerate(to_fetch, 1):
        if tty:
            print(f"  user {i}/{len(to_fetch)} (id={uid})...\033[K", end="\r", file=sys.stderr)
        elif i % 50 == 0 or i == len(to_fetch):
            print(f"  user {i}/{len(to_fetch)}", file=sys.stderr)
        user = fetch_user(host, uid)
        host_users[uid] = {
            "username": user.get("username", "") if user else "",
            "public_email": (user.get("public_email") or "") if user else "",
            "fetched_at": utc_now_iso(),
        }
    if to_fetch and tty:
        print(file=sys.stderr)


def get_public_email(users_cache, host, author):
    uid = str(author.get("id", ""))
    if not uid:
        return ""
    return users_cache.get(host, {}).get(uid, {}).get("public_email", "") or ""


def fetch_paged(host, path):
    session = http_session()
    url = f"https://{host}/api/v4/{path}"
    items = []
    while url:
        for attempt in range(HTTP_MAX_ATTEMPTS):
            try:
                resp = session.get(url, timeout=HTTP_TIMEOUT_SECONDS)
            except requests.RequestException as e:
                if attempt == HTTP_MAX_ATTEMPTS - 1:
                    print(f"GitLab request failed for {url}: {e}", file=sys.stderr)
                    sys.exit(1)
                time.sleep(2**attempt)
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt == HTTP_MAX_ATTEMPTS - 1:
                    print(
                        f"GitLab returned {resp.status_code} for {url}: {resp.text[:200]}",
                        file=sys.stderr,
                    )
                    sys.exit(1)
                # Retry-After is seconds (per GitLab docs); fall back to exponential backoff.
                delay = int(resp.headers.get("Retry-After", 2**attempt))
                time.sleep(delay)
                continue
            break
        if resp.status_code != 200:
            print(f"GitLab error {resp.status_code} for {url}: {resp.text[:200]}", file=sys.stderr)
            sys.exit(1)
        items.extend(resp.json())
        url = next_link(resp.headers.get("Link", ""))
    return items


def utc_now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_to_seconds(iso_str):
    return datetime.fromisoformat(iso_str.replace("Z", "+00:00")).timestamp()


def parse_ts(iso_str):
    return int(iso_to_seconds(iso_str))


def classify_issue(labels, bug_labels, bug_category, fallback_category):
    bug_set = {l.lower() for l in bug_labels}
    if any(l.lower() in bug_set for l in labels):
        return bug_category
    return fallback_category


def make_row(
    contribution_id, category, author, ts, public_email="", target_id="", is_self_comment=""
):
    return [
        contribution_id,
        category,
        f"@{author['username']}",
        author["name"],
        public_email,
        ts,
        target_id,
        is_self_comment,
    ]


def needs_notes_fetch(entry):
    """True if notes should be (re-)fetched: never fetched, or item updated since last fetch.

    Compares via float seconds to avoid sub-second/precision mismatches between
    GitLab's ISO timestamps (with microseconds) and our own (which may not have them).

    Note: `updated_at` comes from the list fetch above. If an item is mutated between
    the list fetch and the notes fetch in the same run, the cached `updated_at` will be
    older than reality and the next run will not notice. Acceptable best-effort behavior.
    """
    fetched_at = entry.get("notes_fetched_at")
    if fetched_at is None:
        return True
    updated_at = entry["data"].get("updated_at", "")
    if not updated_at:
        return False
    return iso_to_seconds(updated_at) > iso_to_seconds(fetched_at)


def fetch_updated_list(host, project, kind, since):
    """Fetch issues or merge_requests, incrementally if a `since` checkpoint exists.

    `since` is the max updated_at seen on the previous run (ISO8601 string), or None
    for a full backfill. `updated_after` is inclusive, so the previously-max item
    comes back on every subsequent run; we filter it out here so callers only see
    genuinely newer items.
    """
    qs = "per_page=100&order_by=updated_at&sort=asc"
    if since:
        qs += f"&updated_after={since}"
    items = fetch_paged(host, f"{project}/{kind}?{qs}")
    if since:
        items = [i for i in items if i.get("updated_at", "") > since]
    return items


def update_kind(cache, host, project, profile_path, kind, save_state):
    max_key = f"{kind.cache_key}_max_updated_at"
    since = cache.get(max_key)
    print(
        f"Fetching {kind.label} list{' since ' + since if since else ''}...",
        end=" ",
        flush=True,
        file=sys.stderr,
    )
    items = fetch_updated_list(host, project, kind.api, since)
    print(f"{len(items)} updated {kind.label}(s).", file=sys.stderr)
    for item in items:
        iid = str(item["iid"])
        entry = cache[kind.cache_key].setdefault(iid, {"notes": []})
        entry["data"] = item
    new_max = max((i["updated_at"] for i in items if i.get("updated_at")), default=None)
    if new_max:
        cache[max_key] = new_max

    # Entries in to_fetch are dict references into `cache` — the mutations below
    # update the cache in place. Don't switch to .copy() without also rewriting
    # the persistence path.
    to_fetch = [(iid, e) for iid, e in cache[kind.cache_key].items() if needs_notes_fetch(e)]
    tty = sys.stderr.isatty()
    print(
        f"Fetching notes for {len(to_fetch)}/{len(cache[kind.cache_key])} {kind.label}(s) with updates...",
        file=sys.stderr,
    )
    for i, (iid, entry) in enumerate(to_fetch, 1):
        if tty:
            print(
                f"  {kind.label} {i}/{len(to_fetch)} ({kind.sigil}{iid})...\033[K",
                end="\r",
                file=sys.stderr,
            )
        elif i % 100 == 0 or i == len(to_fetch):
            print(f"  {kind.label} {i}/{len(to_fetch)}", file=sys.stderr)
        entry["notes"] = fetch_paged(host, f"{project}/{kind.api}/{iid}/notes?per_page=100")
        entry["notes_fetched_at"] = utc_now_iso()
        maybe_save_cache(save_state, profile_path, cache)
    if to_fetch and tty:
        print(file=sys.stderr)


def update_cache(cache, host, project, profile_path, profile):
    save_state = {"last_save": time.monotonic()}
    update_kind(cache, host, project, profile_path, ISSUES, save_state)
    if not profile.get("skip_mrs", False):
        update_kind(cache, host, project, profile_path, MRS, save_state)


def write_output(cache, profile, args, users_cache):
    bug_labels = profile.get("bug_labels", [])
    bug_category = profile["bug_category"]
    fallback_category = profile["fallback_category"]
    closed_mr_category = profile["closed_mr_category"]
    exclude_users = set(profile.get("exclude_users", []))
    host = profile["host"]
    profile_stem = Path(args.profile).stem

    with open(args.out, "w", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(
            [
                "contribution_id",
                "category",
                "contributor_id",
                "contributor_name",
                "contributor_public_email",
                "timestamp",
                "target_id",
                "is_self_comment",
            ]
        )

        wrote = 0
        for iid, entry in cache["issues"].items():
            issue = entry["data"]
            if issue["author"]["username"] in exclude_users:
                continue
            ts = parse_ts(issue["created_at"])
            category = classify_issue(
                issue.get("labels", []), bug_labels, bug_category, fallback_category
            )
            email = get_public_email(users_cache, host, issue["author"])
            writer.writerow(
                make_row(
                    f"issue-{profile_stem}-{iid}-created", category, issue["author"], ts, email
                )
            )
            wrote += 1
        print(f"Wrote {wrote} issue row(s).", file=sys.stderr)

        wrote = 0
        for iid, entry in cache["issues"].items():
            issue = entry["data"]
            filer_username = issue["author"]["username"]
            target_id = f"issue-{profile_stem}-{iid}"
            for note in entry.get("notes", []):
                if note.get("system"):
                    continue
                if note["author"]["username"] in exclude_users:
                    continue
                ts = parse_ts(note["created_at"])
                is_self = "1" if note["author"]["username"] == filer_username else "0"
                email = get_public_email(users_cache, host, note["author"])
                writer.writerow(
                    make_row(
                        f"issue-{profile_stem}-{iid}-note-{note['id']}",
                        "triaging",
                        note["author"],
                        ts,
                        email,
                        target_id,
                        is_self,
                    )
                )
                wrote += 1
        print(f"Wrote {wrote} issue note row(s).", file=sys.stderr)

        wrote = 0
        for iid, entry in cache["mrs"].items():
            mr = entry["data"]
            filer_username = mr["author"]["username"]
            target_id = f"mr-{profile_stem}-{iid}"
            for note in entry.get("notes", []):
                if note.get("system"):
                    continue
                if note["author"]["username"] in exclude_users:
                    continue
                ts = parse_ts(note["created_at"])
                is_self = "1" if note["author"]["username"] == filer_username else "0"
                email = get_public_email(users_cache, host, note["author"])
                writer.writerow(
                    make_row(
                        f"mr-{profile_stem}-{iid}-note-{note['id']}",
                        "triaging",
                        note["author"],
                        ts,
                        email,
                        target_id,
                        is_self,
                    )
                )
                wrote += 1
        print(f"Wrote {wrote} MR note row(s).", file=sys.stderr)

        wrote = 0
        for iid, entry in cache["mrs"].items():
            mr = entry["data"]
            if mr.get("state") not in ("closed", "opened"):
                continue
            if mr["author"]["username"] in exclude_users:
                continue
            ts = parse_ts(mr["created_at"])
            email = get_public_email(users_cache, host, mr["author"])
            writer.writerow(
                make_row(
                    f"mr-{profile_stem}-{iid}-created", closed_mr_category, mr["author"], ts, email
                )
            )
            wrote += 1
        print(f"Wrote {wrote} open/closed-unmerged MR row(s).", file=sys.stderr)


def main():
    args = parse_args()
    profile = load_profile(args.profile)
    host = profile["host"]
    project = profile["project"]

    cache = load_cache(args.profile)
    try:
        update_cache(cache, host, project, args.profile, profile)
    finally:
        save_cache(args.profile, cache)

    users_cache = load_users_cache()
    try:
        update_users_cache(cache, host, users_cache)
    finally:
        save_users_cache(users_cache)

    write_output(cache, profile, args, users_cache)
    print(f"Output → {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
