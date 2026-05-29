#!/usr/bin/env python3
"""Append draft alias suggestions to contributor-aliases.txt; see that file's header for the workflow."""

import csv
import gzip
import hashlib
import os
import pickle
import re
import tempfile
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
RAW_DIR = SCRIPT_DIR / "raw"
NAME_DATASET_PKL = SCRIPT_DIR / "first_names.pkl.gz"
# Pinned to a main branch as the upstream repo has no tags
_NAME_DATASET_URL = "https://github.com/philipperemy/name-dataset/raw/refs/heads/master/names_dataset/v3/first_names.pkl.gz"
_NAME_DATASET_SHA256 = "a2076494420babe3a110f25d54c89bdacb94c60cf304d0e8cfec65504e3de449"

_ANGLE_RE = re.compile(r"<([^>]+)>")
_SECTION_RE = re.compile(r"^\s*#\s*===\s+")

# Timezone-and-year prefixes seemingly introduced by some automatic system,
# e.g. "PDT 1998 Adrian Likine <adrian@gimp.org>". The negative lookahead
# avoids eating into an immediately following <...> identifier in case someone
# actually uses a name like "PDT 2000".
_TZ_DATE_PREFIX_RE = re.compile(r"^[A-Z]+T (?:199\d|200\d) +(?!<)")

# Matches gitlab.gnome.org noreply commit emails. Group 1 is the handle, with
# the optional leading "<numeric-id>-" stripped. Handle case is preserved.
_GITLAB_NOREPLY_RE = re.compile(
    r"^(?:\d+-)?([^@]+)@users\.noreply\.gitlab\.gnome\.org$",
    re.IGNORECASE,
)

_KNOWN_SOURCES = {"git", "gitlab", "bugzilla", "handcrafted"}

# Non-decomposing Latin letters folded to a base form for collation, so e.g.
# "Øyvind" sorts under 'o'. NFKD handles the rest (accented vowels etc.)
_SORT_SPECIAL = str.maketrans(
    {
        "ø": "o",
        "Ø": "o",
        "ł": "l",
        "Ł": "l",
        "đ": "d",
        "Đ": "d",
        "æ": "ae",
        "Æ": "ae",
        "œ": "oe",
        "Œ": "oe",
        "ß": "ss",
        "ı": "i",
        "ð": "d",
        "Ð": "d",
        "þ": "th",
        "Þ": "th",
    }
)


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


def _strip_name_noise(s):
    """Strip a timezone-and-year prefix ("GMT 1999 Andy Thomas") and a '/suffix'
    annotation ("Olof S Kylander/GIMP").
    There could be false-positives like "AC/DC fan" but couldn't such cases in the
    dataset.
    """
    s = _TZ_DATE_PREFIX_RE.sub("", s)
    s = s.split("/", 1)[0]
    return s.strip()


def normalize_name(s):
    """Loose name normalization for cross-source matching.

    NFKD-decomposes, strips combining marks (diacritics), lowercases, treats
    '-_.' as spaces, collapses whitespace, strips, '<timezone abbreviation> YYYY'
    prefixes and '/suffix' suffixes.
    """
    if not s:
        return ""
    s = _strip_name_noise(s)
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[-_.]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_name_aggressive(s):
    """Drops single-letter tokens (initials) on top of normalize_name().

    Bridges "Adam D Moss" <> "Adam Moss" and "J B Mayer" <> "Jean Baptiste
    Mayer".
    """
    parts = [p for p in normalize_name(s).split(" ") if len(p) > 1]
    return " ".join(parts)


def discover_files(dir_path):
    """Return (filename, source_type) for every _contributions_*.csv in dir_path."""
    results = []
    for path in sorted(dir_path.glob("_contributions_*.csv")):
        inner = path.stem[len("_contributions_") :]
        _, _, source_part = inner.partition("_")
        source_type = source_part.split(".")[0]
        if source_type not in _KNOWN_SOURCES:
            continue
        results.append((path.name, source_type))
    return results


