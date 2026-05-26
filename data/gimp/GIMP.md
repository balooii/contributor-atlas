# Contributor Atlas — GIMP

> **Work in progress.** Data collection, alias resolution, and category coverage are all still being improved. Treat the visualizations as an evolving picture.

This document covers the GIMP-specific data pipeline: which repositories and trackers are included, how to regenerate the data, and how you can help improve contributor identity resolution.

---

## Included sources

Contributions are collected from the following sources:

| Sub-project           | git | GitLab | Bugzilla |
| --------------------- | :-: | :----: | :------: |
| gimp                  |  ✓  |   ✓    |    ✓     |
| babl                  |  ✓  |   ✓    |    —     |
| gegl                  |  ✓  |   ✓    |    ✓     |
| gimp-help             |  ✓  |   ✓    |    ✓     |
| gimp-help (pre-2002)  |  ✓  |   —    |    —     |
| gimp-web              |  ✓  |   ✓    |    ✓     |
| gimp-web-devel        |  ✓  |   ✓    |    —     |
| gimp-data             |  ✓  |   ✓    |    —     |
| gimp-data-extras      |  ✓  |   ✓    |    —     |
| gimp-extensions-web   |  ✓  |   ✓    |    —     |
| gimp-gap              |  ✓  |   ✓    |    ✓     |
| gimp-freetype         |  ✓  |   —    |    —     |
| gimp-plugins-unstable |  ✓  |   —    |    —     |
| gimp-macos-build      |  ✓  |   ✓    |    —     |
| gimp-perl             |  ✓  |   ✓    |    ✓     |
| gimp-ruby             |  ✓  |   ✓    |    —     |
| gimp-test-images      |  ✓  |   ✓    |    —     |
| gimp-tiny-fu          |  ✓  |   ✓    |    ✓     |
| gimp-ci/docker-gimp   |  ✓  |   ✓    |    —     |
| gimp-ci/documentation |  ✓  |   ✓    |    —     |
| gimp-ci/jenkins       |  ✓  |   ✓    |    —     |
| gimp-ci/jenkins-dsl   |  ✓  |   ✓    |    —     |
| gimp-ux               |  —  |   ✓    |    —     |

babl and gegl shared a single Bugzilla product, so their Bugzilla contributions are collected together (`_contributions_gegl-babl_bugzilla.csv`) rather than per sub-project.

There is also a small `_contributions_gimp_handcrafted.csv` for a handful of contributions that couldn't be captured automatically.

If I missed some relevant source let me know and create an MR or an issue.

- There is no data at all for 1996 and most of 1997, before CVS was introduced. The initial mailing list was
  not archived anywhere, which could have been a data source (gimp-list, not gimp-developer or gimp-user, which came after).
- I couldn't find anything for registry.gimp.org unfortunately. Besides its internal changes, it apparently had an RSS feed with new submissions and updates to published plugins and scripts. Could have been an interesting new contribution category.

---

## Contributions

- Every commit in default branch counts as a contribution
- Every closed or open (not merged) MR counts as a contribution
- Every created issue or bug counts as a contribution
- Only the first comment of a user per issue, MR or bug counts as a contribution, except self-comments (commenting on your own MRs or issues you created yourself). In other words: a person gets a triaging contribution if they helped with other people's issues, bugs or code

---

## Contributor identity resolution

### The problem

GIMP has been developed since 1995 across mailing lists, a CVS/git monorepo, GNOME Bugzilla, and GitLab. Many contributors appear under different names and email addresses depending on the platform and the decade. Without explicit alias mapping, the same person can look like several different contributors.

### Aliases file to the rescue

`data/gimp/contributor-aliases.txt` is a file that declares which identifiers belong to the same person:

```
Name [<email>] [<@gitlab-handle>] [<#Bugzilla-Name>]
```

At least one of the identifiers (email (git author), `@gitlab-handle`, or `#Bugzilla-Name`) must be present, but none is individually required.

`merge.py` reads this file and applies it when building `contributions.csv`.

### Updating alias suggestions

```sh
cd data/gimp
python3 make_alias_draft.py
```

This analyzes all per-source CSVs and appends tiered, commented suggestions to the bottom of `contributor-aliases.txt`. To accept a suggestion, uncomment its line and re-run `merge.py`.

### Please help check your own entry

