import * as d3 from "d3";
import { createTooltip } from "./createTooltip.js";
import * as ChartBase from "./chartBase.js";

export function createPulse(container) {
  container.classList.add("ca-view");

  let COLOR_BACKGROUND, COLOR_LINK, COLOR_TEXT, COLOR_HIGHLIGHT;
  let FONT_FAMILY;
  function readColors() {
    const cs = getComputedStyle(container);
    COLOR_BACKGROUND = cs.getPropertyValue("--c-bg").trim();
    COLOR_LINK = cs.getPropertyValue("--c-border").trim();
    COLOR_TEXT = cs.getPropertyValue("--c-text").trim();
    COLOR_HIGHLIGHT = cs.getPropertyValue("--c-highlight").trim();
    FONT_FAMILY = cs.getPropertyValue("--font-family").trim();
  }
  readColors();
  const MARGIN = { top: 30, right: 30, bottom: 52, left: 68 };

  let categoryColor = d3.scaleOrdinal();

  let raw_contributions = [],
    highlights_data = [];
  const range = ChartBase.createRangeFilter();
  let FULL_MIN, FULL_MAX;
  let W, H, PR;

  const canvas = document.createElement("canvas");
  canvas.className = "ca-activity-canvas";
  const ctx = canvas.getContext("2d");
  container.appendChild(canvas);

  const tooltip = createTooltip(container);

  let _draw = null; // { data, interval, xScale, cW, cH, visibleHighlights } - for hover hit-testing
  let _hoveredBucket = null; // currently hovered data row, dims all other bars
  let _hoveredHighlight = null; // currently hovered highlight

  function sizeCanvas() {
    W = container.offsetWidth;
    H = container.offsetHeight;
    PR = ChartBase.sizeCanvas(canvas, W, H);
  }

  function pickBucket() {
    const days = (FULL_MAX - FULL_MIN) / 86400;
    if (days <= 120) return d3.timeDay;
    if (days <= 730) return d3.timeWeek;
    return d3.timeMonth;
  }

  function aggregateByBucket(contributions) {
    const interval = pickBucket();
    if (!contributions.length) return { data: [], interval };
    const byBucket = d3.rollup(
      contributions,
      (v) => {
        const counts = {};
        const contributors = new Set();
        v.forEach((c) => {
          counts[c.cat] = (counts[c.cat] || 0) + 1;
          contributors.add(c.contributor);
        });
        return { counts, contributors: contributors.size };
      },
      (d) => interval.floor(new Date(d.ts * 1000)).getTime(),
    );
    const data = Array.from(byBucket, ([t, { counts, contributors }]) => ({
      date: new Date(+t),
      counts,
      contributors,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    })).sort((a, b) => a.date - b.date);
    return { data, interval };
  }

  function drawChart({ data, interval }) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(PR, PR);

    ctx.fillStyle = COLOR_BACKGROUND;
    ctx.fillRect(0, 0, W, H);

    if (!data.length) {
      _draw = null;
      ctx.restore();
      return;
    }

    const cW = W - MARGIN.left - MARGIN.right;
    const cH = H - MARGIN.top - MARGIN.bottom;

    const xScale = d3
      .scaleTime()
      .domain([data[0].date, interval.offset(data[data.length - 1].date, 1)])
      .range([MARGIN.left, MARGIN.left + cW]);

    _draw = { data, interval, xScale, cW, cH };

    const yScale = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d.total) * 1.08])
      .range([MARGIN.top + cH, MARGIN.top])
      .nice();

    // Y gridlines + labels
    ctx.font = `11px ${FONT_FAMILY}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    yScale.ticks(6).forEach((t) => {
      const y = yScale(t);
      ctx.beginPath();
      ctx.moveTo(MARGIN.left, y);
      ctx.lineTo(MARGIN.left + cW, y);
      ctx.strokeStyle = COLOR_LINK;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLOR_TEXT;
      ctx.fillText(t, MARGIN.left - 10, y);
    });

    // X axis ticks + labels
    const tickCount = cW > 900 ? 10 : cW > 600 ? 7 : 5;
    ctx.font = `10px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const fmt = xScale.tickFormat(tickCount);
    xScale.ticks(tickCount).forEach((t) => {
      const x = xScale(t);
      ctx.beginPath();
      ctx.moveTo(x, MARGIN.top + cH);
      ctx.lineTo(x, MARGIN.top + cH + 4);
      ctx.strokeStyle = COLOR_TEXT;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = COLOR_TEXT;
      ctx.fillText(fmt(t), x, MARGIN.top + cH + 7);
      ctx.globalAlpha = 1;
    });

    // Axis border
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, MARGIN.top);
    ctx.lineTo(MARGIN.left, MARGIN.top + cH);
    ctx.lineTo(MARGIN.left + cW, MARGIN.top + cH);
    ctx.strokeStyle = COLOR_TEXT;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.25;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Stacked bars (one segment per category, in _categoryOrder bottom -> top)
    data.forEach((d) => {
      const x0 = xScale(d.date);
      const x1 = xScale(interval.offset(d.date, 1));
      const gap = Math.min(1, (x1 - x0) * 0.1);
      const w = Math.max(1, x1 - x0 - gap);
      ctx.globalAlpha = _hoveredBucket && d !== _hoveredBucket ? 0.55 : 1;
      let cumulative = 0;
      categoryColor.domain().forEach((cat) => {
        const v = d.counts[cat] || 0;
        if (!v) return;
        const yBottom = yScale(cumulative);
        const yTop = yScale(cumulative + v);
        ctx.fillStyle = categoryColor(cat);
        ctx.fillRect(x0 + gap / 2, yTop, w, yBottom - yTop);
        cumulative += v;
      });
    });
    ctx.globalAlpha = 1;

    // Highlight lines / rug strip
    const [xMin, xMax] = xScale.domain();
    const visibleHighlights = highlights_data
      .map((h) => ({ h, d: new Date(h.ts * 1000) }))
      .filter(({ d }) => d >= xMin && d <= xMax)
      .map(({ h, d }) => ({ h, x: xScale(d) }))
      .sort((a, b) => a.x - b.x);

    const axisY = MARGIN.top + cH;
    const DENSITY_THRESHOLD = 25;
    const rugMode = visibleHighlights.length > DENSITY_THRESHOLD;
    _draw.visibleHighlights = visibleHighlights;
    _draw.axisY = axisY;
    _draw.rugMode = rugMode;

    if (rugMode) {
      visibleHighlights.forEach(({ h, x }) => {
        const hovered = h === _hoveredHighlight;
        if (hovered) {
          ctx.beginPath();
          ctx.moveTo(x, MARGIN.top);
          ctx.lineTo(x, axisY);
          ctx.strokeStyle = COLOR_HIGHLIGHT;
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.22;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(x, axisY);
        ctx.lineTo(x, axisY + (hovered ? 10 : 6));
        ctx.strokeStyle = COLOR_HIGHLIGHT;
        ctx.lineWidth = hovered ? 2 : 1;
        ctx.globalAlpha = hovered ? 0.95 : 0.55;
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    } else {
      const LABEL_H = 9;
      let lastLabelX = -Infinity;
      visibleHighlights.forEach(({ h, x }) => {
        const hovered = h === _hoveredHighlight;
        ctx.beginPath();
        ctx.moveTo(x, MARGIN.top);
        ctx.lineTo(x, axisY);
        ctx.strokeStyle = COLOR_HIGHLIGHT;
        ctx.lineWidth = hovered ? 2 : 1;
        ctx.globalAlpha = hovered ? 0.75 : 0.35;
        ctx.stroke();
        ctx.globalAlpha = 1;

        if (hovered || x - lastLabelX > LABEL_H + 5) {
          ctx.save();
          ctx.translate(x - 6, MARGIN.top + cH * 0.5);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = `9px ${FONT_FAMILY}`;
          ctx.fillStyle = COLOR_HIGHLIGHT;
          ctx.globalAlpha = hovered ? 1 : 0.6;
          ctx.fillText(h.name, 0, 0);
          ctx.restore();
          if (!hovered) lastLabelX = x;
        }
      });
    }

    ctx.restore();
  }

  function rerun() {
    tooltip.hide();
    _hoveredBucket = null;
    _hoveredHighlight = null;
    drawChart(aggregateByBucket(range.filter(raw_contributions, (d) => d.ts)));
  }

  function findBucket(mouseX, mouseY) {
    if (!_draw) return null;
    if (mouseX < MARGIN.left || mouseX > MARGIN.left + _draw.cW) return null;
    if (mouseY < MARGIN.top || mouseY > MARGIN.top + _draw.cH) return null;
    const date = _draw.xScale.invert(mouseX);
    for (const d of _draw.data) {
      if (date >= d.date && date < _draw.interval.offset(d.date, 1)) return d;
    }
    return null;
  }

  function findHighlight(x, y) {
    if (!_draw || !_draw.visibleHighlights) return null;
    const yMin = _draw.rugMode ? _draw.axisY - 2 : MARGIN.top;
    if (y < yMin || y > _draw.axisY + 12) return null;
    const HIT_RADIUS = 6;
    let closest = null,
      closestDist = Infinity;
    for (const vh of _draw.visibleHighlights) {
      const dist = Math.abs(x - vh.x);
      if (dist < HIT_RADIUS && dist < closestDist) {
        closest = vh.h;
        closestDist = dist;
      }
    }
    return closest;
  }

  function showHighlightTooltip(h, clientX, clientY) {
    const dateStr = d3.timeFormat("%b %-d, %Y")(new Date(h.ts * 1000));
    tooltip.show(
      `<div class="tt-title">${tooltip.escapeHtml(h.name)}</div>` +
        `<div class="tt-meta">${dateStr}</div>`,
      clientX,
      clientY,
    );
  }

  function applyHover(newBucket, newHighlight) {
    const changed =
      newBucket !== _hoveredBucket || newHighlight !== _hoveredHighlight;
    _hoveredBucket = newBucket;
    _hoveredHighlight = newHighlight;
    if (changed && _draw)
      drawChart({ data: _draw.data, interval: _draw.interval });
  }

  function bucketLabel(date) {
    const interval = _draw.interval;
    if (interval === d3.timeDay) return d3.timeFormat("%b %-d, %Y")(date);
    if (interval === d3.timeWeek) {
      const end = d3.timeDay.offset(d3.timeWeek.offset(date, 1), -1);
      return `${d3.timeFormat("%b %-d")(date)} – ${d3.timeFormat("%b %-d, %Y")(end)}`;
    }
    return d3.timeFormat("%B %Y")(date);
  }

  function showTooltip(d, clientX, clientY) {
    const total = d.total;
    let html = `<div class="tt-title">${bucketLabel(d.date)}</div>`;
    html += `<div class="tt-meta">${tooltip.pluralize(total, "contribution")} · ${tooltip.pluralize(d.contributors, "contributor")}</div>`;
    html += tooltip.categoryRows(
      categoryColor.domain(),
      d.counts,
      total,
      categoryColor,
    );
    tooltip.show(html, clientX, clientY);
  }

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const h = findHighlight(x, y);
    if (h) {
      applyHover(null, h);
      showHighlightTooltip(h, e.clientX, e.clientY);
      return;
    }
    const d = findBucket(x, y);
    applyHover(d, null);
    if (d) showTooltip(d, e.clientX, e.clientY);
    else tooltip.hide();
  });
  canvas.addEventListener("mouseleave", () => {
    tooltip.hide();
    applyHover(null, null);
  });

  const chart = (values) => {
    raw_contributions = values[0].map((d) => ({
      ts: +d.timestamp,
      cat: d.category,
      contributor: d.contributor_id,
    }));
    highlights_data = (values[1] || []).map((d) => ({
      name: d.name,
      ts: Date.parse(d.timestamp + "T12:00:00Z") / 1000,
    }));
    FULL_MIN = d3.min(raw_contributions, (d) => d.ts);
    FULL_MAX = d3.max(raw_contributions, (d) => d.ts);

    const cats = values[2];
    categoryColor = d3
      .scaleOrdinal()
      .domain(Object.keys(cats))
      .range(Object.values(cats));
    sizeCanvas();
    rerun();
    return chart;
  };

  chart.fullDateRange = () => [FULL_MIN, FULL_MAX];
  chart.setRange = (start, end) => {
    if (range.set(start, end) && raw_contributions.length) rerun();
    return chart;
  };
  chart.resize = () => {
    sizeCanvas();
    rerun();
    return chart;
  };

  window.addEventListener("themechange", () => {
    readColors();
    rerun();
  });

  return chart;
}