def _strip_name_annotation(content):
    """Strip the |observed-name suffix added by draft formatting."""
    pipe = content.find("|")
    return content[:pipe] if pipe != -1 else content


def _deobfuscate_id(content):
    """Undo [at] obfuscation used in the file to deter scrapers."""
    return content.replace("[at]", "@")


def _obfuscate_id(id_):
    """Replace @ with [at] in email IDs; leave @gitlab and #bugzilla IDs alone."""
    if id_.startswith("@") or id_.startswith("#"):
        return id_
    return id_.replace("@", "[at]")


def _parse_alias_line(line, by_id):
    """Parse one mailmap-syntax line into by_id (lower(id) → (name, key_id))."""
    brackets = list(_ANGLE_RE.finditer(line))
    if not brackets:
        return
    name = line[: brackets[0].start()].strip()
    if not name:
        return
    key_id = _deobfuscate_id(_strip_name_annotation(brackets[0].group(1).strip()).lower())
    for b in brackets:
        by_id[_deobfuscate_id(_strip_name_annotation(b.group(1).strip()).lower())] = (name, key_id)


def parse_aliases_file(path):
    """Read contributor-aliases.txt.

    Splits at the first "# === " marker: before is the active section (header
    comment block + uncommented entries); after are draft sections whose
    uncommented lines are accepted drafts.

    Returns (header_text, active_entries, accepted_lines, by_id).
    active_entries keeps |Name annotations; accepted_lines strips them.
    by_id maps lower(id) to (name, key_id) for every uncommented line.
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
                # Blank lines and stray comments once entries have begun are dropped.
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
    """Build @handle <=> email bindings from three gitlab signals (keyed by handle):
      1. gitlab CSVs: contributor_public_email field
         (email explicitly published by user on their gitlab profile).
      2. git CSVs: noreply commit emails (<id>-<handle>@users.noreply.gitlab.gnome.org).
      3. git CSVs: commit emails whose local-part exactly matches a known
         gitlab handle (e.g. "khaledhosny@eglug.org" <> "@khaledhosny"). Many
         contributors use their gitlab handle as the local part of their
         personal email. Gated by name agreement (normalize_name) between the
         commit author and at least one gitlab row for that handle, so a
         coincidental local-part collision doesn't merge two people.
    Display name is from gitlab profile if available, else git commit author.
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
                    handle.lower(),
                    {"name": row["contributor_name"], "emails": set(), "handle": handle},
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
                    handle.lower(),
                    {"name": row["contributor_name"], "emails": set(), "handle": handle},
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


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _download_name_dataset():
    """Fetch the dataset to NAME_DATASET_PKL, verifying its sha256.

    Downloads to a temp file in the same directory and atomically renames it
    into place only after the checksum matches, so an interrupted or tampered
    download never leaves a bad file at the cache path.
    """
    print(f"Downloading name dataset to {NAME_DATASET_PKL} ...")
    fd, tmp_name = tempfile.mkstemp(dir=SCRIPT_DIR, suffix=".tmp")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        urllib.request.urlretrieve(_NAME_DATASET_URL, tmp)
        digest = _sha256(tmp)
        if digest != _NAME_DATASET_SHA256:
            raise RuntimeError(
                f"name dataset checksum mismatch: expected {_NAME_DATASET_SHA256}, got {digest}"
            )
        os.replace(tmp, NAME_DATASET_PKL)
    finally:
        tmp.unlink(missing_ok=True)


def load_common_first_names():
    """Build a set of normalized first-name tokens from the name dataset.

    Downloads the dataset on first run and caches it at NAME_DATASET_PKL.
    Returns a frozenset of normalized tokens.
    """
    if not NAME_DATASET_PKL.exists() or _sha256(NAME_DATASET_PKL) != _NAME_DATASET_SHA256:
        _download_name_dataset()
    with gzip.open(NAME_DATASET_PKL, "rb") as f:
        data = pickle.load(f)
    names = set()
    for raw_name in data:
        for token in normalize_name(raw_name).split():
            # Drop single-letter tokens: many keys are "A Abdiel" form where the
            # leading initial is noise, not a given name.
            if len(token) > 1 and token.isalpha():
                names.add(token)
    return frozenset(names)


