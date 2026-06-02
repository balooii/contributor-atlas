import * as d3 from "d3";

// -- Filters -----------------------------------------------------

export function filterByRange(rows, start, end) {
  if (start == null) return rows;
  return rows.filter((d) => {
    const ts = +d.timestamp;
    return ts >= start && ts <= end;
  });
}

// The [start, end] timeline-filter state every view shares. `set` returns
// true only when the range actually changed, so callers can guard their rerun.
// The default accessor reads `+d.timestamp` (for the raw CSV rows).
// Trails/Pulse overwrite it for their pre-mapped rows.
export function createRangeFilter() {
  let start = null,
    end = null;
  return {
    get start() {
      return start;
    },
    get end() {
      return end;
    },
    set(s, e) {
      const ns = s == null ? null : s;
      const ne = e == null ? null : e;
      if (ns === start && ne === end) return false;
      start = ns;
      end = ne;
      return true;
    },
    clear() {
      start = null;
      end = null;
    },
    filter(rows, ts = (d) => +d.timestamp) {
      if (start == null && end == null) return rows;
      return rows.filter((d) => {
        const t = ts(d);
        return (start == null || t >= start) && (end == null || t <= end);
      });
    },
  };
}

export function filterByCategory(rows, activeSet) {
  if (activeSet == null) return rows;
  return rows.filter((d) => activeSet.has(d.category));
}

// -- Aggregation -------------------------------------------------

// Roll up rows of `{contributor_id, contributor_name, category, timestamp, [...]}` into one record
// per contributor with totals, per-category breakdown, and first/last timestamp.
export function aggregateByContributor(rows) {
  const map = new Map();
  for (const d of rows) {
    const ts = +d.timestamp;
    const cat = d.category;
    let r = map.get(d.contributor_id);
    if (!r) {
      r = {
        contributor_id: d.contributor_id,
        contributor_name: d.contributor_name,
        total_contribution_count: 0,
        contribution_count_by_category: new Map(),
        contribution_sec_min: ts,
        contribution_sec_max: ts,
      };
      map.set(d.contributor_id, r);
    }
    r.total_contribution_count++;
    r.contribution_count_by_category.set(
      cat,
      (r.contribution_count_by_category.get(cat) || 0) + 1,
    );
    if (ts < r.contribution_sec_min) r.contribution_sec_min = ts;
    if (ts > r.contribution_sec_max) r.contribution_sec_max = ts;
  }
  return [...map.values()];
}

// Pick the dominant category by first finding the group with the highest
// aggregate count, then returning the top individual category within it.
export function dominantCategory(catCounts, catToGroup = {}) {
  const groupTotals = {};
  for (const [cat, n] of Object.entries(catCounts)) {
    const g = catToGroup[cat] ?? cat;
    groupTotals[g] = (groupTotals[g] || 0) + n;
  }
  const topGroup = Object.entries(groupTotals).sort(
    (a, b) => b[1] - a[1],
  )[0][0];
  return Object.entries(catCounts)
    .filter(([cat]) => (catToGroup[cat] ?? cat) === topGroup)
    .sort((a, b) => b[1] - a[1])[0][0];
}

// For each category in `rows`, returns { cat, count, pct } sorted by count desc.
export function categoryStats(rows) {
  if (!rows.length) return [];
  const m = new Map();
  for (const d of rows) m.set(d.category, (m.get(d.category) || 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, count]) => ({
      cat,
      count,
      pct: Math.round((count / rows.length) * 100),
    }));
}

// -- Tooltip -----------------------------------------------------

const _formatDigit = d3.format(",.2s");
const _formatDate = d3.timeFormat("%b %Y");

