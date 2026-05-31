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
//   timeline       whether to render the timeline/category-filter control.
//                  Defaults to true.
//   controls       element or CSS selector for the timeline-control container.
//                  Defaults to #controls if present, otherwise a <div> is
//                  created and inserted right after the chart container.
//   search         element or CSS selector to render contributor search into.
//                  The caller owns this element and its placement. Omit to skip
//                  search entirely.
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

function timelineEnabled(opts) {
  return opts.timeline !== false;
}

// Where the timeline control mounts. Prefers an explicit option, then a
// page-level #controls, otherwise a fresh element inserted right after the
// chart.
function resolveControls(opts, chart) {
  const explicit = resolveEl(opts.controls);
  if (explicit) return explicit;
  const byId = document.getElementById("controls");
  if (byId) return byId;
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
  const showTimeline = timelineEnabled(options);
  const controls = showTimeline ? resolveControls(options, container) : null;
  const search = resolveSearch(options);

  const Visual = createGathering(container)
    .width(container.offsetWidth)
    .height(container.offsetHeight);

  bootstrapPage({
    container,
    files: [{ path: contributionsPath, type: "csv" }, { path: projectPath }],
    onReady: ([contributions, project]) => {
      Visual.project(project);
      if (showTimeline) {
        const stored = createTimelineControl.loadRange();
        if (stored) Visual.setRange(stored.start, stored.end);
      }
      Visual([contributions, project.category_colors, project.category_groups]);

      if (showTimeline) {
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
  const showTimeline = timelineEnabled(options);
  const controls = showTimeline ? resolveControls(options, container) : null;

  const Visual = createPulse(container);

  bootstrapPage({
    container,
    files: [
      { path: contributionsPath, type: "csv" },
      { path: options.highlights, type: "csv", optional: true },
      { path: projectPath },
    ],
    onReady: ([contributions, highlights, project]) => {
      if (showTimeline) {
        const stored = createTimelineControl.loadRange();
        if (stored) Visual.setRange(stored.start, stored.end);
      }
      Visual([contributions, highlights, project.category_colors]);
      if (showTimeline) {
        createTimelineControl(controls)
          .chapters(project.chapters || [])
          .attach(Visual);
      }
      Visual.resize();
    },
    onResize: () => Visual.resize(),
  });

  return Visual;
}

export function trails(container, options = {}) {
  const contributionsPath = requireOption(options, "contributions");
  const projectPath = requireOption(options, "project");
  const showTimeline = timelineEnabled(options);
  const controls = showTimeline ? resolveControls(options, container) : null;
  const search = resolveSearch(options);

  const Visual = createTrails(container);

  bootstrapPage({
    container,
    files: [{ path: contributionsPath, type: "csv" }, { path: projectPath }],
    onReady: ([contributions, project]) => {
      if (showTimeline) {
        const stored = createTimelineControl.loadRange();
        if (stored) Visual.setRange(stored.start, stored.end);
      }
      Visual([contributions, project.category_colors, project.category_groups]);
      if (search) createContributorSearch(search, Visual, contributions);
      if (showTimeline) {
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
    onResize: () => Visual.resize(),
    resizeDelay: 200,
  });

  return Visual;
}

export function ripples(container, options = {}) {
  const contributionsPath = requireOption(options, "contributions");
  const projectPath = requireOption(options, "project");
  const showTimeline = timelineEnabled(options);
  const controls = showTimeline ? resolveControls(options, container) : null;
  const search = resolveSearch(options);

  const Visual = createRipples(container)
    .width(container.offsetWidth)
    .height(container.offsetHeight);

  bootstrapPage({
    container,
    files: [{ path: contributionsPath, type: "csv" }, { path: projectPath }],
    onReady: ([contributions, project]) => {
      Visual.project(project);
      if (showTimeline) {
        const stored = createTimelineControl.loadRange();
        if (stored) Visual.setRange(stored.start, stored.end);
      }
      Visual([contributions, project.category_colors, project.category_groups]);
      if (showTimeline) {
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
  const showTimeline = timelineEnabled(options);
  const controls = showTimeline ? resolveControls(options, container) : null;
  const search = resolveSearch(options);

  const Visual = createCornerstones(container)
    .width(container.offsetWidth)
    .height(container.offsetHeight);

  bootstrapPage({
    container,
    files: [{ path: contributionsPath, type: "csv" }, { path: projectPath }],
    onReady: ([contributions, project]) => {
      Visual.project(project);
      if (showTimeline) {
        const stored = createTimelineControl.loadRange();
        if (stored) Visual.setRange(stored.start, stored.end);
      }
      Visual([contributions, project.category_colors, project.category_groups]);
      if (showTimeline) {
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
    onResize: () =>
      Visual.width(container.offsetWidth)
        .height(container.offsetHeight)
        .resize(),
  });

  return Visual;
}
