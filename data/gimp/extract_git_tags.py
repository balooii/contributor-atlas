#!/usr/bin/env python3
"""Extract GIMP release tags from gimp.git into highlights.csv and sanitize"""

import argparse
import csv
import re
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent

DEFAULT_REPO = SCRIPT_DIR / ".." / ".." / "pipeline" / "git" / "gimp" / "gimp.git"

# GIMP_<num>_<num>[_<num>...] with an optional single RC/PRE candidate suffix.
RELEASE_RE = re.compile(r"^GIMP_(\d+(?:_\d+)+)(?:_((?:RC|PRE)\d+))?$")


def parse_args():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "--repo",
        default=str(DEFAULT_REPO),
        metavar="DIR",
        help="path to the gimp git repository (default: %(default)s)",
    )
    p.add_argument(
        "--out",
        default=str(SCRIPT_DIR / "highlights.csv"),
        metavar="FILE",
        help='output CSV, or "-" for stdout (default: %(default)s)',
    )
    return p.parse_args()


def read_tags(repo):
    out = subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "for-each-ref",
            "--format=%(refname:short)\t%(creatordate:short)",
            "refs/tags",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    tags = []
    for line in out.splitlines():
        if not line.strip():
            continue
        name, _, date = line.partition("\t")
        tags.append((name, date))
    return tags


def sanitize(tag):
    """GIMP_3_2_0 -> 'GIMP 3.2.0', GIMP_2_0_RC1 -> 'GIMP 2.0 RC1'"""
    m = RELEASE_RE.match(tag)
    version = m.group(1).replace("_", ".")
    name = f"GIMP {version}"
    if m.group(2):
        name += f" {m.group(2)}"
    return name


def main():
    args = parse_args()

    tags = read_tags(args.repo)

    rows = []
    max_len_tags = max(len(tag) for tag, _ in tags)
    for tag, date in sorted(tags):
        keep = RELEASE_RE.match(tag) is not None
        if keep:
            release = sanitize(tag)
            rows.append((release, date))
            print(f"  KEEP:  {tag:>{max_len_tags}s} -> {release:<20s} ({date})", file=sys.stderr)
        else:
            print(f"  SKIP:  {tag:>{max_len_tags}s}", file=sys.stderr)

    if args.out == "-":
        write_csv(sys.stdout, rows)
    else:
        with open(args.out, "w", newline="") as f:
            write_csv(f, rows)
        print(f"\nWritten to {args.out}")


def write_csv(f, rows):
    writer = csv.writer(f, lineterminator="\n")
    writer.writerow(["name", "timestamp"])
    writer.writerows(rows)


if __name__ == "__main__":
    main()
