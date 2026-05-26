#!/usr/bin/env python3
# Dependencies: beautifulsoup4 pyyaml (pip install beautifulsoup4 pyyaml)

import argparse
import csv
import multiprocessing
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml
from bs4 import BeautifulSoup

# Cloning via HTTPS doesn't work as it fails with HTTP 503: fatal: expected 'packfile'
# The problem seems to be the huuuge commit size. Cloning via SSH though, works.
#BUGZILLA_STATIC_URL = "https://gitlab.gnome.org/Infrastructure/bugzilla-static.git"
BUGZILLA_STATIC_URL = "git@ssh.gitlab.gnome.org:Infrastructure/bugzilla-static.git"
BUGZILLA_STATIC_BRANCH = "master"

# A handful of bugs have "Reported" values that pre-date even
# GNOME (e.g. 1980-01-04, 1982-02-04). Reject anything before this
# floor and fall back to the c0 timestamp. Not quite sure when a bugtracker
# was introduced but based on the dates it doesn't look like it was before 1999.
# From what I could find out: At first "Debian bug tracking system" was used then
# they migrated to Bugzilla
MIN_PLAUSIBLE_REPORTED_TS = int(datetime(1999, 1, 1, tzinfo=timezone.utc).timestamp())


def ensure_repo(script_dir: Path) -> Path:
    """Clone or update the bugzilla-static repo. Returns the local path."""
    local_path = script_dir / "bugzilla-static.git"
    if not local_path.exists():
        print(f"Cloning {BUGZILLA_STATIC_URL} (branch {BUGZILLA_STATIC_BRANCH}) into {local_path} ...", file=sys.stderr)
        subprocess.run(
            ["git", "clone", "--branch", BUGZILLA_STATIC_BRANCH, BUGZILLA_STATIC_URL, str(local_path)],
            check=True,
        )
    # No need to fetch origin if we already cloned it. This repo is frozen.
    return local_path


def parse_args():
    script_dir = Path(__file__).parent
    parser = argparse.ArgumentParser(
        description="Parse GNOME Bugzilla static HTML files and emit a contributions CSV"
    )
    parser.add_argument("--profile", default=str(script_dir / "gimp" / "gimp.yaml"), metavar="FILE")
    parser.add_argument("--workers", type=int, default=multiprocessing.cpu_count())
    parser.add_argument("--out", metavar="FILE", default=None, help="Output CSV (default: _contributions_<profile-stem>_bugzilla.csv)")
    return parser.parse_args()


def load_profile(path):
    with open(path) as f:
        return yaml.safe_load(f)


def parse_utc_timestamp(text):
    text = text.strip()
    # "2001-01-28 15:52:18 UTC" or "2000-10-12 10:30 UTC" (reported field, no seconds)
    for fmt in ("%Y-%m-%d %H:%M:%S UTC", "%Y-%m-%d %H:%M UTC"):
        try:
            dt = datetime.strptime(text, fmt)
            return int(dt.replace(tzinfo=timezone.utc).timestamp())
        except ValueError:
            pass
    raise ValueError(f"Unrecognised timestamp format: {text!r}")


def severity_to_category(td_text):
    if "enhancement" in td_text.lower():
        return "improvement-suggestion"
    return "bug-reporting"