def is_common_first_name(normalized_name, common_names):
    return normalized_name in common_names


_TIER_DESCRIPTIONS = {
    "very-high": (
        "deterministic gitlab handle - email binding: "
        "profile public_email (e.g. @user has user@x.com on profile), "
        "noreply commit (e.g. 123-user@users.noreply.gitlab.gnome.org), "
        "or commit local-part = handle (e.g. user@domain.com for @user)."
    ),
    "high": (
        "same name across sources AND BOTH a specific name (multi-word or "
        "containing a digit, e.g. 'Jane Smith') AND >=1 identifier in >=2 "
        "sources (e.g. jane@x.com in both)."
    ),
    "medium": (
        "same name across sources AND "
        "(specific name (e.g. 'Jane Smith' with different emails per source) "
        "OR >=1 identifier in >=2 sources (e.g. 'Bruno' with same email in git and gitlab)), but not both."
    ),
    "low": (
        "NOT in common-names dataset AND "
        "(not-specific name AND 0 identifiers in >=2 sources (e.g. 'Xantiva' in git and gitlab with different IDs), "
        "OR match only under aggressive normalization (e.g. 'Adam D Moss' <=> 'Adam Moss'))."
    ),
    "very-low": (
        "in common-names dataset AND "
        "(not-specific name AND 0 identifiers in >=2 sources (e.g. 'Alex' in git and gitlab with different IDs), "
        "OR match only under aggressive normalization (e.g. 'J Alex' <=> 'Alex')) - high false-positive risk."
    ),
    "single-source": (
        "same name with >=2 distinct IDs all within ONE source (e.g. 'Andy "
        "Thomas' committing as both alt@gimp.org and alt@picnic.demon.co.uk) - "
        "no cross-source corroboration, so for gitlab and bugzilla these are likely false-positives. "
        "May be useful for mails."
    ),
}


def _emit_section(f, label, entries):
    f.write(f"\n# === {label} ({len(entries)}) ===\n")
    desc = _TIER_DESCRIPTIONS.get(label)
    if desc:
        f.write(f"# {desc}\n")
    for display, ids, cnames in sorted(entries, key=lambda x: x[0].lower()):
        parts = [_fmt_id(i, display, cnames) for i in ids]
        f.write(f"# {display} " + " ".join(parts) + "\n")


def _check_duplicate_names(active_entries):
    """Print a warning for any canonical name that appears on more than one active line."""
    name_to_lines: dict[str, list[str]] = defaultdict(list)
    for line in active_entries:
        i = line.find("<")
        name = (line[:i] if i != -1 else line).strip()
        if name:
            name_to_lines[name].append(line)
    dups = {name: lines for name, lines in name_to_lines.items() if len(lines) > 1}
    if dups:
        print(
            "WARNING: duplicate canonical names in the active block (merge them in contributor-aliases.txt):"
        )
        for name, lines in sorted(dups.items()):
            print(f"  {name}:")
            for line in lines:
                print(f"    {line}")