export function buildContributorTooltipHTML(
  d,
  { tooltip, categoryColor, accent, isProject = false },
) {
  const typeLabel = isProject ? "Project" : "Contributor";
  const name = d.data.contributor_name;
  const count = d.data.total_contribution_count;
  const countStr = count < 10 ? count : _formatDigit(count);

  let html = `<div class="ca-tt-accent-bar" style="background:${accent}"></div>`;
  html += `<div class="ca-tt-type-label" style="color:${accent}">${typeLabel}</div>`;
  html += `<div class="ca-tt-title">${tooltip.escapeHtml(name)}</div>`;
  let countLine = tooltip.pluralize(count, "contribution", countStr);
  if (isProject && d.data.contributor_count != null) {
    const cc = d.data.contributor_count;
    countLine += ` · ${tooltip.pluralize(cc, "contributor", _formatDigit(cc))}`;
  }
  html += `<div class="ca-tt-meta">${countLine}</div>`;

  if (
    !isProject &&
    d.data.contribution_sec_min &&
    d.data.contribution_sec_max
  ) {
    const mn = d.data.contribution_sec_min,
      mx = d.data.contribution_sec_max;
    const sameMonth =
      mn.getMonth() === mx.getMonth() && mn.getFullYear() === mx.getFullYear();
    const dateStr = sameMonth
      ? `In ${_formatDate(mn)}`
      : `Between ${_formatDate(mn)} &amp; ${_formatDate(mx)}`;
    html += `<div class="ca-tt-meta">${dateStr}</div>`;
  }

  if (d.data.contribution_count_by_category?.size > 0) {
    const sorted = [...d.data.contribution_count_by_category.entries()].sort(
      (a, b) => b[1] - a[1],
    );
    const total = sorted.reduce((s, [, v]) => s + v, 0);
    html += `<div class="ca-tt-section-label">Categories</div>`;
    sorted.forEach(([cat, cnt]) => {
      html += tooltip.categoryRow(
        cat,
        cnt,
        Math.round((cnt / total) * 100),
        categoryColor(cat),
      );
    });
  }
  return html;
}

// Position a node-anchored tooltip above/below the node, accounting for
// the chart's centered logical coordinate space + pixel-ratio scale factor.
export function showAnchoredTooltip(
  tooltip,
  html,
  d,
  { width, height, SF, pixelRatio, centerX = 0, centerY = 0 },
) {
  const edgeY = d.y + (d.y < 0 ? 1 : -1) * d.r;
  const cx = width / 2 + ((d.x - centerX) * SF) / pixelRatio;
  const cy = height / 2 + ((edgeY - centerY) * SF) / pixelRatio;
  tooltip.showAt(html, cx, cy, d.y < 0 ? "below" : "above");
}

// -- Shared chart init --------------------------------------------

// Parse the two-element values array that every cluster chart receives on
// first call: [contributions_csv_rows, categories_json_object].
// Returns the derived fields so each factory doesn't repeat this boilerplate.
export const parseDateUnix = d3.timeParse("%s");

export function parseChartValues(values) {
  const contributions = values[0];
  const catToGroup = values[2] || {};
  const FULL_MIN = d3.min(contributions, (d) => +d.timestamp);
  const FULL_MAX = d3.max(contributions, (d) => +d.timestamp);
  const cats = values[1];
  const scale_category_color = d3
    .scaleOrdinal()
    .domain(Object.keys(cats))
    .range(Object.values(cats));
  return {
    contributions,
    catToGroup,
    FULL_MIN,
    FULL_MAX,
    scale_category_color,
  };
}

// Map aggregated contributor records (from aggregateByContributor) into node objects.
export function buildNodes(aggregated, catToGroup) {
  return aggregated.map((d) => {
    const catCounts = Object.fromEntries(d.contribution_count_by_category);
    const dom =
      d.contribution_count_by_category.size > 0
        ? dominantCategory(catCounts, catToGroup)
        : null;
    return {
      data: {
        contributor_id: d.contributor_id,
        contributor_name: d.contributor_name,
        total_contribution_count: d.total_contribution_count,
        contribution_count_by_category: d.contribution_count_by_category,
        contribution_sec_min: parseDateUnix(String(d.contribution_sec_min)),
        contribution_sec_max: parseDateUnix(String(d.contribution_sec_max)),
      },
      first_ts: d.contribution_sec_min,
      count: d.total_contribution_count,
      dominant_cat: dom,
    };
  });
}

// Accumulate the per-category map and grand total across all contributor nodes.
export function buildCentralData(nodes) {
  const catMap = new Map();
  let total = 0;
  for (const n of nodes) {
    total += n.count;
    n.data.contribution_count_by_category.forEach((cnt, cat) => {
      catMap.set(cat, (catMap.get(cat) || 0) + cnt);
    });
  }
  return { catMap, total };
}

// Draw a soft radial halo around a node. Used by Cornerstones, Ripples, and Gathering.
//   innerR - optional override for the halo's inner edge (physical pixels already
//            multiplied by SF). When omitted, defaults to n.r * SF and the node dot
//            is redrawn on top. When provided, a donut arc is used so the area inside
//            innerR is left untouched (useful when a category ring sits between the
//            node edge and the halo).
function _bgIsDark(hex) {
  if (!hex || hex[0] !== "#") return true;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.5;
}

