#!/usr/bin/env python3
"""Classify git commits using llama-server, driven by a YAML profile."""

import subprocess
import csv
import hashlib
import json
import os
import re
import sys
import time
import argparse
import fnmatch
import yaml
import requests
from pathlib import Path

DEFAULT_LLAMA_URL = "http://localhost:8001/v1/chat/completions"

MAX_BODY_CHARS = 500
MAX_STAT_CHARS = 4000
CACHE_SAVE_INTERVAL_SECONDS = 120

def load_profile(path: str) -> dict:
    with open(Path(path).expanduser(), "r") as f:
        profile = yaml.safe_load(f)
    for key in ("repository", "categories", "prompt", "fallback"):
        if key not in profile:
            raise ValueError(f"Profile missing required key: '{key}'")
    repo = profile["repository"]
    if not isinstance(repo, dict) or "url" not in repo or "branch" not in repo:
        raise ValueError("Profile 'repository' must be an object with 'url' and 'branch' keys")
    profile.setdefault("shortcuts", {})
    profile.setdefault("shortcuts_ignore", [])
    if profile["fallback"] not in profile["categories"]:
        raise ValueError(f"Profile 'fallback' ({profile['fallback']!r}) is not in 'categories'")
    return profile


def ensure_repo(profile_path: str, profile: dict) -> str:
    """Clone or update the repository defined in the profile. Returns the local path."""
    p = Path(profile_path)
    local_path = p.parent / (p.stem + ".git")
    url = profile["repository"]["url"]
    branch = profile["repository"]["branch"]

    if not local_path.exists():
        print(f"Cloning {url} (branch {branch}) into {local_path} ...", file=sys.stderr)
        subprocess.run(
            ["git", "clone", "--branch", branch, url, str(local_path)],
            check=True,
        )
    else:
        print(f"Fetching latest commits for {local_path} (branch {branch}) ...", file=sys.stderr)
        subprocess.run(["git", "fetch", "origin"], cwd=str(local_path), check=True)
        subprocess.run(
            ["git", "reset", "--hard", f"origin/{branch}"],
            cwd=str(local_path),
            check=True,
        )

    return str(local_path)


