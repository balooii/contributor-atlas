// Shared page boilerplate for every visualization page:
//   * Eagerly request Encode Sans variants so canvas text doesn't fall
//     back to a system font on first paint.
//   * Wait for document.fonts.ready, then Promise.all the requested data files.
//   * Hand the loaded values to onReady, then wire a debounced window-resize
//     listener that calls onResize only when the viewport actually changed.
//
// Each page still owns its chart factory construction, timeline-control wiring,
// and any page-specific toggles - this just removes the boilerplate they all share.

import * as ChartBase from "./chartBase.js";

export function bootstrapPage({ files, onReady, onResize, resizeDelay = 300 }) {
  const FF = "Encode Sans";
  [
    `normal 400 10px "${FF}"`,
    `italic 400 10px "${FF}"`,
    `normal 700 10px "${FF}"`,
    `italic 700 10px "${FF}"`,
  ].forEach((spec) => document.fonts.load(spec));

  document.fonts.ready.then(() => {
    const loads = files.map((f) => {
      const p = (f.type === "csv" ? d3.csv : d3.json)(f.path);
      return f.optional ? p.catch(() => []) : p;
    });
    Promise.all(loads).then((values) => {
      // Show a spinner, then defer the heavy computation to the next event loop
      // turn after a paint - this lets the browser render the spinner before
      // the synchronous force simulation ticks block the main thread.
      const chartContainer = document.getElementById("chart-container");
      const overlay =
        chartContainer && ChartBase.createLoadingOverlay(chartContainer);
      if (overlay) overlay.style.display = "flex";

      requestAnimationFrame(() =>
        setTimeout(() => {
          onReady(values);
          if (overlay) overlay.remove();

          let currentW = window.innerWidth;
          let currentH = window.innerHeight;
          let timer = null;
          window.addEventListener("resize", () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              if (
                window.innerWidth === currentW &&
                window.innerHeight === currentH
              )
                return;
              currentW = window.innerWidth;
              currentH = window.innerHeight;
              onResize();
            }, resizeDelay);
          });
        }, 0),
      );
    });
  });
}