If you have contributed to GIMP or any of the sub-projects listed above, your contributions may be split across multiple identities in the data. I'd appreciate it if you could:

1. Open `data/gimp/contributor-aliases.txt`.
2. Search for the name(s) and email address(es) you used in git, your GitLab handle, or your name used on Bugzilla.
3. If you find handles wrongly attributed to your alias, split the entry. If you're missing entirely, or you find your handles attributed to other people, please open an issue or a merge request with a fix.

Even better: if you recognize other contributors with multiple aliases/handles please check these entries as well. The alias file covers hundreds of people and no automated heuristic catches everything.

---

## Categories

Contributions are classified into the following categories:

| Category               | Group       |
| ---------------------- | ----------- |
| coding-feature         | coding      |
| coding-bugfix          | coding      |
| coding-other           | coding      |
| translation            | translation |
| documentation          | writing     |
| communication          | writing     |
| bug-reporting          | issues      |
| improvement-suggestion | issues      |
| triaging               | triaging    |

Git commit categories are assigned by a local LLM using the profiles in `pipeline/git/gimp/`. GitLab and Bugzilla contributions are classified by the type of activity (issue, MR, comment, etc.).

Colors for each category within the same group should have the same hue. The distinction between categories within a group - like feature implementation vs. bugfix - is often
not much more than a guess, especially on older data.

---

## Chapters

I added some chapters to `data/gimp/chapters.json` (3.0 release cycle, 2.10 release cycle, and pre-1.0). But suggestions, text/images/links, other dates welcome.

For the pre-1.0 era we have a nice page on the website. Unfortunately there is nothing like it for the next decades so I linked to the release announcement news articles.

Would be great if someone gets inspired to write an article for later chapters/eras. The news articles are nice but focus on the release/product. For this purpose a dedicated page/article
that focuses on history/about/people would be better: .e.g. which people joined and defined that chapter, which people stepped away, some quotes, events, hardships, funny stories etc covering multiple years.

## Regenerating the data

For each mentioned subproject you will find a YAML profile with project-specific metadata like git URLs or filename-patterns.

### 1. Collect per-source CSVs

**GitLab** (created issues and comments on issues and MRs):

```sh
cd pipeline/gitlab
python3 fetch_gitlab.py --profile gimp/<project>.yaml
# e.g. --profile gimp/gimp.yaml, gimp/babl.yaml, ...
# or use gimp/run.sh to run all profiles
bash gimp/run.sh
```

**Git commits** (classified by a local LLM or simple globbing patterns):

Requires a llama-server running at `http://localhost:8001` (or other OpenAI-compatible API endpoint).
Check out [llama.cpp](https://github.com/ggml-org/llama.cpp) for how to build it for your machine.

I'm using Unsloth's Q8 quant of Google's Gemma 4 (E4B) local model as a classifier. You can find more
information [Gemma 4 - How to Run Locally](https://unsloth.ai/docs/models/gemma-4) which also lists other quants if Q8 doesn't
fit on you GPU.

Run this command to start llama-server:

```sh
CUDA_VISIBLE_DEVICES=0 ./llama-server \
    --model gemma-4-E4B-it/gemma-4-E4B-it-Q8_0.gguf \
    --mmproj gemma-4-E4B-it/mmproj-BF16.gguf \
    --temp 1.0 \
    --top-p 0.95 \
    --top-k 64 \
    --alias "unsloth/gemma-4-E4B-it-GGUF" \
    --port 8001 \
    --parallel 1 \
    --chat-template-kwargs '{"enable_thinking":true}'
```

Now that the endpoint is available you can run the git commit classifier script

```sh
cd pipeline/git
python3 classify_commits.py --profile gimp/<project>.yaml
# or
bash gimp/run.sh
```

I optimized the prompt and shortcuts only for main GIMP repo. For the most part it was copied from there to all other profiles. This needs some further tuning for sure.

**Bugzilla** (static HTML snapshots):

Note that this will clone the static GNOME Bugzilla pages which will need roughly 20GB of space
on your hard drive (download is way less as it's highly compressible)

```sh
cd pipeline/bugzilla
python3 fetch_gnome_bugzilla_static.py --profile gimp/<project>.yaml
# or
bash gimp/run.sh
```

### 2. Merge into contributions.csv

```sh
cd data/gimp
python3 merge.py
```

This applies alias canonicalization, deduplicates triage rows, and writes `contributions.csv`.
