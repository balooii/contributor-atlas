# Contributor Atlas — GIMP

This page is a reference for how the GIMP Contributor Atlas data was gathered and processed: which repositories and trackers it draws from, what counts as a contribution, how contributor identities are resolved across sources, how contributions are classified into categories, and how to regenerate the dataset from scratch.

---

## Included sources

Contributions are collected from the following sources:

| Sub-project                               | git commits | GitLab issues and merge requests | [Bugzilla][bugzilla] |
| ----------------------------------------- | :---------: | :------------------------------: | :------------------: |
| [gimp][]                                  |      ✓      |                ✓                 |       ✓ (GIMP)       |
| [babl][]                                  |      ✓      |                ✓                 |          —           |
| [gegl][]                                  |      ✓      |                ✓                 |       ✓ (GEGL)       |
| [gimp-help][]                             |      ✓      |                ✓                 |   ✓ (GIMP-manual)    |
| [gimp-help (pre-2002)][gimp-help-archive] |      ✓      |                —                 |          —           |
| [gimp-web][]                              |      ✓      |                ✓                 |     ✓ (gimp-web)     |
| [gimp-web-devel][]                        |      ✓      |                ✓                 |          —           |
| [gimp-data][]                             |      ✓      |                ✓                 |          —           |
| [gimp-data-extras][]                      |      ✓      |                ✓                 |          —           |
| [gimp-extensions-web][]                   |      ✓      |                ✓                 |          —           |
| [gimp-gap][]                              |      ✓      |                ✓                 |     ✓ (gimp-gap)     |
| [gimp-freetype][]                         |      ✓      |                —                 |          —           |
| [gimp-plugins-unstable][]                 |      ✓      |                —                 |          —           |
| [gimp-macos-build][]                      |      ✓      |                ✓                 |          —           |
| [gimp-perl][]                             |      ✓      |                ✓                 |    ✓ (gimp-perl)     |
| [gimp-ruby][]                             |      ✓      |                ✓                 |          —           |
| [gimp-test-images][]                      |      ✓      |                ✓                 |          —           |
| [gimp-tiny-fu][]                          |      ✓      |                ✓                 |   ✓ (gimp-tiny-fu)   |
| [gimp-ci/docker-gimp][]                   |      ✓      |                ✓                 |          —           |
| [gimp-ci/documentation][]                 |      ✓      |                ✓                 |          —           |
| [gimp-ci/jenkins][]                       |      ✓      |                ✓                 |          —           |
| [gimp-ci/jenkins-dsl][]                   |      ✓      |                ✓                 |          —           |
| [gimp-ux][]                               |      —      |                ✓                 |          —           |

> [!note]
> babl and gegl shared a single Bugzilla product, so their Bugzilla contributions are collected together (`_contributions_gegl-babl_bugzilla.csv`) rather than per sub-project.
>
> There is also a small `_contributions_gimp_handcrafted.csv` for a handful of contributions that couldn't be captured automatically.

> [!note]
> If I missed some relevant source let me know and create an MR or an issue.
>
> - There is no data at all for 1996 and most of 1997, before CVS was introduced. The initial mailing list was
>   not archived anywhere, which could have been a data source (gimp-list, not gimp-developer or gimp-user, which came after).
> - I couldn't find anything for registry.gimp.org unfortunately. Besides its internal changes, it apparently had an RSS feed with new submissions and updates to published plugins and scripts. Could have been an interesting new contribution category.

---

## Filtering

- Every commit in the default branch counts as a contribution
- Every closed or open (not merged) MR counts as a contribution
- Every created issue or bug counts as a contribution
- Only the first comment of a user per issue, MR or bug counts as a contribution, except self-comments (commenting on your own MRs or issues you created yourself). In other words: a person gets a triaging contribution if they helped with other people's issues, bugs or code
- Issues and comments on GitLab made by the Bugzilla migration user are filtered out to avoid duplicates, since that activity is already present in the Bugzilla dump

---

## Contributor identity resolution

GIMP has been developed since 1995 across mailing lists, several version control systems and code repositories, GNOME Bugzilla, and GitLab. Many contributors appear under different names and email addresses depending on the platform and the decade. Without explicit alias mapping, the same person can look like several different contributors.

`data/gimp/contributor-aliases.txt` declares which identifiers belong to the same person, one person per line:

