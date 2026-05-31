// Public API - one function per visualization.
//
// Each function renders a view into a container element and wires up data
// loading, the timeline control, theme reactivity, and (when a search element
// is provided) contributor search.
//
// Every view takes (container, options). The options are:
//
//   contributions  path/URL to contributions.csv (required)
//   project        path/URL to project.json (required)
//   highlights     path/URL to the highlights.csv (Pulse only, optional)
//   enableControls whether to render the timeline/category-filter control.
//                  if enabled we show it just below the chart.
//                  Defaults to true.
//   search         element or CSS selector to render contributor search into.
//                  The caller owns this element and its placement. Omit to skip
//                  search entirely.
//   onReady        optional callback fired with the chart instance once the view
//                  has rendered and the spinner is gone.
//

export { mountThemePicker, notifyThemeChange } from "./theme.js";
import { bootstrapPage } from "./pageBootstrap.js";
import { createTimelineControl } from "./createTimelineControl.js";
import { createContributorSearch } from "./createContributorSearch.js";
import { createGathering } from "./createGathering.js";
import { createPulse } from "./createPulse.js";
import { createTrails } from "./createTrails.js";
import { createRipples } from "./createRipples.js";
import { createCornerstones } from "./createCornerstones.js";

function requireOption(options, key) {
  const value = options[key];
  if (!value)
    throw new Error(`contributorAtlas: missing required option "${key}"`);
  return value;
}

function resolveEl(ref) {
  if (!ref) return null;
  return typeof ref === "string" ? document.querySelector(ref) : ref;
}

function controlsEnabled(opts) {
  return opts.enableControls !== false;
}

function createControlsContainer(chart) {
  const el = document.createElement("div");
  chart.after(el);
  return el;
}

function resolveSearch(opts) {
  return resolveEl(opts.search);
}

export function gathering(container, options = {}) {
  const contributionsPath = requireOption(options, "contributions");
  const projectPath = requireOption(options, "project");
  const showControls = controlsEnabled(options);
  const controls = showControls ? createControlsContainer(container) : null;
  const search = resolveSearch(options);

  const Visual = createGathering(container)
    .width(container.offsetWidth)
    .height(container.offsetHeight);

  bootstrapPage({
    container,
    files: [{ path: contributionsPath, type: "csv" }, { path: projectPath }],
    render: ([contributions, project]) => {
      Visual.project(project);
      if (showControls) {
        const stored = createTimelineControl.loadRange();
        if (stored) Visual.setRange(stored.start, stored.end);
      }
      Visual([contributions, project.category_colors, project.category_groups]);

      if (showControls) {
        const layoutControl = createTimelineControl.buildButtonGroup(
          "layout",
          [
            { label: "random", value: "random" },
            { label: "sorted", value: "sorted" },
          ],
          Visual.layout(),
          (v) => Visual.layout(v),
        );
        createTimelineControl(controls)
          .chapters(project.chapters || [])
          .categories(true)
          .extras(layoutControl)
          .attach(Visual);
      }

      if (search) createContributorSearch(search, Visual, contributions);

      Visual.width(container.offsetWidth)
        .height(container.offsetHeight)
        .resize();
    },
    onReady: () => options.onReady?.(Visual),
    onResize: () =>
      Visual.width(container.offsetWidth)
        .height(container.offsetHeight)
        .resize(),
  });

  return Visual;
}

export function pulse(container, options = {}) {
  const contributionsPath = requireOption(options, "contributions");
  const projectPath = requireOption(options, "project");
  const showControls = controlsEnabled(options);
  const controls = showControls ? createControlsContainer(container) : null;

  const Visual = createPulse(container);

  bootstrapPage({
    container,
    files: [
      { path: contributionsPath, type: "csv" },
      { path: options.highlights, type: "csv", optional: true },
      { path: projectPath },
    ],
    render: ([contributions, highlights, project]) => {
      if (showControls) {
        const stored = createTimelineControl.loadRange();
        if (stored) Visual.setRange(stored.start, stored.end);
      }
      Visual([contributions, highlights, project.category_colors]);
      if (showControls) {
        createTimelineControl(controls)
          .chapters(project.chapters || [])
          .attach(Visual);
      }
      Visual.resize();
    },
    onReady: () => options.onReady?.(Visual),
    onResize: () => Visual.resize(),
  });

  return Visual;
}

