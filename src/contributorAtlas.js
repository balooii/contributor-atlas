// Public API - one function per visualization.
//
// Each function renders a view into a container element and wires up data
// loading, the timeline control, theme reactivity, and (when a <nav> exists)
// contributor search.
//
// Every view takes (container, options). The options are:
//
//   contributions  path/URL to contributions.csv (required)
//   project        path/URL to project.json (required)
//   highlights     path/URL to the highlights.csv (Pulse only, optional)
//   controls       element or CSS selector for the timeline-control container.
//                  Defaults to #controls if present, otherwise a <div> is
//                  created and inserted right after the chart container.
//   nav            element or CSS selector for the <nav> that hosts contributor
//                  search. Defaults to the page <nav>; pass null to opt out.
//                  Search is skipped when no nav is found.
//

import "./theme.js";
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

// Where the timeline control mounts. Prefers an explicit option (id #controls)
// or creates a new element right after chart.
function resolveControls(opts, chart) {
  const explicit = resolveEl(opts.controls);
  if (explicit) return explicit;
  const byId = document.getElementById("controls");
  if (byId) return byId;
  const el = document.createElement("div");
  el.id = "controls";
  chart.after(el);
  return el;
}

function resolveNav(opts) {
  if (opts.nav === null) return null;
  return resolveEl(opts.nav) || document.querySelector("nav");
}

export function gathering(container, options = {}) {
  const contributionsPath = requireOption(options, "contributions");
  const projectPath = requireOption(options, "project");
  const controls = resolveControls(options, container);
  const nav = resolveNav(options);

  const Visual = createGathering(container)
    .width(container.offsetWidth)
    .height(container.offsetHeight);

  bootstrapPage({
    container,
    files: [{ path: contributionsPath, type: "csv" }, { path: projectPath }],
    onReady: ([contributions, project]) => {
      Visual.project(project);
      const stored = createTimelineControl.loadRange();
      if (stored) Visual.setRange(stored.start, stored.end);
      Visual([contributions, project.category_colors, project.category_groups]);

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

      if (nav) createContributorSearch(nav, Visual, contributions);

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
  const controls = resolveControls(options, container);

  const Visual = createPulse(container);

  bootstrapPage({
    container,
    files: [
      { path: contributionsPath, type: "csv" },
      { path: options.highlights, type: "csv", optional: true },
      { path: projectPath },
    ],
    onReady: ([contributions, highlights, project]) => {
      const stored = createTimelineControl.loadRange();
      if (stored) Visual.setRange(stored.start, stored.end);
      Visual([contributions, highlights, project.category_colors]);
      createTimelineControl(controls)
        .chapters(project.chapters || [])
        .attach(Visual);
      Visual.resize();
    },
    onResize: () => Visual.resize(),
  });

  return Visual;
}

export function trails(container, options = {}) {
  const contributionsPath = requireOption(options, "contributions");
  const projectPath = requireOption(options, "project");
  const controls = resolveControls(options, container);
  const nav = resolveNav(options);

  const Visual = createTrails(container);

  bootstrapPage({
    container,
    files: [{ path: contributionsPath, type: "csv" }, { path: projectPath }],
    onReady: ([contributions, project]) => {
      const stored = createTimelineControl.loadRange();
      if (stored) Visual.setRange(stored.start, stored.end);
      Visual([contributions, project.category_colors, project.category_groups]);
      if (nav) createContributorSearch(nav, Visual, contributions);
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
  const controls = resolveControls(options, container);
  const nav = resolveNav(options);

  const Visual = createRipples(container)
    .width(container.offsetWidth)
    .height(container.offsetHeight);

  bootstrapPage({
    container,
    files: [{ path: contributionsPath, type: "csv" }, { path: projectPath }],
    onReady: ([contributions, project]) => {
      Visual.project(project);
      const stored = createTimelineControl.loadRange();
      if (stored) Visual.setRange(stored.start, stored.end);
      Visual([contributions, project.category_colors, project.category_groups]);
      createTimelineControl(controls)
        .chapters(project.chapters || [])
        .categories(true)
        .attach(Visual);
      if (nav) createContributorSearch(nav, Visual, contributions);
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
  const controls = resolveControls(options, container);
  const nav = resolveNav(options);

  const Visual = createCornerstones(container)
    .width(container.offsetWidth)
    .height(container.offsetHeight);

  bootstrapPage({
    container,
    files: [{ path: contributionsPath, type: "csv" }, { path: projectPath }],
    onReady: ([contributions, project]) => {
      Visual.project(project);
      const stored = createTimelineControl.loadRange();
      if (stored) Visual.setRange(stored.start, stored.end);
      Visual([contributions, project.category_colors, project.category_groups]);
      createTimelineControl(controls)
        .chapters(project.chapters || [])
        .categories(true)
        .attach(Visual);
      if (nav) createContributorSearch(nav, Visual, contributions);
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