export function drawNodeHighlight(
  ctx,
  n,
  { SF, TAU, COLOR_BACKGROUND, innerR },
) {
  const cx = n.x * SF,
    cy = n.y * SF;
  const inner = innerR ?? n.r * SF;
  const outer = inner + 14 * SF;
  const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  const dark = _bgIsDark(COLOR_BACKGROUND);
  grad.addColorStop(0, dark ? "rgba(255,255,255,0.18)" : "#00000040");
  grad.addColorStop(1, dark ? "rgba(255,255,255,0.00)" : "#00000000");
  ctx.save();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, TAU);
  if (innerR != null) ctx.arc(cx, cy, inner, 0, TAU, true); // donut: leave inner area untouched
  ctx.fill();
  ctx.restore();
  if (innerR == null) {
    ctx.fillStyle = n.color;
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = COLOR_BACKGROUND;
    ctx.lineWidth = Math.max(1.5, n.r * 0.07) * SF;
    ctx.beginPath();
    ctx.arc(cx, cy, inner, 0, TAU);
    ctx.stroke();
  }
}

// -- Interaction -------------------------------------------------

// Draw the hover-state overlay for a round-cluster chart.
//   isCenterNode(d)        - true if d is the central project node
//   drawCenter(ctx, hovered) - redraws the full central node (circle + label) at
//                      origin, called within an already-translated context. The
//                      hovered flag is true only when the center node itself is hovered.
//   drawHighlight    - ChartBase.drawNodeHighlight bound with chart's SF/TAU/COLOR_BACKGROUND
// When a contributor is hovered: center stays bright, contributor gets the halo.
// When the center node is hovered: halo first (redraws the circle), then label on top.
export function drawClusterHoverState(
  ctx,
  d,
  { WIDTH, HEIGHT, isCenterNode, drawCenter, drawHighlight },
) {
  ctx.save();
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.translate(WIDTH / 2, HEIGHT / 2);
  if (isCenterNode(d)) {
    drawHighlight(ctx, d);
    drawCenter(ctx, true);
  } else {
    drawCenter(ctx, false);
    drawHighlight(ctx, d);
  }
  ctx.restore();
}

// Wire hover handler for the round-cluster charts onto canvas_hover.
// Returns { reset() } which clears state and the hover overlay between reruns.
export function wireInteraction(
  canvas_hover,
  {
    context_hover,
    canvas,
    tooltip,
    getSize,
    findNode,
    drawHoverState,
    showTooltip,
  },
) {
  let HOVER_ACTIVE = false,
    HOVERED_NODE = null;

  d3.select(canvas_hover).on("mousemove", function (event) {
    const [mx, my] = d3.pointer(event, this);
    const [d, FOUND] = findNode(mx, my);
    const { WIDTH, HEIGHT } = getSize();
    if (FOUND) {
      HOVER_ACTIVE = true;
      HOVERED_NODE = d;
      canvas.style.opacity = "0.25";
      drawHoverState(context_hover, d);
      showTooltip(d);
    } else {
      context_hover.clearRect(0, 0, WIDTH, HEIGHT);
      tooltip.hide();
      HOVER_ACTIVE = false;
      HOVERED_NODE = null;
      canvas.style.opacity = "1";
    }
  });

  d3.select(canvas_hover).on("mouseleave", function () {
    const { WIDTH, HEIGHT } = getSize();
    context_hover.clearRect(0, 0, WIDTH, HEIGHT);
    HOVER_ACTIVE = false;
    HOVERED_NODE = null;
    canvas.style.opacity = "1";
    tooltip.hide();
  });

  return {
    reset() {
      const { WIDTH, HEIGHT } = getSize();
      HOVER_ACTIVE = false;
      HOVERED_NODE = null;
      context_hover.clearRect(0, 0, WIDTH, HEIGHT);
      canvas.style.opacity = "1";
    },
  };
}

// -- Delaunay hit detection ----------------------------------
// Build a Delaunay index over node centers, used to find the nearest node to
// the mouse.
export const buildHitIndex = (nodes) =>
  d3.Delaunay.from(nodes.map((n) => [n.x, n.y]));

