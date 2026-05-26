#!/usr/bin/env python3
"""Append draft alias suggestions to contributor-aliases.txt; see that file's header for the workflow."""

import csv
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
RAW_DIR = SCRIPT_DIR / "raw"

_ANGLE_RE = re.compile(r"<([^>]+)>")
_SECTION_RE = re.compile(r"^\s*#\s*===\s+")

_KNOWN_SOURCES = {"git", "gitlab", "bugzilla", "handcrafted"}

# Matches gitlab.gnome.org noreply commit emails. Group 1 is the handle, with
# the optional leading "<numeric-id>-" stripped. Handle case is preserved.
_GITLAB_NOREPLY_RE = re.compile(
    r"^(?:\d+-)?([^@]+)@users\.noreply\.gitlab\.gnome\.org$",
    re.IGNORECASE,
)

# Non-decomposing Latin letters folded to a base form for collation, so e.g.
# "Øyvind" sorts under 'o' and "Kłoczko" under 'l' rather than after 'z'.
# NFKD handles the rest (accented vowels etc.); these have no decomposition.
_SORT_SPECIAL = str.maketrans({
    'ø': 'o', 'Ø': 'o', 'ł': 'l', 'Ł': 'l', 'đ': 'd', 'Đ': 'd',
    'æ': 'ae', 'Æ': 'ae', 'œ': 'oe', 'Œ': 'oe', 'ß': 'ss',
    'ı': 'i', 'ð': 'd', 'Ð': 'd', 'þ': 'th', 'Þ': 'th',
})


def alias_sort_key(line):
    """Collation key for an active-block line, keyed on its display name.

    Approximates locale collation deterministically: folds diacritics (NFKD +
    strip combining marks) and a few non-decomposing Latin letters, lowercases,
    and drops spaces/punctuation so the block reads alphabetically by name.
    Non-Latin scripts keep their codepoints and sort after Latin. Tie-breaks on
    the raw lowercased name so the order is stable across runs and machines.
    """
    i = line.find("<")
    name = (line[:i] if i != -1 else line).strip()
    folded = unicodedata.normalize("NFKD", name.translate(_SORT_SPECIAL))
    folded = "".join(c for c in folded if not unicodedata.combining(c)).lower()
    folded = "".join(c for c in folded if c.isalnum())
    return (folded, name.lower())


def normalize_name(s):
    """Loose name normalization for cross-source matching.

    NFKD-decomposes, strips combining marks (diacritics), lowercases, treats
    '-_.' as spaces, collapses whitespace. Two names that normalize to the
    same string are *probably* the same person — pair with a shared-identifier
    gate before auto-merging.
    """
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[-_.]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_name_aggressive(s):
    """Drops single-letter tokens (initials) on top of normalize_name().

    Bridges "Adam D Moss" ↔ "Adam Moss" and "J B Mayer" ↔ "Jean Baptiste
    Mayer". False-positive prone, so output should go to the low-confidence
    tier in the draft.
    """
    parts = [p for p in normalize_name(s).split(" ") if len(p) > 1]
    return " ".join(parts)


def discover_files(dir_path):
    """Return (filename, source_type) for every _contributions_*.csv in dir_path."""
    results = []
    for path in sorted(dir_path.glob("_contributions_*.csv")):
        inner = path.stem[len("_contributions_"):]
        _, _, source_part = inner.partition("_")
        source_type = source_part.split(".")[0]
        if source_type not in _KNOWN_SOURCES:
            continue
        results.append((path.name, source_type))
    return results


def _strip_name_annotation(content):
    """Strip the |observed-name suffix added by draft formatting."""
    pipe = content.find('|')
    return content[:pipe] if pipe != -1 else content


def _deobfuscate_id(content):
    """Undo [at] obfuscation used in the file to deter scrapers."""
    return content.replace('[at]', '@')


def _obfuscate_id(id_):
    """Replace @ with [at] in email IDs; leave @gitlab and #bugzilla IDs alone."""
    if id_.startswith('@') or id_.startswith('#'):
        return id_
    return id_.replace('@', '[at]')