def parse_bug_file(args):
    path, wanted_product_classes, profile_stem = args
    bug_id = path.name
    try:
        html = path.read_text(errors="replace")
    except OSError:
        return [], []

    # Fast product check before full parse. The body class is space-separated
    # tokens like "... bz_product_GIMP-manual ..." — match on tokens so that a
    # filter for "GIMP" does not also pull in "GIMP-manual".
    body_match = re.search(r'<body[^>]+class="([^"]+)"', html)
    if not body_match:
        return [], []
    if set(body_match.group(1).split()).isdisjoint(wanted_product_classes):
        return [], []

    soup = BeautifulSoup(html, "html.parser")

    # Severity → category, and "Reported" date for the bug filing row (c0).
    # Bugs filed before the 2001-01-27 Bugzilla migration have c0's
    # bz_comment_time reset to the migration date (~16k bugs, drifts up to
    # ~750 days). The "Reported" field preserves the true filing date.
    bug_category = "bug-reporting"
    reported_ts = None
    for th in soup.find_all("th", class_="field_label"):
        label = th.get_text()
        if "mportance" in label:
            td = th.find_next_sibling("td")
            if td:
                bug_category = severity_to_category(td.get_text())
        elif "eported" in label:
            td = th.find_next_sibling("td")
            if td:
                # "2000-10-12 10:30 UTC by Austin Donnelly" — grab just the date/time part
                m = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? UTC)", td.get_text(strip=True))
                if m:
                    candidate = parse_utc_timestamp(m.group(1))
                    if candidate >= MIN_PLAUSIBLE_REPORTED_TS:
                        reported_ts = candidate

    # First pass: extract (comment_num, contributor_name, ts) for every valid comment.
    comments = []
    for comment_div in soup.find_all("div", class_="bz_comment"):
        div_id = comment_div.get("id", "")
        m = re.match(r"c(\d+)$", div_id)
        if not m:
            continue
        comment_num = int(m.group(1))

        head = comment_div.find(class_=re.compile(r"bz_(first_)?comment_head"))
        if not head:
            continue

        user_span = head.find(class_="bz_comment_user")
        if not user_span:
            continue
        vcard = user_span.find(class_="vcard")
        contributor_name = (vcard or user_span).get_text(strip=True)
        if not contributor_name:
            continue
        if contributor_name == "GNOME Infrastructure Team":
            continue

        time_span = head.find(class_="bz_comment_time")
        if not time_span:
            continue
        try:
            ts = parse_utc_timestamp(time_span.get_text())
        except ValueError:
            continue

        comments.append((comment_num, contributor_name, ts))

    # Resolve filer (c0 author) before emitting rows, so is_self_comment is
    # correct regardless of the order comments appear in the document.
    filer_name = next((name for num, name, _ in comments if num == 0), None)

    issue_rows = []
    comment_rows = []
    for comment_num, contributor_name, ts in comments:
        # The only thing we have is the author name as there is no id/email
        # contained in the static page dump. So there is nothing we can do if
        # multiple users had the same name...
        contributor_id = f"#{re.sub(r"\s+", '-', contributor_name)}"

        if comment_num == 0:
            issue_rows.append([
                f"bugzilla-{profile_stem}-{bug_id}",
                bug_category,
                contributor_id,
                contributor_name,
                reported_ts if reported_ts is not None else ts,
                "",  # target_id
                "",  # is_self_comment
            ])
        else:
            is_self = "1" if (filer_name is not None and contributor_name == filer_name) else "0"
            comment_rows.append([
                f"bugzilla-{profile_stem}-{bug_id}-c{comment_num}",
                "triaging",
                contributor_id,
                contributor_name,
                ts,
                f"bugzilla-{profile_stem}-{bug_id}",
                is_self,
            ])

    return issue_rows, comment_rows


def main():
    args = parse_args()
    if args.out is None:
        args.out = f"_contributions_{Path(args.profile).stem}_bugzilla.csv"
    profile = load_profile(args.profile)
    product_filters = profile.get("products") or []
    if not product_filters:
        print("Profile must define a non-empty 'products' list.", file=sys.stderr)
        sys.exit(1)
    wanted_product_classes = frozenset(f"bz_product_{p}" for p in product_filters)

    repo = ensure_repo(Path(__file__).parent)
    bugs_dir = repo / "bugs"
    paths = sorted(bugs_dir.iterdir(), key=lambda p: int(p.name) if p.name.isdigit() else 0)
    total = len(paths)

    header = ["contribution_id", "category", "contributor_id", "contributor_name", "timestamp", "target_id", "is_self_comment"]

    with open(args.out, "w", newline="") as f_out:
        writer = csv.writer(f_out, lineterminator="\n")
        writer.writerow(header)

        done = 0
        matched_bugs = 0
        contributions = 0

        with multiprocessing.Pool(args.workers) as pool:
            profile_stem = Path(args.profile).stem
            work = ((p, wanted_product_classes, profile_stem) for p in paths)
            for issue_rows, comment_rows in pool.imap(parse_bug_file, work, chunksize=200):
                done += 1
                if issue_rows or comment_rows:
                    matched_bugs += 1
                    contributions += len(issue_rows) + len(comment_rows)
                    writer.writerows(issue_rows)
                    writer.writerows(comment_rows)

                if done % 1000 == 0 or done == total:
                    print(
                        f"\r{done}/{total} ({100*done/total:.1f}%) | "
                        f"matched bugs: {matched_bugs} | contributions: {contributions}   ",
                        end="",
                        file=sys.stderr,
                    )

    print(f"\n{Path(args.profile).stem}: Done. Output: {args.out}.", file=sys.stderr)


if __name__ == "__main__":
    main()