// Convert screen coords (CSS pixels) into the chart's logical space.
// WIDTH/HEIGHT are device pixels, SF the scale factor.
export const toLogical = (mx, my, { PIXEL_RATIO, WIDTH, HEIGHT, SF }) => [
  (mx * PIXEL_RATIO - WIDTH / 2) / SF,
  (my * PIXEL_RATIO - HEIGHT / 2) / SF,
];

// Nearest-node lookup in logical space. Returns [node, FOUND]
// FOUND is true when the cursor is within the node's radius plus pad.
export function pickNode(delaunay, nodes, lx, ly, pad) {
  if (!delaunay || nodes.length === 0) return [null, false];
  const d = nodes[delaunay.find(lx, ly)];
  if (!d) return [null, false];
  const dist = Math.hypot(d.x - lx, d.y - ly);
  return [d, dist < d.r + pad];
}

// Run the shared filter -> aggregate -> build-nodes pipeline used by all
// round-cluster charts. categoryStats is computed on the range-filtered rows
// (before the category filter) so pill counts reflect the full time window.
export function runPipeline(raw, rangeStart, rangeEnd, activeCats, catToGroup) {
  const rangeFiltered = filterByRange(raw, rangeStart, rangeEnd);
  const catFiltered = filterByCategory(rangeFiltered, activeCats);
  const nodes = buildNodes(aggregateByContributor(catFiltered), catToGroup);
  return { nodes, categoryStats: categoryStats(rangeFiltered) };
}

// -- Canvas trio -------------------------------------------------

// Create the base/click/hover canvas stack used by the round-cluster
// visualizations. Returns refs to the canvases and their 2d contexts.
export function createCanvasLayers(container, backgroundColor) {
  container.classList.add("ca-view");
  if (backgroundColor) container.style.backgroundColor = backgroundColor;

  const make = (className) => {
    const c = document.createElement("canvas");
    c.className = className;
    container.appendChild(c);
    return c;
  };

  const base = make("ca-canvas");
  const click = make("ca-canvas-click");
  const hover = make("ca-canvas-hover");

  return {
    base,
    baseCtx: base.getContext("2d"),
    click,
    clickCtx: click.getContext("2d"),
    hover,
    hoverCtx: hover.getContext("2d"),
  };
}

// Shared backing-store density for every canvas in the app. Floored at 2 so
// curves, diagonals and small text stay smooth even on 1x displays.
export function pixelRatio() {
  return Math.max(2, window.devicePixelRatio || 1);
}

// Size a single canvas to `width × height` CSS pixels at the shared pixel
// ratio, returning that ratio. Backing-store dimensions are rounded so a
// fractional ratio can't desync the canvas from its CSS box.
export function sizeCanvas(canvas, width, height) {
  const PR = pixelRatio();
  canvas.width = Math.round(width * PR);
  canvas.height = Math.round(height * PR);
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  return PR;
}

// Resize all three canvases to `width × height` CSS pixels, returning the
// device pixel ratio and the resulting backing-store dimensions.
export function sizeCanvasLayers(layers, width, height) {
  const PIXEL_RATIO = pixelRatio();
  const W = Math.round(width * PIXEL_RATIO);
  const H = Math.round(height * PIXEL_RATIO);
  for (const c of [layers.base, layers.click, layers.hover]) {
    c.width = W;
    c.height = H;
    c.style.width = `${width}px`;
    c.style.height = `${H / PIXEL_RATIO}px`;
  }
  for (const ctx of [layers.baseCtx, layers.clickCtx, layers.hoverCtx]) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
  }
  return { PIXEL_RATIO, WIDTH: W, HEIGHT: H };
}

// -- Font / text -------------------------------------------------

export function setFont(ctx, family, size, weight = 400, style = "normal") {
  ctx.font = `${weight} ${style} ${size}px ${family}`;
}

// Manual letter-spaced text rendering - Canvas2D has no native letterSpacing.
// Respects the context's current textAlign.
export function renderText(ctx, text, x, y, letterSpacing = 0, stroke = false) {
  const chars = String.prototype.split.call(text, "");
  const align = ctx.textAlign;
  let total = 0;
  for (let i = 0; i < chars.length; i++)
    total += ctx.measureText(chars[i]).width + letterSpacing;

  let pos = x;
  if (align === "right") pos = x - total;
  else if (align === "center") pos = x - total / 2;

  ctx.textAlign = "left";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (stroke) ctx.strokeText(ch, pos, y);
    ctx.fillText(ch, pos, y);
    pos += ctx.measureText(ch).width + letterSpacing;
  }
  ctx.textAlign = align;
}