def _parse_alias_line(line, by_id):
    """Parse one mailmap-syntax line into by_id (lower(id) → (name, key_id))."""
    brackets = list(_ANGLE_RE.finditer(line))
    if not brackets:
        return
    name = line[:brackets[0].start()].strip()
    if not name:
        return
    key_id = _deobfuscate_id(_strip_name_annotation(brackets[0].group(1).strip()).lower())
    for b in brackets:
        by_id[_deobfuscate_id(_strip_name_annotation(b.group(1).strip()).lower())] = (name, key_id)


def parse_aliases_file(path):
    """Read contributor-aliases.txt.

    Splits the file at the first "# === " section marker:
      - Before the marker is the *active section*: a leading comment block
        (the header) followed by one uncommented entry line per contributor.
      - From the marker on are the *draft sections*, regenerated every run.
        Uncommented lines here are suggestions the user accepted in place.

    Returns (header_text, active_entries, accepted_lines, by_id):
      header_text    — the active section's leading comment/blank block,
                       preserved verbatim and re-emitted at the top. Any blank
                       lines or stray comments between entries are dropped; the
                       entry block is rebuilt sorted.
      active_entries — the uncommented entry lines already in the active
                       section, verbatim (their |Name annotations are kept).
      accepted_lines — uncommented entries found *after* the first section
                       marker: drafts the user accepted. Cleaned of |Name
                       annotations so they read as plain mailmap syntax. These
                       are merged with active_entries and sorted on rewrite.
      by_id          — mailmap parsed from every uncommented line anywhere in
                       the file, so uncommenting inside a draft takes effect
                       immediately.
    """
    if not path.exists():
        return ("", [], [], {})
    header = []
    active_entries = []
    accepted_lines = []
    seen_section = False
    seen_entry = False
    by_id = {}
    with open(path) as f:
        for raw in f:
            stripped = raw.strip()
            if _SECTION_RE.match(stripped):
                seen_section = True
                continue
            is_entry = bool(stripped) and not stripped.startswith("#")
            if not seen_section:
                if is_entry:
                    seen_entry = True
                    _parse_alias_line(stripped, by_id)
                    active_entries.append(raw.rstrip("\n"))
                elif not seen_entry:
                    # Leading comment/blank block is the header.
                    header.append(raw.rstrip("\n"))
                # Blank lines and stray comments once entries have begun (old
                # "lifted from a draft" markers, visual gaps) are dropped — the
                # entry block is rebuilt from active_entries, sorted.
            elif is_entry:
                _parse_alias_line(stripped, by_id)
                accepted_lines.append(_clean_annotations(raw.rstrip("\n")))
    header_text = "\n".join(header)
    if header_text:
        header_text += "\n"
    return (header_text, active_entries, accepted_lines, by_id)


def _clean_annotations(line):
    """Remove |Name annotations from inside <...> tokens."""
    def repl(m):
        return "<" + _strip_name_annotation(m.group(1)).strip() + ">"
    return _ANGLE_RE.sub(repl, line)


