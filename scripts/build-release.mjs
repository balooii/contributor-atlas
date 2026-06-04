// Release build script
//
// Local development is build-free. This produces bundled artifacts to make it
// easier to distribute and use elsewhere without having to copy all src files.
// When running npm run build:release it will create these files in the dist/ folder:
//
//   contributor-atlas.js         ESM bundle  - import { gathering } from ...
//   contributor-atlas.global.js  IIFE bundle - <script src> + ContributorAtlas.*
//   contributor-atlas.css        embeddable component stylesheet
//   contributor-atlas.page.css   page shell - used by our HTML pages, not embedders
//   static/                      font file only (d3 gets bundled in)
//   *.html                       the landing page + five views
//   data/gimp/                   example dataset so the built site has something to show
//   LICENSES/                    license texts
//

import { build } from "esbuild";
import { readFile, writeFile, rm, mkdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const DIST = "dist";

const PAGES = [
  "index.html",
  "cornerstones.html",
  "pulse.html",
  "trails.html",
  "ripples.html",
  "gathering.html",
];

const RUNTIME_DATA = [
  "project.json",
  "highlights.csv",
  "logo.png",
  "chapter_images",
  "contributions.csv",
];

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const common = {
    entryPoints: ["src/contributorAtlas.js"],
    bundle: true,
    minify: true,
    legalComments: "none",
  };

  await build({
    ...common,
    format: "esm",
    outfile: path.join(DIST, "contributor-atlas.js"),
  });
  await build({
    ...common,
    format: "iife",
    globalName: "ContributorAtlas",
    outfile: path.join(DIST, "contributor-atlas.global.js"),
  });

  await cp("src/styles.css", path.join(DIST, "contributor-atlas.css"));
  await cp("src/page.css", path.join(DIST, "contributor-atlas.page.css"));
  await cp("src/landing.css", path.join(DIST, "contributor-atlas.landing.css"));
  await cp("static", path.join(DIST, "static"), { recursive: true });
  await cp("LICENSES", path.join(DIST, "LICENSES"), { recursive: true });
  // d3 is bundled into the release artifacts, so the local/dev-only vendored copy
  // is not needed alongside them.
  await rm(path.join(DIST, "static", "d3.v7.esm.js"), { force: true });

  for (const page of PAGES) {
    const html = (await readFile(page, "utf8"))
      .replace('href="src/styles.css"', 'href="contributor-atlas.css"')
      .replace('href="src/page.css"', 'href="contributor-atlas.page.css"')
      .replace('href="src/landing.css"', 'href="contributor-atlas.landing.css"')
      // The bundle has d3 inlined, so the bare "d3" specifier the import map
      // resolves no longer appears, so we can drop it.
      .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, "")
      .replace(
        'from "./src/contributorAtlas.js"',
        'from "./contributor-atlas.js"',
      );
    await writeFile(path.join(DIST, page), html);
  }

  const dataDir = path.join(DIST, "data", "gimp");
  await mkdir(dataDir, { recursive: true });
  for (const f of RUNTIME_DATA) {
    const src = path.join("data", "gimp", f);
    if (existsSync(src))
      await cp(src, path.join(dataDir, f), { recursive: true });
  }

  console.log("Built " + DIST + "/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