export function createLoadingOverlay(container) {
  const el = document.createElement("div");
  el.className = "ca-loading-overlay";
  el.innerHTML = '<div class="ca-loading-spinner"></div>';
  el.style.display = "none";
  container.appendChild(el);
  return el;
}

export function loadProjectImage(url, onLoad) {
  const img = new Image();
  img.onload = () => onLoad(img);
  img.onerror = () => onLoad(null);
  img.src = url;
}

// Draw the project logo (if loaded) or name text centered at (cx, cy) inside
// a circle of pixel-radius r. Clips to the circle when drawing the logo.
export function drawProjectNodeContent(
  ctx,
  {
    cx,
    cy,
    r,
    name,
    logoImage,
    COLOR_TEXT,
    FONT_FAMILY,
    fontSize,
    letterSpacing,
  },
) {
  if (logoImage) {
    // Fit the logo inside a square box, preserving its aspect ratio.
    const box = r * 1.2;
    const iw = logoImage.naturalWidth || logoImage.width;
    const ih = logoImage.naturalHeight || logoImage.height;
    const scale = box / Math.max(iw, ih);
    const w = iw * scale;
    const h = ih * scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logoImage, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
  } else {
    setFont(ctx, FONT_FAMILY, fontSize, 700, "normal");
    ctx.fillStyle = COLOR_TEXT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    renderText(ctx, name, cx, cy, letterSpacing);
  }
}

// Factory for the pulsing selection highlight drawn on the click canvas.
// Returns { draw, cancel, restart }.
//   draw()    - start animation if not already running (idempotent)
//   cancel()  - stop any running animation frame
//   restart() - cancel then draw (use after a node change or forced redraw)
//
// Required options:
//   context_click - the click-layer 2d context
//   getState()    - returns { WIDTH, HEIGHT, SF, COLOR_HIGHLIGHT, TAU }
//   getNode()     - returns the currently selected node, or null
//
// Optional (Overrides to handle Cornerstone's top-contributor ring highlights):
//   getBaseR(node, SF)       - outer radius to ring around
//   getPulseReach(baseR, SF) - how far the pulse expands
export function makeSelectionHighlight({
  context_click,
  getState,
  getNode,
  getBaseR,
  getPulseReach,
}) {
  const CYCLE = 1600;
  let _frame = null;

  const _baseR =
    getBaseR ||
    function (n, SF) {
      return n.r * SF;
    };
  const _reach =
    getPulseReach ||
    function (baseR) {
      return Math.max(50, baseR * 1.5);
    };

  function draw() {
    if (_frame !== null) return;
    const { WIDTH, HEIGHT } = getState();
    context_click.clearRect(0, 0, WIDTH, HEIGHT);
    if (!getNode()) return;

    function frame(ts) {
      _frame = null;
      const { WIDTH, HEIGHT, SF, COLOR_HIGHLIGHT, TAU } = getState();
      const n = getNode();
      if (!n) {
        context_click.clearRect(0, 0, WIDTH, HEIGHT);
        return;
      }
      const t = (ts % CYCLE) / CYCLE;
      const BASE_R = _baseR(n, SF);
      const PULSE_REACH = _reach(BASE_R, SF);

      context_click.clearRect(0, 0, WIDTH, HEIGHT);
      context_click.save();
      context_click.translate(WIDTH / 2, HEIGHT / 2);

      context_click.strokeStyle = COLOR_HIGHLIGHT;
      context_click.lineWidth = Math.max(2, 2 * SF);
      context_click.beginPath();
      context_click.arc(n.x * SF, n.y * SF, BASE_R + 3 * SF, 0, TAU);
      context_click.stroke();

      context_click.globalAlpha = (1 - t) * 0.7;
      context_click.strokeStyle = COLOR_HIGHLIGHT;
      context_click.lineWidth = 3;
      context_click.beginPath();
      context_click.arc(n.x * SF, n.y * SF, BASE_R + PULSE_REACH * t, 0, TAU);
      context_click.stroke();
      context_click.globalAlpha = 1;

      context_click.restore();
      _frame = requestAnimationFrame(frame);
    }

    _frame = requestAnimationFrame(frame);
  }

  function cancel() {
    if (_frame !== null) {
      cancelAnimationFrame(_frame);
      _frame = null;
    }
  }

  function restart() {
    cancel();
    draw();
  }

  return { draw, cancel, restart };
}
