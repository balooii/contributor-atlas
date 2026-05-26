# Contributor Atlas

> **Work in progress.** The GIMP dataset is still being built out, and larger structural changes or clean-ups may follow. I'd recommend waiting until the GIMP work has settled before adopting this for other projects.

Interactive visualizations for exploring contributor activity in open-source projects over time.

This project was built to visualize contributions to [GIMP](https://www.gimp.org/) and its ecosystem, but the graphs themselves are generic — if your project has contribution data, you should be able to plug it in without too much effort. Unfortunately I don't have the time to do this for other projects myself, but I'd love to see it used elsewhere.

Built on work by Nadieh Bremer ([VisualCinnamon.com](https://www.visualcinnamon.com/)) and the [ORCA repository](https://github.com/nbremer/ORCA).

**License:** MIT. The "Cornerstones" visualization is based on code from ORCA, which is licensed under the Mozilla Public License 2.0.

---

## Visualizations

There are five views. All rendering uses HTML5 Canvas. There is no build step so you can just start a webserver and open your browser:
Download contributions.csv from https://gitlab.gnome.org/balooii/contributor-atlas/-/work_items/1 and put it in `data/gimp/`.

```sh
python3 -m http.server
# then open http://localhost:8000
```

Alternatively, the current GIMP dataset is also deployed at **https://contributor-atlas-4dab97.pages.gitlab.gnome.org** if you just want to explore it without running anything locally.

| File                | Description                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `index.html`        | **Gathering** — all contributors packed in a circle with the project in the center                                                  |
| `pulse.html`        | **Pulse** — project activity over time measured in number of contributions as bar chart                                             |
| `trails.html`       | **Trails** — contributor arcs across the timeline                                                                                   |
| `ripples.html`      | **Ripples** — all contributors shown as concentric circles around the project, sorted by number of contributions                    |
| `cornerstones.html` | **Cornerstones** — a ring of top contributors around the project, surrounded by everyone else that contributed randomly distributed |

---

## Data format

The visualizations are built from the same data read from a single CSV file containing all contributions. There are a few additional, tiny JSON files to configure
things like colors or data for chapter tooltips.

### `contributions.csv` (required)

The main data file. One row per contribution event.

| Column             | Type    | Description                                                                                                                                                                                        |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contribution_id`  | string  | Unique ID for this contribution (e.g. `commit-gimp-abc123`)                                                                                                                                        |
| `category`         | string  | Contribution type (must match a key in `categories.json`)                                                                                                                                          |
| `category_group`   | string  | Broader group for this category. If your categories are not subdivided (e.g. a single `coding` category rather than `coding-feature` / `coding-bugfix`), set this to the same value as `category`. |
| `contributor_name` | string  | Display name                                                                                                                                                                                       |
| `contributor_id`   | string  | Canonical identifier (email, handle, etc.)                                                                                                                                                         |
| `timestamp`        | integer | Unix timestamp (seconds, but time can be truncated. Day-precision is enough for the viz)                                                                                                           |

**Minimal example:**

```csv
contribution_id,category,category_group,contributor_name,contributor_id,timestamp
commit-myproject-001,coding-feature,coding,Alice,alice@example.com,1704067200
commit-myproject-002,coding-bugfix,coding,Bob,bob@example.com,1704153600
issue-myproject-003,bug-reporting,issues,Carol,carol@example.com,1704240000
issue-myproject-004,documentation,writing,Alice,alice@example.com,1704326400
issue-myproject-005,coding-feature,coding,Dave,dave@example.com,1704412800
```

### `categories.json` (required)

Maps each category name to a hex color used in the visualizations.

```json
{
  "coding-feature": "#1d4ed8",
  "coding-bugfix": "#60a5fa",
  "coding-other": "#bae6fd",
  "bug-reporting": "#e11d48",
  "documentation": "#8ecf8e"
}
```

### `category_groups.json` (optional)

Maps each category to a broader group name. Create this file when your categories are subdivided into groups (e.g. `coding-feature` and `coding-bugfix` both belonging to `coding`).

```json
{
  "coding-feature": "coding",
  "coding-bugfix": "coding",
  "coding-other": "coding",
  "bug-reporting": "issues",
  "documentation": "writing"
}
```

### `chapters.json` (optional)

Named time ranges shown in the timeline control. Useful for marking important eras of the project.

```json
[
  {
    "name": "Early days",
    "start": null,
    "end": "2015-01-01"
  },
  {
    "name": "Version 2.0",
    "start": "2015-01-02",
    "end": "2020-06-30",
    "text": "The 2.0 era — a short description shown alongside the chapter in the timeline control.",
    "image_url": "/data/myproject/v2-splash.png",
    "link_url": "https://myproject.example.com/news/v2-released"
  }
]
```

`start` and `end` are ISO 8601 date strings or `null`. `text`, `image_url`, and `link_url` are optional.

### `highlights.csv` (optional)

Project milestones shown in Pulse. Two columns: `name` and `timestamp` (`YYYY-MM-DD` string). For example, release dates.

```csv
name,timestamp
v2.0 release,2004-03-23
v2.10 release,2018-04-27
```

### `project.json` (required)

Identifies the project shown at the center node of Cornerstones, Gathering, and Ripples.

```json
{ "name": "GIMP", "logo": "data/myproject/logo.png" }
```

`name` is the required display label. `logo` is an optional path to an image; when set, the center node shows the project name as text by default and reveals the logo on hover.

---

## Adapting for your project

1. Create a directory under `data/` for your project (e.g. `data/myproject/`).
2. Populate the required data files above.
3. In each HTML file, update the `path:` entries in the `bootstrapPage({ files: [...] })` call to point at your data directory

If you have multiple data sources you probably need to merge some data so contributions get attributed to the right people. You may find it helpful to read `merge.py` and the semi-automatic aliasing logic in `make_alias_draft.py` and `contributor-aliases.txt` (written for GIMP's sources).

Also the scripts to fetch data from GNOME's GitLab instance and git repositories may or may not work for your sources.

Check out [GIMP.md](data/gimp/GIMP.md) and the `data`, `pipeline/gitlab`, `pipeline/bugzilla`, and `pipeline/git` directories for further details.