```
Name [<email>] [<@gitlab-handle>] [<#Bugzilla-Name>] ...
```

Each line needs at least one identifier - an email (a git author address), a `@gitlab-handle`, or a `#Bugzilla-Name` - but none is individually required. A contributor often used several email addresses over the years, so multiple `<email>` entries on one line are common. `merge.py` reads this file and collapses the listed identities into a single contributor when building `contributions.csv`.

The file is seeded by `make_alias_draft.py`, which scans the per-source CSVs and appends tiered, commented candidate groupings to the bottom of the file; uncommenting a suggestion accepts it. No automated heuristic catches everything, so the file is also curated by hand and covers hundreds of people.

The Bugzilla identifiers are the weakest link. GNOME's original Bugzilla instance has been shut down, and only a static HTML dump survives - and that dump records contributors by display name only (e.g. `Michael Schumacher`), with no user IDs or email addresses. For people with very common names, especially where only a first name was used, there is often no reliable way to tie a Bugzilla identity back to the same person's git or GitLab activity, so some such contributions may end up attributed to the wrong person.

> [!note]
> If you spot a contributor whose work is split across several identities, or identities wrongly merged together, check out `data/gimp/contributor-aliases.txt` and open an issue or merge request with a fix.

---

## Classification

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

Git commits are classified in two ways. Where the set of touched files unambiguously maps to a category, the commit is resolved deterministically by globbing patterns, e.g. a commit touching only `po/*.po` files is a `translation`. Commits that the file paths can't settle - above all the `coding-feature` vs `coding-bugfix` split, which file names alone don't reveal - are passed to a local LLM ([Gemma 4 E4B](https://huggingface.co/google/gemma-4-E4B-it)). It picks a category from the commit message and the diffstat (the list of changed files with their added/removed line counts); the diff itself is not included, as that would be too slow to process.

> [!note]
> The exact globbing patterns and the LLM prompt are defined per sub-project in the profiles at `pipeline/git/gimp/<project>.yaml`. Commit classification is inherently imperfect, especially for commits with vague messages or non-atomic ones that mix changes from several categories.

GitLab and Bugzilla contributions are classified by the type of activity instead: a created issue or bug becomes `bug-reporting` or `improvement-suggestion`, a closed or open (not merged) merge request becomes `coding-other`, and the first comment a non-author leaves on someone else's issue, MR, or bug becomes `triaging`.

On GitLab, an issue counts as `bug-reporting` if it carries one of the bug labels defined for that sub-project, otherwise `improvement-suggestion`. These labels are set per profile (`bug_labels:`), not shared across sub-projects:

| GitLab sub-project                            | `bug_labels`                                                        |
| --------------------------------------------- | ------------------------------------------------------------------- |
| gimp, babl, gegl, gimp-data, gimp-data-extras | `0. Critical`, `1. Crash`, `1. Bug`, `1. Regression`, `1. Security` |
| gimp-macos-build                              | `Bug`                                                               |
| all others                                    | none - every issue counts as `improvement-suggestion`               |

Bugzilla has no such labels: a bug is `improvement-suggestion` when its severity is `enhancement`, and `bug-reporting` for any other severity.

---

## Regenerating the data

The data is rebuilt in two steps: collect one CSV per source, then merge them. Each sub-project has a profile per source at `pipeline/<gitlab|git|bugzilla>/gimp/<project>.yaml` holding its project-specific settings (repository URLs, label and globbing rules, the LLM prompt, etc.).

### Prerequisites

- **Python packages:** `pip install requests pyyaml beautifulsoup4`
- **GitLab token:** the GitLab fetch reads a `GITLAB_TOKEN` environment variable - a personal access token with `read_api`, `read_user`, and `read_repository` scopes.
- **GNOME GitLab SSH access:** the Bugzilla fetch clones its source repo over SSH (HTTPS is blocked), so you need an SSH key registered on gitlab.gnome.org.

The git-commit classifier also needs a local LLM. It calls an OpenAI-compatible endpoint at `http://localhost:8001`; I run [llama.cpp](https://github.com/ggml-org/llama.cpp)'s llama-server with the [Gemma 4 E4B](https://huggingface.co/google/gemma-4-E4B-it) model (Unsloth's Q8 quant - their [how-to-run guide](https://unsloth.ai/docs/models/gemma-4) lists smaller quants if Q8 doesn't fit your GPU):

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

### 1. Collect per-source CSVs

Each script takes a `--profile`; each of the three directories (`pipeline/gitlab`, `pipeline/git`, `pipeline/bugzilla`) also has a `gimp/run.sh` that runs every sub-project profile in turn.

> [!note]
> The GitLab fetch and the git-commit classifier are heavily cached, so you can interrupt them at any time and they pick up where they left off. Re-running the same command later only fetches and classifies what has changed since the last run.

**GitLab** (created issues and comments on issues and MRs):

> [!warning]
> This can take a while for large projects. Fetching issues, merge requests, and comments isn't noticeably rate limited, but the users endpoint - queried for the extra contributor detail used by the identity-merging script - is, which slows the run down.

```sh
cd pipeline/gitlab
python3 fetch_gitlab.py --profile gimp/<project>.yaml   # e.g. gimp/gimp.yaml, gimp/babl.yaml
```

**Git commits** (classified by the local LLM or by globbing patterns; needs the llama-server above):

> [!warning]
> Classifying commits through the LLM can take a very long time when many commits have to be processed - how long depends heavily on your GPU.

```sh
cd pipeline/git
python3 classify_commits.py --profile gimp/<project>.yaml
```

**Bugzilla** (static HTML snapshots):

> [!warning]
> This clones the static GNOME Bugzilla pages, which need roughly 20GB of disk space (the download is far smaller as it's highly compressible).

```sh
cd pipeline/bugzilla
python3 fetch_gnome_bugzilla_static.py --profile gimp/<project>.yaml
```

### 2. Merge into contributions.csv

```sh
cd data/gimp
python3 merge.py
```

This reads `contributor-aliases.txt` to collapse each contributor's identities into one, deduplicates triage rows, and writes `contributions.csv`. The alias file is committed, so you don't need to regenerate it - it is maintained semi-automatically by `make_alias_draft.py` (which appends commented suggestions for hand-curation) as described under [Contributor identity resolution](#contributor-identity-resolution).

<!-- link references -->

[bugzilla]: https://gitlab.gnome.org/Infrastructure/bugzilla-static
[gimp]: https://gitlab.gnome.org/GNOME/gimp
[babl]: https://gitlab.gnome.org/GNOME/babl
[gegl]: https://gitlab.gnome.org/GNOME/gegl
[gimp-help]: https://gitlab.gnome.org/GNOME/gimp-help
[gimp-help-archive]: https://gitlab.gnome.org/Archive/gimp-help
[gimp-web]: https://gitlab.gnome.org/Infrastructure/gimp-web
[gimp-web-devel]: https://gitlab.gnome.org/Infrastructure/gimp-web-devel
[gimp-data]: https://gitlab.gnome.org/GNOME/gimp-data
[gimp-data-extras]: https://gitlab.gnome.org/GNOME/gimp-data-extras
[gimp-extensions-web]: https://gitlab.gnome.org/Infrastructure/gimp-extensions-web
[gimp-gap]: https://gitlab.gnome.org/Archive/gimp-gap
[gimp-freetype]: https://gitlab.gnome.org/Archive/gimp-freetype
[gimp-plugins-unstable]: https://gitlab.gnome.org/Archive/gimp-plugins-unstable
[gimp-macos-build]: https://gitlab.gnome.org/Infrastructure/gimp-macos-build
[gimp-perl]: https://gitlab.gnome.org/GNOME/gimp-perl
[gimp-ruby]: https://gitlab.gnome.org/Archive/gimp-ruby
[gimp-test-images]: https://gitlab.gnome.org/Infrastructure/gimp-test-images
[gimp-tiny-fu]: https://gitlab.gnome.org/Archive/gimp-tiny-fu
[gimp-ci/docker-gimp]: https://gitlab.gnome.org/World/gimp-ci/docker-gimp
[gimp-ci/documentation]: https://gitlab.gnome.org/World/gimp-ci/documentation
[gimp-ci/jenkins]: https://gitlab.gnome.org/World/gimp-ci/jenkins
[gimp-ci/jenkins-dsl]: https://gitlab.gnome.org/World/gimp-ci/jenkins-dsl
[gimp-ux]: https://gitlab.gnome.org/Teams/GIMP/Design/gimp-ux
