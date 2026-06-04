# Contributor Atlas

Interactive visualizations for exploring contributor activity in open-source projects over time.

It's aimed at projects with a long legacy of contributors — the views come alive when there are many people spread across many years of history.

This project was built to visualize contributions to [GIMP](https://www.gimp.org/) and its ecosystem, but the graphs themselves are generic — if your project has contribution data, you should be able to plug it in without too much effort. Unfortunately I don't have the time to do this for other projects myself, but I'd love to see it used elsewhere.

The current GIMP dataset is deployed at **https://contributor-atlas-4dab97.pages.gitlab.gnome.org** if you just want to explore it without running anything locally.

---

## Visualizations

There are five views. Each one is a self-contained Canvas visualization that can either be used through its ready-made HTML page or embedded as a function into your own page (see [Using the visualizations](#using-the-visualizations)).

| View             | Description                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Gathering**    | All contributors packed in a circle with the project in the center                                               |
| **Pulse**        | Project activity over time, measured as number of contributions, as a bar chart                                  |
| **Trails**       | Contributor arcs across the timeline                                                                             |
| **Ripples**      | All contributors shown as concentric circles around the project, sorted by number of contributions               |
| **Cornerstones** | A ring of top contributors around the project, surrounded by everyone else who contributed, randomly distributed |

---

## Data format

Every view reads from a single CSV file containing all contributions, plus one JSON file with project metadata. The same files are used whether you run the standalone pages or embed a view.

### `contributions.csv` (required)

The main data file. One row per contribution event.

| Column             | Type    | Description                                                                              |
| ------------------ | ------- | ---------------------------------------------------------------------------------------- |
| `category`         | string  | Contribution type (must match a key in `project.json` `category_colors`)                 |
| `contributor_name` | string  | Display name                                                                             |
| `contributor_id`   | string  | Canonical identifier (email, handle, etc.)                                               |
| `timestamp`        | integer | Unix timestamp in seconds; day precision is enough, so the time-of-day can be zeroed out |

**Minimal example:**

```csv
category,contributor_name,contributor_id,timestamp
coding-feature,Alice,alice@example.com,1704067200
coding-bugfix,Bob,bob@example.com,1704153600
bug-reporting,Carol,carol@example.com,1704240000
documentation,Alice,alice@example.com,1704326400
coding-feature,Dave,dave@example.com,1704412800
```

### `project.json` (required)

All project metadata in one file.

```json
{
  "name": "My Project",
  "logo": "/data/myproject/logo.png",
  "category_colors": {
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
- `category_colors` — (required) maps each category name to a hex color used in the visualizations
- `category_groups` — (optional) maps each category to a broader display group
- `chapters` — (optional) named time ranges shown in the timeline control; `start`/`end` are ISO 8601 date strings or `null`; `text`, `image_url`, and `link_url` are optional

### `highlights.csv` (optional)

Project milestones shown in Pulse. Two columns: `name` and `timestamp` (`YYYY-MM-DD` string). For example, release dates.

```csv
name,timestamp
v2.0 release,2004-03-23
v2.10 release,2018-04-27
```

---

## Using the visualizations

> [!TIP]
> The [Releases page](https://gitlab.gnome.org/balooii/contributor-atlas/-/releases) has a ready-to-use `.zip`. It contains everything described below — the standalone HTML pages (`index.html` plus the five views), the embeddable JS/CSS bundles, the bundled font under `static/`, and the GIMP dataset under `data/gimp/` as an example. Unzip it and serve the directory.

There are two ways to put these views on a page:

- **[Standalone pages](#standalone-pages)** — open the bundled `*.html` pages as-is. Each is a full-screen view with navigation between them. Best if you just want the whole thing running.
- **[Embedding a single view](#embedding-a-single-view)** — drop one view into a page you already have, via the JS/CSS bundle. Best if you only want, say, Cornerstones inside an existing site.

### Standalone pages

The release bundle ships a landing page — `index.html` (welcome + links into the views) — plus the five views as ready-to-serve pages: `cornerstones.html`, `pulse.html`, `trails.html`, `ripples.html`, and `gathering.html`.
Serve the bundle directory and open any page; each view is a full-screen canvas with navigation between the five.

To make the pages your own, edit each HTML file:

- **Data paths** — Point `contributions` / `project` / `highlights` at your own files in the `<script type="module">` block near the bottom of each page.
- **Nav bar brand** — Every page shows the project name in the top-left as `<span class="ca-brand-project">GIMP</span> Contributor Atlas`. Replace `GIMP` in that span with your own project name.
- **Landing page content** — `index.html` is GIMP-specific. Edit that page's body to describe your own project.

### Embedding a single view

To use just one (or a few) views inside another page, ship the release bundle rather than the whole repo. Two bundle formats are produced, so you can pick the one that fits your page:

| File                          | What it is                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `contributor-atlas.js`        | ESM bundle — `import { gathering } from "./contributor-atlas.js"`                           |
| `contributor-atlas.global.js` | IIFE bundle — `<script src>` that exposes a `ContributorAtlas` global, for non-module pages |
| `contributor-atlas.css`       | the stylesheet                                                                              |
| `static/`                     | the bundled font (Encode Sans)                                                              |

The JS bundles are self-contained — there are no other runtime dependencies to load. They're included in the release `.zip` on the [Releases page](https://gitlab.gnome.org/balooii/contributor-atlas/-/releases); see [Building the release bundle](#building-the-release-bundle) if you'd rather produce them from source.

`src/contributorAtlas.js` is the public API: one function per view, `view(container, options)`. The functions are `gathering`, `pulse`, `trails`, `ripples`, and `cornerstones`.

```html
<link rel="stylesheet" href="contributor-atlas.css" />
<div id="chart" style="width: 100%; height: 100%"></div>
<script src="contributor-atlas.global.js"></script>
<script>
  ContributorAtlas.ripples(document.getElementById("chart"), {
    contributions: "my-data.csv",
    project: "my-project.json",
  });
</script>
```

Or, on a page that already uses ES modules:

```js
import { ripples } from "./contributor-atlas.js";

ripples(document.getElementById("chart"), {
  contributions: "my-data.csv",
  project: "my-project.json",
});
```

**Options:**

| Option           | Description                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contributions`  | (required) path/URL to `contributions.csv`                                                                                                                       |
| `project`        | (required) path/URL to `project.json`                                                                                                                            |
| `highlights`     | (Pulse only, optional) path/URL to `highlights.csv`                                                                                                              |
| `enableControls` | (default `true`) whether to render the timeline/category filter control just below the chart. Pass `false` to omit it.                                           |
| `search`         | element or CSS selector to render contributor search into. The view appends the search widget to it; you own the element and its placement. Omit to skip search. |

**Optional widgets.** Two extra UI pieces ship with the bundle, both opt-in and rendered into a host element you provide: a **contributor search** box (enabled via the `search` option above) and a **theme picker** menu).
See `embed-demo.html` in the repository for a runnable demo that wires up both.

---

## Customizing font and colors

**Category colors** are set in `project.json` under `category_colors` (see [Data format](#projectjson-required)).

Everything else is driven by CSS custom properties defined in `src/styles.css` (shipped as `contributor-atlas.css`). The JS reads the color and font tokens via `getComputedStyle(container)` at render time, so overriding a variable is enough; no rebuild needed.

These tokens are scoped to the chart's container, not :root, so it can't clash with same-named variables on your own page.

```css
#my-chart {
  /* Use your own font */
  --font-family: "Inter", sans-serif;

  /* Canvas background color */
  --c-bg: #0b0b0b;
}
```

A dark default and a light variant ship out of the box (the latter via `prefers-color-scheme` or a `[data-theme="light"]` override), so views follow the visitor's OS preference automatically. On any theme change each view re-reads its tokens and redraws — scope your overrides per mode and they apply in both. If your page has its own theme switch, call `notifyThemeChange()` after updating your CSS so the views pick it up:

```js
import { notifyThemeChange } from "./contributor-atlas.js";
notifyThemeChange();
```

---

## Adapting the data

The visualizations only read `contributions.csv` and `project.json`, so adapting Contributor Atlas to your project is mostly a data problem: produce those files for your sources.

If you pull from multiple sources, you'll likely need to merge data so contributions are attributed to the right people. The GIMP setup does this with:

- `data/gimp/merge.py` — combines the per-source CSVs, deduplicates, and canonicalizes contributor names via `contributor-aliases.txt`
- `make_alias_draft.py` + `contributor-aliases.txt` — semi-automatic aliasing to collapse the same person's many identities

The per-source CSVs themselves are produced by the fetchers under `pipeline/` (GitLab issues/MRs, GNOME Bugzilla HTML snapshots, and git-commit classification). These were written for GIMP's sources and GNOME's GitLab instance, so they may or may not work for yours out of the box.

See [GIMP.md](data/gimp/GIMP.md) and the `data`, `pipeline/gitlab`, `pipeline/bugzilla`, and `pipeline/git` directories for the full pipeline.

---

## Building the release bundle

You don't need to build for local development. A build is only required to produce the distributable bundle described in [Using the visualizations](#using-the-visualizations).

```sh
npm install
npm run build:release  # creates files in dist/
```

`scripts/build-release.mjs` (esbuild) emits into `dist/`:

- `contributor-atlas.js` — ESM bundle
- `contributor-atlas.global.js` — IIFE bundle exposing the `ContributorAtlas` global
- `contributor-atlas.css` — the embeddable stylesheet, with the font in `static/` beside it
- `contributor-atlas.page.css` / `contributor-atlas.landing.css` — page-shell stylesheets, used only by the bundled HTML pages
- the landing page (`index.html`) and the five view pages
- `data/gimp/` — runtime data, using GIMP as an example dataset so there is something to show

---

## Contributing

The canonical repository is on [GNOME GitLab](https://gitlab.gnome.org/balooii/contributor-atlas) — please open merge requests there.

To run locally:

1. Serve the repository root over HTTP (feel free to use another (local) web server):
   ```sh
   python3 -m http.server
   ```
2. Open http://localhost:8000 in your browser.

This shows the GIMP dataset out of the box. To use your own data, see [Adapting the data](#adapting-the-data).

When contributing code please run the formatters first:

```sh
npx prettier -w .
uvx ruff format
```

---

## Attributions

**License:** [MIT](LICENSES/MIT.txt).

- **[Nadieh Bremer](https://www.visualcinnamon.com/)** — the Cornerstones visualization is adapted from her [ORCA repository](https://github.com/nbremer/ORCA), licensed under the [Mozilla Public License 2.0](LICENSES/MPL-2.0.txt).
- **[D3.js](https://d3js.org/)** by Mike Bostock and D3.js contributors — vendored as an ES module in `static/`, licensed under the [ISC License](LICENSES/ISC.txt).
- **[Encode Sans](https://fonts.google.com/specimen/Encode+Sans)** by The Encode Project Authors — vendored in `static/`, licensed under the [SIL Open Font License 1.1](LICENSES/OFL-1.1.txt).