def extract_auto_bindings(dir_path):
    """Build deterministic @handle ↔ email bindings from gitlab signals.

    Three signals contribute, all keyed by gitlab handle:
      1. gitlab CSVs: contributor_public_email column — the email the user
         explicitly published on their gitlab profile.
      2. git CSVs: commit emails matching <id>-<handle>@users.noreply.gitlab.gnome.org
         (or the older <handle>@... form). The local-part encodes the handle
         directly, so the binding is unambiguous.
      3. git CSVs: commit emails whose local-part exactly matches a known
         gitlab handle (e.g. "khaledhosny@eglug.org" ↔ "@khaledhosny"). Many
         contributors use their gitlab handle as the local part of their
         personal email. Gated by name agreement (normalize_name) between the
         commit author and at least one gitlab row for that handle, so a
         coincidental local-part collision doesn't merge two people.

    Per handle we collect every distinct email seen from any signal.
    Display name is taken from the gitlab CSV when available (the platform
    profile name is canonical), falling back to the git commit author name.

    Returns list of (display_name, sorted [emails], "@handle"), sorted by name.
    """
    by_handle = {}  # lower(handle) -> {"name", "emails": set, "handle"}
    # Names a handle has been observed under in gitlab — used to gate pass 3.
    gitlab_names_by_handle: dict[str, set] = defaultdict(set)

    # Pass 1: gitlab CSVs — public_email field + gitlab display name.
    for path in sorted(dir_path.glob("_contributions_*_gitlab.csv")):
        with open(path, newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                handle_at = row["contributor_id"]
                if not handle_at.startswith("@"):
                    continue
                handle = handle_at[1:]
                entry = by_handle.setdefault(
                    handle.lower(), {"name": row["contributor_name"], "emails": set(), "handle": handle}
                )
                if row["contributor_public_email"]:
                    entry["emails"].add(row["contributor_public_email"])
                n = normalize_name(row["contributor_name"])
                if n:
                    gitlab_names_by_handle[handle.lower()].add(n)

    # Pass 2: git CSVs — noreply commit emails.
    for path in sorted(dir_path.glob("_contributions_*_git.csv")):
        with open(path, newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                m = _GITLAB_NOREPLY_RE.match(row["contributor_email"])
                if not m:
                    continue
                handle = m.group(1)
                entry = by_handle.setdefault(
                    handle.lower(), {"name": row["contributor_name"], "emails": set(), "handle": handle}
                )
                entry["emails"].add(row["contributor_email"])

    # Pass 3: git commit emails whose local-part matches a known gitlab handle.
    for path in sorted(dir_path.glob("_contributions_*_git.csv")):
        with open(path, newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                email = row["contributor_email"]
                if "@" not in email:
                    continue
                local_lc = email.split("@", 1)[0].lower()
                gitlab_names = gitlab_names_by_handle.get(local_lc)
                if not gitlab_names:
                    continue
                # Same-person gate: commit author name must normalize to a
                # name we've also seen on the gitlab side for this handle.
                if normalize_name(row["contributor_name"]) not in gitlab_names:
                    continue
                # Handle case from pass 1 is canonical; entry already exists.
                by_handle[local_lc]["emails"].add(email)

    # Only emit handles that gained at least one email binding; a public_email
    # of "" with no noreply commits is just gitlab activity with no usable
    # cross-source bridge.
    result = []
    for entry in by_handle.values():
        if not entry["emails"]:
            continue
        display_name = entry["name"] or entry["handle"]
        result.append((display_name, sorted(entry["emails"]), f"@{entry['handle']}"))
    result.sort(key=lambda x: x[0].lower())
    return result


def canonicalize(name, email, by_id):
    return by_id.get(email.lower(), (name, email))


def normalize_id(email, source_type):
    """Convert raw CSV identifier to alias-file form.
    Bugzilla fetchers write '@Name'; alias convention uses '#Name'.
    """
    if source_type == "bugzilla" and email.startswith("@"):
        return "#" + email[1:]
    return email


def id_sort_key(id_):
    """Sort order for human readability in draft output: real email, @gitlab, #bugzilla, noreply."""
    if "noreply" in id_:
        return (3, id_)
    if id_.startswith("#"):
        return (2, id_)
    if id_.startswith("@"):
        return (1, id_)
    return (0, id_)


def _build_auto_candidate(display_name, emails, handle, by_id, id_names):
    """Turn one deterministic handle binding into a very-high candidate.

    Returns (display, sorted_canon_ids, canon_names) or None if all IDs already
    canonicalize to the same entry via by_id (i.e. the user has already
    promoted this binding to the active section).
    """
    raw_ids = list(emails) + [handle]
    canon_ids = set()
    canon_names: dict[str, set] = defaultdict(set)
    alias_name = None
    for rid in raw_ids:
        cname, cid = canonicalize(display_name, rid, by_id)
        canon_ids.add(cid)
        canon_names[cid] |= id_names.get(rid, set())
        if cname != display_name and alias_name is None:
            alias_name = cname
    if len(canon_ids) <= 1:
        return None
    display = alias_name or display_name
    return (display, sorted(canon_ids, key=id_sort_key), canon_names)


def _merge_into_very_high(very_high, *lower_tiers):
    """If a very-high entry shares any id with an entry in a lower tier, fold
    the lower entry's ids into the very-high entry and drop the lower entry.

    Lower tiers are mutated in place; the returned very_high list has the
    merged entries.
    """
    if not very_high:
        return very_high
    out = []
    for vh_display, vh_ids, vh_cnames in very_high:
        merged_ids = set(vh_ids)
        merged_cnames: dict[str, set] = defaultdict(set)
        for i, names in vh_cnames.items():
            merged_cnames[i] |= names
        for tier in lower_tiers:
            keep = []
            for entry in tier:
                _, ids, cnames = entry
                if merged_ids.intersection(ids):
                    merged_ids.update(ids)
                    for i, names in cnames.items():
                        merged_cnames[i] |= names
                else:
                    keep.append(entry)
            tier[:] = keep
        out.append((vh_display, sorted(merged_ids, key=id_sort_key), merged_cnames))
    return out


def _fmt_id(i, display, cnames):
    names = {n for n in cnames.get(i, set()) if n}
    obf = _obfuscate_id(i)
    if not names or names == {display}:
        return f"<{obf}>"
    return f"<{obf}|{'/'.join(sorted(names))}>"


_TIER_DESCRIPTIONS = {
    "very-high": "deterministic gitlab handle ↔ email binding (profile public_email, "
                 "<id>-<handle>@noreply commit, or commit local-part matching a known handle).",
    "high":      "same name across sources AND ≥1 identifier appears in ≥2 sources.",
    "medium":    "same name across sources (under loose normalization), no shared identifier.",
    "low":       "names match only after aggressive normalization (single-letter initials dropped).",
}


def _emit_section(f, label, entries):
    f.write(f"\n# === {label} ({len(entries)}) ===\n")
    desc = _TIER_DESCRIPTIONS.get(label)
    if desc:
        f.write(f"# {desc}\n")
    for display, ids, cnames in sorted(entries, key=lambda x: x[0].lower()):
        parts = [_fmt_id(i, display, cnames) for i in ids]
        f.write(f"# {display} " + " ".join(parts) + "\n")


def main():
    aliases_path = SCRIPT_DIR / "contributor-aliases.txt"
    header_text, active_entries, accepted_lines, by_id = parse_aliases_file(aliases_path)

    # Build raw[name][source_type] and id_names — shared by both detectors.
    # raw_name → source_type → set of raw identifiers (alias-file form).
    raw: dict[str, dict[str, set]] = defaultdict(lambda: defaultdict(set))
    # identifier → set of contributor_name strings observed across all rows.
    id_names: dict[str, set] = defaultdict(set)

    for fname, source_type in discover_files(RAW_DIR):
        path = RAW_DIR / fname
        if not path.exists():
            continue
        with open(path, newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Git CSVs use "contributor_email"; gitlab/bugzilla use "contributor_id".
                raw_id = row["contributor_email"] if source_type == "git" else row["contributor_id"]
                name = row["contributor_name"]
                if not name:
                    continue
                nid = normalize_id(raw_id, source_type)
                raw[name][source_type].add(nid)
                id_names[nid].add(name)
                # Treat the gitlab public_email as an extra known identifier
                # for this contributor name — same person, additional alias.
                if source_type == "gitlab" and row["contributor_public_email"]:
                    pub = row["contributor_public_email"]
                    raw[name][source_type].add(pub)
                    id_names[pub].add(name)

    # === very-high: deterministic gitlab handle bindings ===
    very_high = []
    for display_name, emails, handle in extract_auto_bindings(RAW_DIR):
        result = _build_auto_candidate(display_name, emails, handle, by_id, id_names)
        if result is not None:
            very_high.append(result)

    # === high / medium / low: same-name cross-source matcher ===
    basic_groups: dict[str, set] = defaultdict(set)
    agg_groups: dict[str, set] = defaultdict(set)
    for raw_name in raw:
        nm = normalize_name(raw_name)
        if nm:
            basic_groups[nm].add(raw_name)
        am = normalize_name_aggressive(raw_name)
        if am:
            agg_groups[am].add(raw_name)

    def _display_name(raw_names, fallback):
        """Pick the most informative raw casing as display.

        Tie-break order:
          1. more diacritics (the platform-canonical form usually has them)
          2. starts with uppercase (prefer "Bruno" over "bruno")
          3. more real spaces (prefer "Simon Budig" over "Simon.Budig")
          4. longer (more tokens / fuller name)
          5. alphabetical, for determinism
        """
        if not raw_names:
            return fallback
        return max(raw_names, key=lambda n: (
            sum(1 for c in n if ord(c) > 127),
            bool(n and n[0].isupper()),
            sum(1 for c in n if c == " "),
            len(n),
            n,
        ))

    def _process(raw_names):
        """Return one (display, sorted_ids, has_id_overlap, canon_names) for the group, or None.

        Combines all identifiers across the given raw_names and canonicalizes
        via by_id. A candidate is only produced when ≥2 distinct canonical IDs
        remain and they span ≥2 source types. has_id_overlap is True when a
        single canonical ID is contributed by ≥2 sources — the strongest
        cross-source signal.

        canon_names maps each canonical id to the set of contributor_name strings
        it was observed under across all source rows — used for draft annotations.

        canonicalize() returns the input name unchanged when no alias matches,
        so passing varying names from the group would split the same canonical
        ID into separate name buckets. Use one representative throughout, and
        only adopt an alias-supplied name (which IS authoritative) when one is
        offered for some ID in the group.
        """
        representative = _display_name(raw_names, next(iter(raw_names)))
        canon_srcs: dict[str, set] = defaultdict(set)
        canon_names: dict[str, set] = defaultdict(set)
        alias_names: list[str] = []
        for name in raw_names:
            for source_type, ids in raw[name].items():
                for rid in ids:
                    cname, cid = canonicalize(representative, rid, by_id)
                    canon_srcs[cid].add(source_type)
                    canon_names[cid] |= id_names.get(rid, set())
                    if cname != representative and cname not in raw_names:
                        alias_names.append(cname)
        if len(canon_srcs) <= 1:
            return None
        all_sources = set()
        for srcs in canon_srcs.values():
            all_sources |= srcs
        if len(all_sources) < 2:
            return None
        has_overlap = any(len(s) >= 2 for s in canon_srcs.values())
        display = alias_names[0] if alias_names else representative
        sorted_ids = sorted(canon_srcs.keys(), key=id_sort_key)
        return (display, sorted_ids, has_overlap, canon_names)

    high, medium, low = [], [], []

    for nm, names in basic_groups.items():
        result = _process(names)
        if result is None:
            continue
        display, ids, has_overlap, cnames = result
        is_specific = len(nm.split()) >= 2 or any(c.isdigit() for c in nm)
        if has_overlap and is_specific:
            high.append((display, ids, cnames))
        elif is_specific:
            medium.append((display, ids, cnames))
        elif has_overlap:
            # id overlap exists but the shared name is a bare first name (e.g.
            # "#bruno" dragged in because the email overlaps across sources).
            # The overlap doesn't involve the bare name itself, so cap at medium.
            medium.append((display, ids, cnames))
        else:
            # Bare first name, no id overlap — weakest signal, demote to low.
            low.append((display, ids, cnames))

    # Aggressive-only matches: emit when an aggressive group bridges ≥2 basic
    # groups (i.e. aggressive normalization established a link that basic
    # didn't). Dedup against existing high/medium/low by id-set equality.
    seen_id_sets = {frozenset(ids) for _, ids, _ in high} | {frozenset(ids) for _, ids, _ in medium} | {frozenset(ids) for _, ids, _ in low}
    for am, names in agg_groups.items():
        if len({normalize_name(n) for n in names}) <= 1:
            continue
        result = _process(names)
        if result is None:
            continue
        display, ids, _has, cnames = result
        key = frozenset(ids)
        if key in seen_id_sets:
            continue
        seen_id_sets.add(key)
        low.append((display, ids, cnames))

    # Merge: a very-high candidate that shares any id with a high/medium/low
    # candidate is really one person — fold the lower-tier ids into the
    # very-high entry and drop the lower one.
    very_high = _merge_into_very_high(very_high, high, medium, low)

    # Active block: existing entries plus any drafts the user accepted, merged,
    # de-duplicated, and sorted alphabetically so accepted suggestions land in
    # place instead of accumulating in separate "lifted" sections.
    block = []
    seen = set()
    for line in active_entries + accepted_lines:
        if line not in seen:
            seen.add(line)
            block.append(line)
    block.sort(key=alias_sort_key)

    # === write ===
    with open(aliases_path, "w") as f:
        f.write(header_text)
        for line in block:
            f.write(line + "\n")
        _emit_section(f, "very-high", very_high)
        _emit_section(f, "high", high)
        _emit_section(f, "medium", medium)
        _emit_section(f, "low", low)

    print(
        f"Wrote {len(very_high)} very-high + {len(high)} high + "
        f"{len(medium)} medium + {len(low)} low draft entries to {aliases_path}"
    )
    if accepted_lines:
        print(f"Merged {len(accepted_lines)} accepted draft line(s) into the sorted active block.")


if __name__ == "__main__":
    main()
