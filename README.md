# Contributor Atlas

> **Work in progress.** The GIMP dataset is still being built out, and larger structural changes or clean-ups may follow. I'd recommend waiting until the GIMP work has settled before adopting this for other projects.

Interactive visualizations for exploring contributor activity in open-source projects over time.

This project was built to visualize contributions to [GIMP](https://www.gimp.org/) and its ecosystem, but the graphs themselves are generic — if your project has contribution data, you should be able to plug it in without too much effort. Unfortunately I don't have the time to do this for other projects myself, but I'd love to see it used elsewhere.

---

## Visualizations

There are five views. There is no build step, so to run locally just:

1. Download `contributions.csv` from https://gitlab.gnome.org/balooii/contributor-atlas/-/work_items/1 and put it in `data/gimp/`.
2. Start a webserver from the repository root:
   ```sh
   python3 -m http.server
   ```
3. Open http://localhost:8000 in your browser.

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

The visualizations read from a single CSV file containing all contributions, plus one JSON file with project metadata.

### `contributions.csv` (required)

The main data file. One row per contribution event.

| Column             | Type    | Description                                                                              |
| ------------------ | ------- | ---------------------------------------------------------------------------------------- |
| `contribution_id`  | string  | Unique ID for this contribution (e.g. `commit-gimp-abc123`)                              |
| `category`         | string  | Contribution type (must match a key in `project.json` `categories`)                      |
| `contributor_name` | string  | Display name                                                                             |
| `contributor_id`   | string  | Canonical identifier (email, handle, etc.)                                               |
| `timestamp`        | integer | Unix timestamp (seconds, but time can be truncated. Day-precision is enough for the viz) |

**Minimal example:**

```csv
contribution_id,category,contributor_name,contributor_id,timestamp
commit-myproject-001,coding-feature,Alice,alice@example.com,1704067200
commit-myproject-002,coding-bugfix,Bob,bob@example.com,1704153600
issue-myproject-003,bug-reporting,Carol,carol@example.com,1704240000
issue-myproject-004,documentation,Alice,alice@example.com,1704326400
issue-myproject-005,coding-feature,Dave,dave@example.com,1704412800
```

### `project.json` (required)

All project metadata in one file.

```json
{
  "name": "My Project",
  "logo": "/data/myproject/logo.png",
  "categories": {
    "coding-feature": "#1d4ed8",
    "coding-bugfix": "#60a5fa",
    "coding-other": "#bae6fd",
    "bug-reporting": "#e11d48",
    "documentation": "#8ecf8e"
  },
  "category_groups": {
    "coding-feature": "coding",
    "coding-bugfix": "coding",
    "coding-other": "coding",
    "bug-reporting": "issues",
    "documentation": "writing"
  },
  "chapters": [
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
}
```

- `name` — (required) display label for the project center node
- `logo` — (optional) image path; the center node shows text by default and reveals the logo on hover
- `categories` — (required) maps each category name to a hex color used in the visualizations
- `category_groups` — (optional) maps each category to a broader group
- `chapters` — (optional) named time ranges shown in the timeline control; `start`/`end` are ISO 8601 date strings or `null`; `text`, `image_url`, and `link_url` are optional

### `highlights.csv` (optional)

Project milestones shown in Pulse. Two columns: `name` and `timestamp` (`YYYY-MM-DD` string). For example, release dates.

```csv
name,timestamp
v2.0 release,2004-03-23
v2.10 release,2018-04-27
```

---

## Adapting for your project

1. Create a directory under `data/` for your project (e.g. `data/myproject/`).
2. Populate the required data files above.
3. Point each of the five HTML files at your data directory by updating the `path:` entries in its `bootstrapPage({ files: [...] })` call. All views load `project.json`; `pulse.html` additionally loads `highlights.csv`.

If you have multiple data sources you probably need to merge some data so contributions get attributed to the right people. You may find it helpful to read `merge.py` and the semi-automatic aliasing logic in `make_alias_draft.py` and `contributor-aliases.txt` (written for GIMP's sources).

Also the scripts to fetch data from GNOME's GitLab instance and git repositories may or may not work for your sources.

Check out [GIMP.md](data/gimp/GIMP.md) and the `data`, `pipeline/gitlab`, `pipeline/bugzilla`, and `pipeline/git` directories for further details.

---

## Contributing

When contributing code please run formatters first

```sh
npx prettier -w .
uvx ruff format
```

---

## Attributions

**License:** [MIT](LICENSES/MIT.txt).

- **[Nadieh Bremer](https://www.visualcinnamon.com/)** — the Cornerstones visualization is adapted from her [ORCA repository](https://github.com/nbremer/ORCA), licensed under the [Mozilla Public License 2.0](LICENSES/MPL-2.0.txt).
- **[D3.js](https://d3js.org/)** by Mike Bostock and D3.js contributors — bundled in `static/lib/`, licensed under the [ISC License](LICENSES/ISC.txt).
- **[Encode Sans](https://fonts.google.com/specimen/Encode+Sans)** by The Encode Project Authors — bundled in `static/fonts/`, licensed under the [SIL Open Font License 1.1](LICENSES/OFL-1.1.txt).
