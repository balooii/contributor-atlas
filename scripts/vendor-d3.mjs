// One-off vendoring step (run via `npm run vendor:d3`).
//
// Local development has no build step: the pages load src/*.js as native ES
// modules and resolve their bare `import * as d3 from "d3"` through an import
// map that points at static/d3.v7.esm.js.
// This script (re)generates that single vendored file by bundling the installed d3
// into one ESM module.
// `npm run build:release` doesn't use it but pulls d3 from node_modules and tree-shakes
// it.
// Rerun this script when upgrading to a newer d3 version.

import { build } from "esbuild";

await build({
  stdin: { contents: 'export * from "d3";', resolveDir: "." },
  bundle: true,
  format: "esm",
  outfile: "static/d3.v7.esm.js",
});

console.log("Wrote static/d3.v7.esm.js");
