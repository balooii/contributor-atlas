import * as d3 from "d3";

// Shared page boilerplate for every visualization page:
//   * Eagerly request the configured font (--font-family) variants so canvas
//     text doesn't fall back to a system font on first paint.
//   * Wait for document.fonts.ready, then Promise.all the requested data files.
//   * Hand the loaded values to render(), then wire a debounced window-resize
//     listener that calls onResize only when the viewport actually changed.
//
// Each page still owns its chart factory construction, timeline-control wiring,
// and any page-specific toggles - this just removes the boilerplate they all share.
//
// A view with an async first render returns a promise from render(); Once it
// resolves the spinner goes down an onReady is fired.

import * as ChartBase from "./chartBase.js";

export function bootstrapPage({
  container,
  files,
  render,
  onReady,
  onResize,
  resizeDelay = 300,
}) {
  const FF = getComputedStyle(container)
    .getPropertyValue("--font-family")
    .trim();
  [
    `normal 400 10px ${FF}`,
    `italic 400 10px ${FF}`,
    `normal 700 10px ${FF}`,
    `italic 700 10px ${FF}`,
  ].forEach((spec) => document.fonts.load(spec));

  document.fonts.ready.then(() => {
    const loads = files.map((f) => {
      if (!f.path)
        return f.optional
          ? Promise.resolve([])
          : Promise.reject(new Error(`bootstrapPage: missing path for ${f}`));
      const p = (f.type === "csv" ? d3.csv : d3.json)(f.path);
      return f.optional ? p.catch(() => []) : p;
    });
    Promise.all(loads).then((values) => {
      // Show a spinner, then defer the heavy computation to the next event loop
      // turn after a paint - this lets the browser render the spinner before
      // the synchronous layout/canvas computation blocks the main thread.
      const chartContainer =
        container || document.getElementById("chart-container");
      const overlay =
        chartContainer && ChartBase.createLoadingOverlay(chartContainer);
      if (overlay) overlay.style.display = "flex";

      requestAnimationFrame(() =>
        setTimeout(() => {
          // render() may return a promise; hold the spinner until it resolves
          // (sync views return nothing and resolve immediately).
          Promise.resolve(render(values)).then(() => {
            if (overlay) overlay.remove();
            onReady?.();

            let currentW = chartContainer.offsetWidth;
            let currentH = chartContainer.offsetHeight;
            let timer = null;
            new ResizeObserver(() => {
              clearTimeout(timer);
              timer = setTimeout(() => {
                const w = chartContainer.offsetWidth;
                const h = chartContainer.offsetHeight;
                if (w === currentW && h === currentH) return;
                currentW = w;
                currentH = h;
                onResize();
              }, resizeDelay);
            }).observe(chartContainer);
          });
        }, 0),
      );
    });
  });
}
