#!/usr/bin/env python3
"""Merge per-source "_contributions_"-prefixed contribution CSVs from raw/ into final contributions.csv
(which is what frontend reads)

Filters applied to triage rows (category == "triaging"):
- Drop rows with is_self_comment == "1"
- Keep earliest per (target_id, contributor_name)

Output schema:
  contribution_id, category, category_group, contributor_name, contributor_id, timestamp
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent

_KNOWN_SOURCES = {"git", "gitlab", "bugzilla", "handcrafted"}


def discover_files(dir_path):
    """Return (filename, source_type) for every _contributions_*.csv with a recognised source type."""
    results = []
    for path in sorted((dir_path / "raw").glob("_contributions_*.csv")):
        inner = path.stem[len("_contributions_"):]
        _, _, source_part = inner.partition("_")
        source_type = source_part.split(".")[0]
        if source_type in _KNOWN_SOURCES:
            results.append((path.name, source_type))
    return results


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", default=str(SCRIPT_DIR / "contributions.csv"), metavar="FILE")
    p.add_argument("--aliases", default=str(SCRIPT_DIR / "contributor-aliases.txt"), metavar="FILE",
                   help="file created by make_alias_draft.py used to canonicalize author names/emails/handles")
    p.add_argument("--groups", default=str(SCRIPT_DIR / "category_groups.json"), metavar="FILE",
                   help="JSON file containing category groups for the category_group column. "
                        "If not provided, category will be used as category_group.")
    return p.parse_args()


_ANGLE_RE = re.compile(r"<([^>]+)>")


def parse_groups(path):
    if not path.exists():
        return {}
    with open(path) as f:
        return json.load(f)


def _strip_name_annotation(content):
    """Strip the |observed-name suffix that make_alias_draft.py adds to draft
    entries for review readability."""
    pipe = content.find('|')
    return content[:pipe] if pipe != -1 else content


def _deobfuscate_id(content):
    """Undo [at] obfuscation used in contributor-aliases.txt to deter scrapers."""
    return content.replace('[at]', '@')


def _obfuscate_id(content):
    """Apply [at] obfuscation to deter scrapers in output files."""
    return content.replace('@', '[at]')


def parse_aliases(path):
    """Parse contributor-aliases.txt.

    Format: Name <id> [<id> ...]  — all IDs on a line belong to the same person.
    Lines whose first non-whitespace character is '#' are comments.

    Returns by_id: lower(id) → (name, key_id)
    where key_id is the first id on the line, used only as a stable per-person
    grouping key for disambiguation — it carries no canonical meaning.
    """
    by_id = {}
    if not path.exists():
        return by_id
    with open(path) as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            brackets = list(_ANGLE_RE.finditer(line))
            if not brackets:
                continue
            name = line[:brackets[0].start()].strip()
            if not name:
                continue
            key_id = _deobfuscate_id(_strip_name_annotation(brackets[0].group(1).strip()).lower())
            for b in brackets:
                by_id[_deobfuscate_id(_strip_name_annotation(b.group(1).strip()).lower())] = (name, key_id)
    return by_id


def canonicalize(name, email, by_id):
    """Return (person_name, person_key) for a contributor row.

    person_key is the same for all IDs belonging to one alias line, so rows
    from the same person share a key even when their emails/handles differ.
    """
    return by_id.get(email.lower(), (name, email))


def read_rows(name, source_type):
    """Yield each contribution row as a dict with normalized keys

    Raw CSV sources differ slightly so we do some mapping:
    - git uses 'contributor_email'
    - gitlab/bugzilla use 'contributor_id'
    - only gitlab carries 'contributor_public_email'. This
    """
    path = SCRIPT_DIR / "raw" / name
    id_column = "contributor_email" if source_type == "git" else "contributor_id"
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            yield {
                "contribution_id": row["contribution_id"],
                "category": row["category"],
                "contributor_id": row[id_column],
                "contributor_name": row["contributor_name"],
                "contributor_public_email": row["contributor_public_email"] if source_type == "gitlab" else "",
                "timestamp": row["timestamp"],
                "target_id": row["target_id"],
                "is_self_comment": row["is_self_comment"],
            }

def _filter_triaging_self_comments(rows):
    dropped_self = 0
    filtered_rows = []
    for row in rows:
        if row["is_self_comment"] == "1":
            dropped_self += 1
            continue
        filtered_rows.append(row)
    return dropped_self, filtered_rows

def _filter_triaging_earliest_only(rows):
    best = {}  # (target_id, contributor_name) -> (row, ts)
    dropped_non_earliest = 0
    filtered_rows = []
    for row in rows:
        target_id = row["target_id"]
        if not target_id:
            filtered_rows.append(row)
            continue
        try:
            ts = int(row["timestamp"])
        except ValueError:
            filtered_rows.append(row)
            continue
        key = (target_id, row["contributor_name"])
        existing = best.get(key)
        if existing is None:
            best[key] = (row, ts)
        elif ts < existing[1]:
            best[key] = (row, ts)
            dropped_non_earliest += 1
        else:
            dropped_non_earliest += 1
    filtered_rows.extend(r for r, _ in best.values())
    return dropped_non_earliest, filtered_rows

def main():
    args = parse_args()
    out_path = Path(args.out)

    non_triage = []
    triage = []
    for name, source_type in discover_files(SCRIPT_DIR):
        for row in read_rows(name, source_type):
            if row["category"] == "triaging":
                triage.append(row)
            else:
                non_triage.append(row)

    dropped_self, kept_triage = _filter_triaging_self_comments(triage)
    dropped_non_earliest, kept_triage = _filter_triaging_earliest_only(kept_triage)

    aliases_path = Path(args.aliases)
    by_id = parse_aliases(aliases_path)
    alias_entries = len(by_id)
    alias_individuals = len({key_id for _, key_id in by_id.values()})
    remapped = 0

    groups_path = Path(args.groups)
    groups = parse_groups(groups_path)

    all_rows = non_triage + kept_triage
    canon_rows = []
    for row in all_rows:
        raw_id = row["contributor_id"]
        name = row["contributor_name"]
        new_name, contributor_id = canonicalize(name, raw_id, by_id)
        # Fallback: if the primary id didn't resolve but the gitlab profile
        # carries a public_email we know, canonicalize via that instead.
        if (new_name, contributor_id) == (name, raw_id) and row["contributor_public_email"]:
            new_name, contributor_id = canonicalize(name, row["contributor_public_email"], by_id)
        if (new_name, contributor_id) != (name, raw_id):
            remapped += 1
        canon_rows.append((row, new_name, contributor_id))

    with open(out_path, "w", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["contribution_id", "category", "category_group", "contributor_name", "contributor_id", "timestamp"])
        for row, new_name, contributor_id in canon_rows:
            category = row["category"]
            category_group = groups.get(category, category)
            try:
                ts = int(row["timestamp"])
                # Truncate to noon UTC: day precision is enough for the viz, and
                # keeping exact times would unnecessarily expose when contributors
                # choose to spend their personal time on the project.
                ts = (ts // 86400) * 86400 + 43200
            except (ValueError, TypeError):
                ts = row["timestamp"]
            writer.writerow([row["contribution_id"], category, category_group, new_name, _obfuscate_id(contributor_id), ts])

    total_out = len(all_rows)
    print(f"Wrote {total_out} rows to {out_path}.", file=sys.stderr)
    print(f"  non-triage:     {len(non_triage)}", file=sys.stderr)
    print(f"  triage:         {len(kept_triage)}  "
          f"(in: {len(triage)}, dropped self: {dropped_self}, dropped non-earliest: {dropped_non_earliest})",
          file=sys.stderr)
    if aliases_path.exists():
        print(f"  aliases:        {aliases_path}  "
              f"({alias_entries} aliases across {alias_individuals} individuals, {remapped} rows remapped)", file=sys.stderr)
    else:
        print(f"  aliases:        {aliases_path} (not found, no remapping)", file=sys.stderr)
    print(f"  groups found:   {"Yes" if groups_path.exists() else "No"}", file=sys.stderr)


if __name__ == "__main__":
    main()