export function trails(container, options = {}) {
  const contributionsPath = requireOption(options, "contributions");
  const projectPath = requireOption(options, "project");
  const showControls = controlsEnabled(options);
  const controls = showControls ? createControlsContainer(container) : null;
  const search = resolveSearch(options);

  const Visual = createTrails(container);

  bootstrapPage({
    container,
    files: [{ path: contributionsPath, type: "csv" }, { path: projectPath }],
    render: ([contributions, project]) => {
      if (showControls) {
        const stored = createTimelineControl.loadRange();
        if (stored) Visual.setRange(stored.start, stored.end);
      }
      Visual([contributions, project.category_colors, project.category_groups]);
      if (search) createContributorSearch(search, Visual, contributions);
      if (showControls) {
        const sortControl = createTimelineControl.buildButtonGroup(
          "sort",
          [
            { label: "contributions", value: "count" },
            { label: "first seen", value: "first" },
            { label: "longest career 🌳", value: "career" },
          ],
          "count",
          (v) => Visual.setSortBy(v),
        );
        createTimelineControl(controls)
          .chapters(project.chapters || [])
          .extras([sortControl, createTimelineControl.buildZoomHint(Visual)])
          .attach(Visual);
      }
      Visual.resize();
    },
    onReady: () => options.onReady?.(Visual),
    onResize: () => Visual.resize(),
    resizeDelay: 200,
  });

  return Visual;
}

export function ripples(container, options = {}) {
  const contributionsPath = requireOption(options, "contributions");
  const projectPath = requireOption(options, "project");
  const showControls = controlsEnabled(options);
  const controls = showControls ? createControlsContainer(container) : null;
  const search = resolveSearch(options);

  const Visual = createRipples(container)
    .width(container.offsetWidth)
    .height(container.offsetHeight);

  bootstrapPage({
    container,
    files: [{ path: contributionsPath, type: "csv" }, { path: projectPath }],
    render: ([contributions, project]) => {
      Visual.project(project);
      if (showControls) {
        const stored = createTimelineControl.loadRange();
        if (stored) Visual.setRange(stored.start, stored.end);
      }
      Visual([contributions, project.category_colors, project.category_groups]);
      if (showControls) {
        createTimelineControl(controls)
          .chapters(project.chapters || [])
          .categories(true)
          .attach(Visual);
      }
      if (search) createContributorSearch(search, Visual, contributions);
      Visual.width(container.offsetWidth)
        .height(container.offsetHeight)
        .resize();
    },
    onReady: () => options.onReady?.(Visual),
    onResize: () =>
      Visual.width(container.offsetWidth)
        .height(container.offsetHeight)
        .resize(),
  });

  return Visual;
}

export function cornerstones(container, options = {}) {
  const contributionsPath = requireOption(options, "contributions");
  const projectPath = requireOption(options, "project");
  const showControls = controlsEnabled(options);
  const controls = showControls ? createControlsContainer(container) : null;
  const search = resolveSearch(options);

  const Visual = createCornerstones(container)
    .width(container.offsetWidth)
    .height(container.offsetHeight);

  bootstrapPage({
    container,
    files: [{ path: contributionsPath, type: "csv" }, { path: projectPath }],
    render: ([contributions, project]) => {
      Visual.project(project);
      if (showControls) {
        const stored = createTimelineControl.loadRange();
        if (stored) Visual.setRange(stored.start, stored.end);
      }
      Visual([contributions, project.category_colors, project.category_groups]);
      if (showControls) {
        createTimelineControl(controls)
          .chapters(project.chapters || [])
          .categories(true)
          .attach(Visual);
      }
      if (search) createContributorSearch(search, Visual, contributions);
      Visual.width(container.offsetWidth)
        .height(container.offsetHeight)
        .resize();
      // Cornerstone places remaining scatter nodes asynchronously, communicated
      // as whenReady()
      return Visual.whenReady();
    },
    onReady: () => options.onReady?.(Visual),
    onResize: () =>
      Visual.width(container.offsetWidth)
        .height(container.offsetHeight)
        .resize(),
  });

  return Visual;
}