def profile_fingerprint(profile: dict) -> str:
    """Short hash of fields that affect classification verdicts. Used to detect
    when a cache was computed against a different version of the profile."""
    payload = json.dumps({
        "categories": profile["categories"],
        "prompt": profile["prompt"],
        "shortcuts": profile["shortcuts"],
        "shortcuts_ignore": profile["shortcuts_ignore"],
        "fallback": profile["fallback"],
    }, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


COMMIT_SEP = "<<<COMMIT_END>>>"
FIELD_SEP = "<<<FIELD_SEP>>>"


def get_commits(
    repo_path: str,
    count: int | None,
    skip: int = 0,
    start: str | None = None,
    end: str | None = None,
) -> list[dict]:
    fmt = f"%H{FIELD_SEP}%ae{FIELD_SEP}%an{FIELD_SEP}%ct{FIELD_SEP}%s{FIELD_SEP}%b{COMMIT_SEP}"
    args = ["git", "log", "--no-merges", f"--skip={skip}"]
    if count is not None:
        args.append(f"-{count}")
    args.append(f"--format={fmt}")
    if start and end:
        args.append(f"{start}^..{end}")
    elif start:
        args.append(f"{start}^..HEAD")
    elif end:
        args.append(end)
    result = subprocess.run(
        args,
        cwd=repo_path,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    )
    commits = []
    for entry in result.stdout.split(COMMIT_SEP):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split(FIELD_SEP, 5)
        if len(parts) < 5:
            continue
        commit_hash = parts[0].strip()
        contributor_email = parts[1].strip()
        contributor_name = parts[2].strip()
        timestamp = parts[3].strip()
        subject = parts[4].strip()
        body = parts[5].strip() if len(parts) > 5 else ""
        if commit_hash and subject:
            commits.append({
                "hash": commit_hash,
                "contributor_email": contributor_email,
                "contributor_name": contributor_name,
                "timestamp": timestamp,
                "subject": subject,
                "body": body,
            })
    return commits


def get_changed_files(repo_path: str, commit_hash: str) -> list[str]:
    result = subprocess.run(
        ["git", "show", "--name-only", "--format=", commit_hash],
        cwd=repo_path,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    )
    return [l.strip() for l in result.stdout.splitlines() if l.strip()]


def check_shortcuts(files: list[str], shortcuts: dict[str, str], ignore: list[str] | None = None) -> str | None:
    # fnmatch uses shell-glob semantics where '*' also matches '/', so a pattern
    # like 'docs/*' already matches files in nested subdirectories — '**' has no
    # special meaning here.
    if not files or not shortcuts:
        return None
    if ignore:
        files = [f for f in files if not any(fnmatch.fnmatch(f, p) for p in ignore)]
    if not files:
        return None
    for pattern, category in shortcuts.items():
        if all(fnmatch.fnmatch(f, pattern) for f in files):
            return category
    return None


def get_stat(repo_path: str, commit_hash: str) -> str:
    result = subprocess.run(
        ["git", "show", "--stat", "--format=", commit_hash],
        cwd=repo_path,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    )
    return result.stdout.strip()


def classify_commit(
    subject: str,
    body: str,
    categories: list[str],
    prompt_text: str,
    llama_url: str,
    stat: str = "",
) -> tuple[str | None, str]:
    """Returns (matched_category_or_None, raw_response). The caller substitutes
    a fallback (and warns) when no category matched."""
    message = f"Subject: {subject}"
    if body:
        body_truncated = body[:MAX_BODY_CHARS] + "\n[truncated]" if len(body) > MAX_BODY_CHARS else body
        message += f"\n\nBody:\n{body_truncated}"
    if stat:
        stat_truncated = stat[:MAX_STAT_CHARS] + "\n[truncated]" if len(stat) > MAX_STAT_CHARS else stat
        message += f"\n\nChanged files:\n{stat_truncated}"

    payload = {
        "messages": [
            {"role": "system", "content": prompt_text},
            {"role": "user", "content": message},
        ],
        "stream": False,
    }

    response = requests.post(llama_url, json=payload, timeout=60)
    response.raise_for_status()
    data = response.json()
    raw = data["choices"][0]["message"]["content"].strip()

    # strip thinking block (llama-server emits <think>...</think>, possibly with attributes)
    raw = re.sub(r"<think[^>]*>.*?</think>", "", raw, flags=re.DOTALL).strip()

    # the prompt asks for a single-line, bare category name — focus on the
    # last non-empty line so a stray preamble doesn't poison the match
    lines = [l.strip().lower() for l in raw.splitlines() if l.strip()]
    candidate = lines[-1] if lines else raw.lower()

    for cat in categories:
        if candidate == cat:
            return cat, raw
    for cat in categories:
        if candidate.startswith(cat):
            return cat, raw
    return None, raw


def cache_path(profile_path: str) -> Path:
    p = Path(profile_path)
    return p.parent / (p.stem + ".cache.json")


def load_cache(profile_path: str) -> dict:
    """Returns a dict of hash -> {category, fingerprint}. Errors with a
    pointer to migrate_cache.py if it finds an older cache format on disk."""
    p = cache_path(profile_path)
    if not p.exists():
        return {}
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise SystemExit(f"Cache at {p} has an unexpected shape (expected an object).")
    if "fingerprint" in data and "entries" in data:
        raise SystemExit(
            f"Cache at {p} uses the old {{fingerprint, entries}} format. "
            f"Run migrate_cache.py {p} to convert it."
        )
    for h, v in data.items():
        if not isinstance(v, dict) or "category" not in v or "fingerprint" not in v:
            raise SystemExit(
                f"Cache at {p} contains a legacy entry for {h}. "
                f"Run migrate_cache.py {p} to convert it."
            )
    return data


def save_cache(profile_path: str, entries: dict):
    p = cache_path(profile_path)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(entries, f, separators=(",", ":"))
    os.replace(tmp, p)


def main():
    parser = argparse.ArgumentParser(description="Classify git commits using llama-server")
    parser.add_argument("-n", "--count", type=int, default=None, help="Number of commits to classify (default: all)")
    parser.add_argument("--skip", type=int, default=0, help="Number of commits to skip (default: 0)")
    parser.add_argument("--start", metavar="HASH", help="Start at this commit hash (inclusive)")
    parser.add_argument("--end", metavar="HASH", help="End at this commit hash (inclusive)")
    parser.add_argument("--profile", metavar="FILE", required=True, help="Path to YAML profile file (repository, categories, prompt)")
    parser.add_argument("--output", metavar="FILE", default=None, help="Path to output CSV file (default: _contributions_<profile-stem>_git.csv)")
    parser.add_argument("--stat", action=argparse.BooleanOptionalAction, default=True, help="Include git --stat (changed files) for better accuracy (default: on)")
    parser.add_argument("--llama-url", default=DEFAULT_LLAMA_URL, help=f"llama-server chat completions URL (default: {DEFAULT_LLAMA_URL})")
    parser.add_argument("--debug", action="store_true", help="Print the raw LLM response for each classified commit")
    args = parser.parse_args()

    profile_stem = Path(args.profile).stem
    if args.output is None:
        args.output = f"_contributions_{profile_stem}_git.csv"

    profile = load_profile(args.profile)

    repo = ensure_repo(args.profile, profile)
    categories = profile["categories"]
    prompt_text = profile["prompt"]
    shortcuts = profile["shortcuts"]
    shortcuts_ignore = profile["shortcuts_ignore"]
    fallback = profile["fallback"]

    current_fp = profile_fingerprint(profile)
    cache = load_cache(args.profile)
    stale_total = sum(1 for v in cache.values() if v["fingerprint"] != current_fp)
    if stale_total:
        cp = cache_path(args.profile)
        print(f"[WARN] {stale_total} of {len(cache)} cache entries in {cp} have a stale fingerprint (current: {current_fp}); their verdicts will still be reused. Delete those entries to force re-classification.", file=sys.stderr)

    count_label = str(args.count) if args.count is not None else "all"
    print(f"Reading {count_label} commits from {repo}...", file=sys.stderr)
    commits = get_commits(repo, args.count, args.skip, args.start, args.end)

    cached_count = sum(1 for c in commits if c["hash"] in cache)
    new_count = len(commits) - cached_count
    stat_label = "stat=on" if args.stat else "stat=off"
    print(f"Got {len(commits)} commits: {cached_count} cached, {new_count} to classify ({stat_label}).", file=sys.stderr)

    CSV_FIELDS = ["contribution_id", "category", "contributor_email", "contributor_name", "timestamp", "target_id", "is_self_comment"]

    tmp_output = args.output + ".tmp"
    last_save = time.monotonic()

    try:
        with open(tmp_output, "w", newline="", encoding="utf-8") as out_f:
            out_writer = csv.DictWriter(out_f, fieldnames=CSV_FIELDS, lineterminator="\n")
            out_writer.writeheader()

            for i, commit in enumerate(commits, 1):
                h = commit["hash"]
                if h in cache:
                    category = cache[h]["category"]
                    via = "cache"
                else:
                    via = "shortcut"
                    category = None
                    if shortcuts:
                        files = get_changed_files(repo, h)
                        category = check_shortcuts(files, shortcuts, shortcuts_ignore)
                    if category is None:
                        via = "llm"
                        stat = get_stat(repo, h) if args.stat else ""
                        matched, raw = classify_commit(commit["subject"], commit["body"], categories, prompt_text, args.llama_url, stat)
                        if args.debug:
                            print(f"  [DEBUG] {h} LLM raw response:\n{raw}", file=sys.stderr)
                        if matched is None:
                            snippet = raw.replace("\n", " ")[:100]
                            print(f"  [WARN] {h}: LLM response matched no category ({snippet!r}); using fallback '{fallback}'", file=sys.stderr)
                            category = fallback
                        else:
                            category = matched
                    cache[h] = {"category": category, "fingerprint": current_fp}
                    if time.monotonic() - last_save >= CACHE_SAVE_INTERVAL_SECONDS:
                        save_cache(args.profile, cache)
                        last_save = time.monotonic()

                row = {
                    "contribution_id": f"commit-{profile_stem}-{h}",
                    "category": category,
                    "contributor_email": commit["contributor_email"],
                    "contributor_name": commit["contributor_name"],
                    "timestamp": commit["timestamp"],
                    "target_id": "",
                    "is_self_comment": "",
                }
                out_writer.writerow(row)

                print(f"  [{i:3}/{len(commits)}] {h} -> {category:20s} | via {via} | {commit['subject'][:60]}", file=sys.stderr)

        os.replace(tmp_output, args.output)
        print(f"Output → {args.output}", file=sys.stderr)
    finally:
        save_cache(args.profile, cache)


if __name__ == "__main__":
    main()