def main():
    aliases_path = SCRIPT_DIR / "contributor-aliases.txt"
    header_text, active_entries, accepted_lines, by_id = parse_aliases_file(aliases_path)

    _check_duplicate_names(active_entries)

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

        Candidates are first cleaned of the timezone-prefix/'/suffix' noise so a
        clean "Andy Thomas" is preferred over "GMT 1999 Andy Thomas".

        Tie-break order:
          1. more diacritics (the platform-canonical form usually has them)
          2. starts with uppercase (prefer "Bruno" over "bruno")
          3. more real spaces (prefer "Simon Budig" over "Simon.Budig")
          4. longer (more tokens / fuller name)
          5. alphabetical, for determinism
        """
        if not raw_names:
            return fallback
        candidates = {_strip_name_noise(n) or n for n in raw_names}
        return max(
            candidates,
            key=lambda n: (
                sum(1 for c in n if ord(c) > 127),
                bool(n and n[0].isupper()),
                sum(1 for c in n if c == " "),
                len(n),
                n,
            ),
        )

    def _process(raw_names):
        """Return (display, sorted_ids, has_id_overlap, canon_names, single_source) or None.

        single_source is True when they all come from one source type
        has_id_overlap is True when one ID appears in >= 2 sources
        canon_names maps each canonical id to observed contributor_name strings
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
        has_overlap = any(len(s) >= 2 for s in canon_srcs.values())
        single_source = len({s for srcs in canon_srcs.values() for s in srcs}) < 2
        display = alias_names[0] if alias_names else representative
        sorted_ids = sorted(canon_srcs.keys(), key=id_sort_key)
        return (display, sorted_ids, has_overlap, canon_names, single_source)

    common_names = load_common_first_names()
    high, medium, low, very_low, single_source = [], [], [], [], []

    for nm, names in basic_groups.items():
        result = _process(names)
        if result is None:
            continue
        display, ids, has_overlap, cnames, is_single_source = result
        if is_single_source:
            # All IDs from one source - no cross-source corroboration; keep
            # these out of the cross-source tiers.
            single_source.append((display, ids, cnames))
            continue
        is_specific = len(nm.split()) >= 2 or any(c.isdigit() for c in nm)
        if has_overlap and is_specific:
            high.append((display, ids, cnames))
        elif is_specific:
            medium.append((display, ids, cnames))
        elif has_overlap:
            # Bare first name with id overlap - overlap is via identifier, not
            # the name, so cap at medium rather than high.
            medium.append((display, ids, cnames))
        else:
            # Bare first name, no id overlap — weakest signal.
            if is_common_first_name(nm, common_names):
                very_low.append((display, ids, cnames))
            else:
                low.append((display, ids, cnames))

    # Aggressive-only matches: emit when an aggressive group bridges ≥2 basic
    # groups (i.e. aggressive normalization established a link that basic
    # didn't). Dedup against existing high/medium/low by id-set equality.
    seen_id_sets = (
        {frozenset(ids) for _, ids, _ in high}
        | {frozenset(ids) for _, ids, _ in medium}
        | {frozenset(ids) for _, ids, _ in low}
        | {frozenset(ids) for _, ids, _ in very_low}
        | {frozenset(ids) for _, ids, _ in single_source}
    )
    for am, names in agg_groups.items():
        if len({normalize_name(n) for n in names}) <= 1:
            continue
        result = _process(names)
        if result is None:
            continue
        display, ids, _has, cnames, is_single_source = result
        key = frozenset(ids)
        if key in seen_id_sets:
            continue
        seen_id_sets.add(key)
        if is_single_source:
            single_source.append((display, ids, cnames))
        elif is_common_first_name(am, common_names):
            very_low.append((display, ids, cnames))
        else:
            low.append((display, ids, cnames))

    # Merge: a very-high candidate that shares any id with a high/medium/low
    # candidate is really one person — fold the lower-tier ids into the
    # very-high entry and drop the lower one.
    very_high = _merge_into_very_high(very_high, high, medium, low, very_low, single_source)

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
        _emit_section(f, "very-low", very_low)
        _emit_section(f, "single-source", single_source)

    print(f"Wrote draft entires into {aliases_path}:")
    print(f"    very-high:     {len(very_high)}")
    print(f"    high:          {len(high)}")
    print(f"    medium:        {len(medium)}")
    print(f"    low:           {len(low)}")
    print(f"    very-low:      {len(very_low)}")
    print(f"    single-source: {len(single_source)}")
    if accepted_lines:
        print(f"Merged {len(accepted_lines)} accepted draft line(s) into the sorted active block.")


if __name__ == "__main__":
    main()
