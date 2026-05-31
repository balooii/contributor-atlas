import * as d3 from "d3";
import { createTooltip } from "./createTooltip.js";
import * as ChartBase from "./chartBase.js";

export function createTrails(container) {
  let COLOR_BACKGROUND,
    COLOR_TEXT,
    COLOR_LINK,
    COLOR_GRID,
    COLOR_ROW_ALT,
    COLOR_ROW_HOVER,
    COLOR_ACCENT;
  let FONT_FAMILY;
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    COLOR_BACKGROUND = cs.getPropertyValue("--c-bg").trim();
    COLOR_TEXT = cs.getPropertyValue("--c-text").trim();
    COLOR_LINK = cs.getPropertyValue("--c-border").trim();
    COLOR_GRID = cs.getPropertyValue("--c-grid").trim();
    COLOR_ROW_ALT = cs.getPropertyValue("--c-row-alt").trim();
    COLOR_ROW_HOVER = cs.getPropertyValue("--c-row-hover").trim();
    COLOR_ACCENT = cs.getPropertyValue("--accent").trim();
    FONT_FAMILY = cs.getPropertyValue("--font-family").trim();
  }
  readColors();

  const HEADER_HEIGHT = 32;
  const LABEL_WIDTH_DEFAULT = 200;
  const LABEL_WIDTH_CAREER = 260;
  let LABEL_WIDTH = LABEL_WIDTH_DEFAULT;
  const ROW_HEIGHT = 22;
  const SEGMENT_THICKNESS = 7;
  const MIN_SEGMENT_WIDTH = 4;
  const GAP_THRESHOLD_DAYS = 45;
  const TARGET_PX_PER_DAY = 1.6;
  const X_PAD = 24;
  const MAX_ZOOM = 60;
  const ZOOM_SENSITIVITY = 0.0025;

  let _catScale = d3.scaleOrdinal();
  const categoryColor = (cat) => _catScale(cat);

  let raw_contributions = [];
  let contributors = [];
  let FULL_MIN, FULL_MAX;
  let PR = 1;
  let viewportW = 0,
    viewportH = 0;
  let virtualW = 0,
    virtualH = 0;
  let scrollLeft = 0,
    scrollTop = 0;
  let xScale = null;
  let _hover = null;
  let zoomLevel = 0;
  let minZoom = 0.001;
  let isZoomed = false;
  let sortBy = "count"; // "count" | "first" | "career"
  let RANGE_START = null;
  let RANGE_END = null;
  let _selectedId = null;
  let _animFrame = null;
  const ANIM_CYCLE = 1600;

  // -- DOM -------------------------------------------------------------
  container.classList.add("ca-view", "ca-trails");

  const corner = document.createElement("div");
  corner.className = "trails-corner";
  corner.style.width = LABEL_WIDTH + "px";
  corner.style.height = HEADER_HEIGHT + "px";
  container.appendChild(corner);

  function updateCornerStats() {
    const totalContribs = contributors.reduce((s, c) => s + c.total, 0);
    corner.innerHTML =
      `<span class="trails-corner-primary">${contributors.length.toLocaleString()} contributors</span>` +
      `<span class="trails-corner-secondary">${totalContribs.toLocaleString()} contributions</span>`;
  }

  // Each layer's presentation is in styles.css; only the geometry that depends
  // on LABEL_WIDTH / HEADER_HEIGHT is set here (and kept in sync by
  // applyLabelWidth / setupScales).
  const headerCanvas = document.createElement("canvas");
  headerCanvas.className = "trails-header";
  headerCanvas.style.left = LABEL_WIDTH + "px";
  container.appendChild(headerCanvas);

  const labelsCanvas = document.createElement("canvas");
  labelsCanvas.className = "trails-labels";
  labelsCanvas.style.top = HEADER_HEIGHT + "px";
  container.appendChild(labelsCanvas);

  const mainCanvas = document.createElement("canvas");
  mainCanvas.className = "trails-main";
  mainCanvas.style.top = HEADER_HEIGHT + "px";
  mainCanvas.style.left = LABEL_WIDTH + "px";
  container.appendChild(mainCanvas);

  const scroller = document.createElement("div");
  scroller.className = "trails-scroller";
  scroller.style.top = HEADER_HEIGHT + "px";
  scroller.style.left = LABEL_WIDTH + "px";
  const spacer = document.createElement("div");
  spacer.className = "trails-spacer";
  scroller.appendChild(spacer);
  container.appendChild(scroller);

  const tooltip = createTooltip(container);

  const ctxH = headerCanvas.getContext("2d");
  const ctxL = labelsCanvas.getContext("2d");
  const ctxM = mainCanvas.getContext("2d");

  // -- Sizing ----------------------------------------------------------
  function applyLabelWidth() {
    LABEL_WIDTH =
      sortBy === "career" ? LABEL_WIDTH_CAREER : LABEL_WIDTH_DEFAULT;
    corner.style.width = LABEL_WIDTH + "px";
    headerCanvas.style.left = LABEL_WIDTH + "px";
    mainCanvas.style.left = LABEL_WIDTH + "px";
    scroller.style.left = LABEL_WIDTH + "px";
  }

  function sizeCanvases() {
    viewportW = Math.max(0, container.offsetWidth - LABEL_WIDTH);
    viewportH = Math.max(0, container.offsetHeight - HEADER_HEIGHT);
    ChartBase.sizeCanvas(headerCanvas, viewportW, HEADER_HEIGHT);
    ChartBase.sizeCanvas(labelsCanvas, LABEL_WIDTH, viewportH);
    PR = ChartBase.sizeCanvas(mainCanvas, viewportW, viewportH);
  }

  function setupScales() {
    const viewMin = RANGE_START ?? FULL_MIN;
    const viewMax = RANGE_END ?? FULL_MAX;
    const days = (viewMax - viewMin) / 86400;
    minZoom =
      days > 0
        ? Math.max(0.001, (viewportW - X_PAD * 2) / (days * TARGET_PX_PER_DAY))
        : 0.001;
    zoomLevel = Math.max(minZoom, zoomLevel);
    virtualW = Math.max(
      viewportW,
      Math.ceil(days * TARGET_PX_PER_DAY * zoomLevel) + X_PAD * 2,
    );
    virtualH = Math.max(viewportH, contributors.length * ROW_HEIGHT + 16);

    xScale = d3
      .scaleTime()
      .domain([new Date(viewMin * 1000), new Date(viewMax * 1000)])
      .range([X_PAD, virtualW - X_PAD]);

    spacer.style.width = virtualW + "px";
    spacer.style.height = virtualH + "px";
  }

  // -- Helpers ---------------------------------------------------------
  // Pick the dominant category by first finding the group with the highest
  // aggregate count, then returning the top individual category within it.
  // catCounts: { [cat]: count }   catToGroup: { [cat]: group }
  function dominantCategory(catCounts, catToGroup) {
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

  // -- Data prep -------------------------------------------------------
  function getActiveContributions() {
    if (!RANGE_START && !RANGE_END) return raw_contributions;
    return raw_contributions.filter(
      (d) =>
        (!RANGE_START || d.ts >= RANGE_START) &&
        (!RANGE_END || d.ts <= RANGE_END),
    );
  }

  function processData() {
    const byContributor = d3.group(
      getActiveContributions(),
      (d) => d.contributor,
    );
    contributors = [];
    const gapSec = GAP_THRESHOLD_DAYS * 86400;

    for (const [id, items] of byContributor) {
      items.sort((a, b) => a.ts - b.ts);
      const segments = [];
      let segItems = [items[0]];
      for (let i = 1; i < items.length; i++) {
        if (items[i].ts - segItems[segItems.length - 1].ts > gapSec) {
          segments.push(makeSegment(segItems));
          segItems = [];
        }
        segItems.push(items[i]);
      }
      segments.push(makeSegment(segItems));

      const counts = {};
      const catToGroup = {};
      items.forEach((c) => {
        counts[c.cat] = (counts[c.cat] || 0) + 1;
        catToGroup[c.cat] = c.group;
      });
      const dominantCat = dominantCategory(counts, catToGroup);

      contributors.push({
        name: items[0].contributorName,
        id,
        total: items.length,
        dominantCat,
        firstTs: items[0].ts,
        lastTs: items[items.length - 1].ts,
        segments,
      });
    }
    applySort();
  }

  function applySort() {
    if (sortBy === "first") {
      contributors.sort((a, b) => a.firstTs - b.firstTs || b.total - a.total);
    } else if (sortBy === "career") {
      contributors.sort(
        (a, b) =>
          b.lastTs - b.firstTs - (a.lastTs - a.firstTs) || b.total - a.total,
      );
    } else {
      contributors.sort((a, b) => b.total - a.total || a.firstTs - b.firstTs);
    }
  }

  function makeSegment(items) {
    const counts = {};
    const catToGroup = {};
    items.forEach((c) => {
      counts[c.cat] = (counts[c.cat] || 0) + 1;
      catToGroup[c.cat] = c.group;
    });
    const dominantCat = dominantCategory(counts, catToGroup);
    return {
      start: items[0].ts,
      end: items[items.length - 1].ts,
      counts,
      total: items.length,
      dominantCat,
      bins: buildMonthlyBins(items, dominantCat),
    };
  }

  // For each calendar month the segment touches, pick that month's dominant
  // category. Months with no commits inherit the previous month's dominant
  // (forward-fill). Adjacent same-category months are then merged.
  function buildMonthlyBins(items, segDominantCat) {
    const segStart = items[0].ts;
    const segEnd = items[items.length - 1].ts;

    const byMonth = new Map();
    const catToGroup = {};
    for (const c of items) {
      const key = d3.timeMonth.floor(new Date(c.ts * 1000)).getTime();
      let b = byMonth.get(key);
      if (!b) {
        b = {};
        byMonth.set(key, b);
      }
      b[c.cat] = (b[c.cat] || 0) + 1;
      catToGroup[c.cat] = c.group;
    }

    const startMonth = d3.timeMonth.floor(new Date(segStart * 1000));
    const endMonth = d3.timeMonth.floor(new Date(segEnd * 1000));

    const bins = [];
    let lastDom = null;
    let m = startMonth;
    while (m <= endMonth) {
      const cs = byMonth.get(m.getTime());
      let dom;
      if (cs) {
        dom = dominantCategory(cs, catToGroup);
        lastDom = dom;
      } else {
        dom = lastDom || segDominantCat;
      }
      const next = d3.timeMonth.offset(m, 1);
      const bs = Math.max(segStart, m.getTime() / 1000);
      const be = Math.min(segEnd, next.getTime() / 1000);
      bins.push({ start: bs, end: be, dominantCat: dom });
      m = next;
    }

    const merged = [];
    for (const b of bins) {
      const last = merged[merged.length - 1];
      if (last && last.dominantCat === b.dominantCat) {
        last.end = b.end;
      } else {
        merged.push({ start: b.start, end: b.end, dominantCat: b.dominantCat });
      }
    }
    return merged;
  }

  // -- Selection animation ---------------------------------------------
  function startAnim() {
    if (_animFrame !== null) return;
    function frame() {
      _animFrame = null;
      if (!_selectedId) return;
      drawLabels();
      _animFrame = requestAnimationFrame(frame);
    }
    _animFrame = requestAnimationFrame(frame);
  }

  function stopAnim() {
    if (_animFrame !== null) {
      cancelAnimationFrame(_animFrame);
      _animFrame = null;
    }
  }

  // -- Drawing ---------------------------------------------------------
  function drawHeader() {
    ctxH.save();
    ctxH.scale(PR, PR);
    ctxH.clearRect(0, 0, headerCanvas.width, headerCanvas.height);
    ctxH.fillStyle = COLOR_BACKGROUND;
    ctxH.fillRect(0, 0, viewportW, HEADER_HEIGHT);

    ctxH.save();
    ctxH.translate(-scrollLeft, 0);

    const tickCount = Math.max(4, Math.floor(virtualW / 100));
    const ticks = xScale.ticks(tickCount);
    const fmt = xScale.tickFormat(tickCount);

    ctxH.fillStyle = COLOR_TEXT;
    ctxH.textAlign = "center";
    ctxH.textBaseline = "middle";
    ctxH.globalAlpha = 0.75;
    ticks.forEach((t) => {
      const x = xScale(t);
      if (x < scrollLeft - 50 || x > scrollLeft + viewportW + 50) return;
      const isYear = t.getMonth() === 0 && t.getDate() === 1;
      ctxH.font = isYear ? `bold 10px ${FONT_FAMILY}` : `10px ${FONT_FAMILY}`;
      ctxH.fillText(fmt(t), x, HEADER_HEIGHT / 2 - 1);

      ctxH.globalAlpha = 0.35;
      ctxH.beginPath();
      ctxH.moveTo(x, HEADER_HEIGHT - 6);
      ctxH.lineTo(x, HEADER_HEIGHT - 1);
      ctxH.strokeStyle = COLOR_TEXT;
      ctxH.lineWidth = 1;
      ctxH.stroke();
      ctxH.globalAlpha = 0.75;
    });
    ctxH.restore();

    ctxH.globalAlpha = 1;
    ctxH.beginPath();
    ctxH.moveTo(0, HEADER_HEIGHT - 0.5);
    ctxH.lineTo(viewportW, HEADER_HEIGHT - 0.5);
    ctxH.strokeStyle = COLOR_LINK;
    ctxH.lineWidth = 1;
    ctxH.stroke();

    ctxH.restore();
  }

  function visibleRowRange() {
    const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT));
    const endRow = Math.min(
      contributors.length - 1,
      Math.ceil((scrollTop + viewportH) / ROW_HEIGHT),
    );
    return [startRow, endRow];
  }

  function drawLabels() {
    ctxL.save();
    ctxL.scale(PR, PR);
    ctxL.clearRect(0, 0, labelsCanvas.width, labelsCanvas.height);
    ctxL.fillStyle = COLOR_BACKGROUND;
    ctxL.fillRect(0, 0, LABEL_WIDTH, viewportH);

    const [startRow, endRow] = visibleRowRange();

    // Alt rows
    for (let i = startRow; i <= endRow; i++) {
      if (i % 2 === 1) {
        ctxL.fillStyle = COLOR_ROW_ALT;
        ctxL.fillRect(0, i * ROW_HEIGHT - scrollTop, LABEL_WIDTH, ROW_HEIGHT);
      }
    }

    // Hover row
    if (_hover) {
      ctxL.fillStyle = COLOR_ROW_HOVER;
      ctxL.fillRect(
        0,
        _hover.row * ROW_HEIGHT - scrollTop,
        LABEL_WIDTH,
        ROW_HEIGHT,
      );
    }

    // Selected row highlight (pulsing)
    if (_selectedId) {
      const selIdx = contributors.findIndex((c) => c.id === _selectedId);
      if (selIdx >= 0) {
        const t = (performance.now() % ANIM_CYCLE) / ANIM_CYCLE;
        const ry = selIdx * ROW_HEIGHT - scrollTop;
        if (ry + ROW_HEIGHT > 0 && ry < viewportH) {
          ctxL.fillStyle = COLOR_ACCENT;
          ctxL.globalAlpha = 0.12 + (1 - t) * 0.12;
          ctxL.fillRect(0, ry, LABEL_WIDTH, ROW_HEIGHT);
          ctxL.globalAlpha = 0.85;
          ctxL.fillRect(0, ry, 3, ROW_HEIGHT);
          ctxL.globalAlpha = 1;
        }
      }
    }

    ctxL.font = `11px ${FONT_FAMILY}`;
    ctxL.textBaseline = "middle";
    for (let i = startRow; i <= endRow; i++) {
      const c = contributors[i];
      const y = i * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
      const isHovered = _hover && _hover.row === i;
      const isSelected = _selectedId != null && c.id === _selectedId;

      // Color dot
      ctxL.fillStyle = categoryColor(c.dominantCat);
      ctxL.globalAlpha = 0.9;
      ctxL.beginPath();
      ctxL.arc(LABEL_WIDTH - 10, y, 3.5, 0, Math.PI * 2);
      ctxL.fill();

      // Name (right aligned, truncated)
      ctxL.fillStyle = isSelected ? COLOR_ACCENT : COLOR_TEXT;
      ctxL.globalAlpha = isSelected ? 1 : 0.85;
      ctxL.font = `${isHovered || isSelected ? "bold " : ""}11px ${FONT_FAMILY}`;
      ctxL.textAlign = "right";
      const rawLabel =
        sortBy === "career"
          ? `${c.name}  (${formatCareer(c.lastTs - c.firstTs)})`
          : c.name;
      const name = truncate(ctxL, rawLabel, LABEL_WIDTH - 60);
      ctxL.fillText(name, LABEL_WIDTH - 20, y);

      // Total commits (small, dim, far left)
      ctxL.font = `10px ${FONT_FAMILY}`;
      ctxL.fillStyle = COLOR_TEXT;
      ctxL.globalAlpha = 0.45;
      ctxL.textAlign = "left";
      ctxL.fillText(String(c.total), 8, y);
      ctxL.globalAlpha = 1;
    }

    // Right border
    ctxL.beginPath();
    ctxL.moveTo(LABEL_WIDTH - 0.5, 0);
    ctxL.lineTo(LABEL_WIDTH - 0.5, viewportH);
    ctxL.strokeStyle = COLOR_LINK;
    ctxL.lineWidth = 1;
    ctxL.stroke();

    ctxL.restore();
  }

  function formatCareer(seconds) {
    const days = seconds / 86400;
    const years = Math.floor(days / 365.25);
    const months = Math.floor((days % 365.25) / 30.44);
    if (years >= 1) return months > 0 ? `${years}y ${months}m` : `${years}y`;
    return `${Math.max(1, months)}m`;
  }

  function truncate(ctx, str, maxW) {
    if (ctx.measureText(str).width <= maxW) return str;
    let lo = 0,
      hi = str.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ctx.measureText(str.slice(0, mid) + "…").width <= maxW) lo = mid + 1;
      else hi = mid;
    }
    return str.slice(0, Math.max(1, lo - 1)) + "…";
  }

  function drawMain() {
    ctxM.save();
    ctxM.scale(PR, PR);
    ctxM.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    ctxM.fillStyle = COLOR_BACKGROUND;
    ctxM.fillRect(0, 0, viewportW, viewportH);

    const [startRow, endRow] = visibleRowRange();

    // Alt rows
    for (let i = startRow; i <= endRow; i++) {
      if (i % 2 === 1) {
        ctxM.fillStyle = COLOR_ROW_ALT;
        ctxM.fillRect(0, i * ROW_HEIGHT - scrollTop, viewportW, ROW_HEIGHT);
      }
    }

    // Hover row
    if (_hover) {
      ctxM.fillStyle = COLOR_ROW_HOVER;
      ctxM.fillRect(
        0,
        _hover.row * ROW_HEIGHT - scrollTop,
        viewportW,
        ROW_HEIGHT,
      );
    }

    // Selected row bg
    if (_selectedId) {
      const selIdx = contributors.findIndex((c) => c.id === _selectedId);
      if (selIdx >= startRow && selIdx <= endRow) {
        ctxM.fillStyle = COLOR_ACCENT;
        ctxM.globalAlpha = 0.07;
        ctxM.fillRect(
          0,
          selIdx * ROW_HEIGHT - scrollTop,
          viewportW,
          ROW_HEIGHT,
        );
        ctxM.globalAlpha = 1;
      }
    }

    // Year gridlines
    const yearTicks = xScale.ticks(d3.timeYear);
    ctxM.strokeStyle = COLOR_GRID;
    ctxM.lineWidth = 1;
    ctxM.globalAlpha = 0.85;
    yearTicks.forEach((t) => {
      const x = xScale(t) - scrollLeft;
      if (x < -1 || x > viewportW + 1) return;
      ctxM.beginPath();
      ctxM.moveTo(Math.round(x) + 0.5, 0);
      ctxM.lineTo(Math.round(x) + 0.5, viewportH);
      ctxM.stroke();
    });
    ctxM.globalAlpha = 1;

    // Segments
    const visStart = scrollLeft - X_PAD;
    const visEnd = scrollLeft + viewportW + X_PAD;
    for (let i = startRow; i <= endRow; i++) {
      const c = contributors[i];
      const yCenter = i * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
      const yTop = yCenter - SEGMENT_THICKNESS / 2;
      const isHovered = _hover && _hover.row === i;

      for (const s of c.segments) {
        const x0 = xScale(new Date(s.start * 1000));
        const x1 = xScale(new Date(s.end * 1000));
        if (x1 < visStart || x0 > visEnd) continue;
        const naturalW = x1 - x0;
        const w = Math.max(MIN_SEGMENT_WIDTH, naturalW);
        const dx = x0 - scrollLeft;

        const isHoveredSeg = _hover && _hover.segment === s;
        ctxM.globalAlpha = 0.92;

        if (s.bins.length > 1 && naturalW >= 6) {
          ctxM.save();
          roundRect(
            ctxM,
            dx,
            yTop,
            w,
            SEGMENT_THICKNESS,
            SEGMENT_THICKNESS / 2,
          );
          ctxM.clip();
          for (const b of s.bins) {
            const bx0 = xScale(new Date(b.start * 1000)) - scrollLeft;
            const bx1 = xScale(new Date(b.end * 1000)) - scrollLeft;
            ctxM.fillStyle = categoryColor(b.dominantCat);
            // overlap by 0.5px on each side to avoid sub-pixel gaps between adjacent bins
            ctxM.fillRect(
              bx0 - 0.5,
              yTop,
              Math.max(1, bx1 - bx0) + 1,
              SEGMENT_THICKNESS,
            );
          }
          ctxM.restore();
        } else {
          ctxM.fillStyle = categoryColor(s.dominantCat);
          roundRect(
            ctxM,
            dx,
            yTop,
            w,
            SEGMENT_THICKNESS,
            SEGMENT_THICKNESS / 2,
          );
          ctxM.fill();
        }

        if (isHoveredSeg) {
          ctxM.globalAlpha = 1;
          ctxM.strokeStyle = COLOR_TEXT;
          ctxM.lineWidth = 1;
          roundRect(
            ctxM,
            dx - 0.5,
            yTop - 0.5,
            w + 1,
            SEGMENT_THICKNESS + 1,
            (SEGMENT_THICKNESS + 1) / 2,
          );
          ctxM.stroke();
        }
      }
    }
    ctxM.globalAlpha = 1;

    ctxM.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  function drawAll() {
    drawHeader();
    drawLabels();
    drawMain();
  }

  // -- Interaction -----------------------------------------------------
  scroller.addEventListener(
    "scroll",
    () => {
      scrollLeft = scroller.scrollLeft;
      scrollTop = scroller.scrollTop;
      if (_hover) {
        _hover = null;
      }
      tooltip.hide();
      drawAll();
    },
    { passive: true },
  );

  // Ctrl/Cmd + wheel = horizontal zoom anchored at cursor.
  // Plain wheel falls through to native vertical scroll;
  // shift+wheel falls through to native horizontal scroll.
  scroller.addEventListener(
    "wheel",
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();

      const rect = scroller.getBoundingClientRect();
      const mx = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const dateAtCursor = xScale.invert(mx + scroller.scrollLeft);

      const dy =
        e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      const factor = Math.exp(-dy * ZOOM_SENSITIVITY);
      const newZoom = Math.max(minZoom, Math.min(MAX_ZOOM, zoomLevel * factor));
      if (newZoom === zoomLevel) return;
      zoomLevel = newZoom;

      setupScales();

      scroller.scrollLeft = xScale(dateAtCursor) - mx;
      scrollLeft = scroller.scrollLeft;
      isZoomed = zoomLevel > minZoom;
      drawAll();
      chart.onZoomChange(isZoomed);
    },
    { passive: false },
  );

  function findHit(mx, my) {
    const x = mx + scrollLeft;
    const y = my + scrollTop;
    const row = Math.floor(y / ROW_HEIGHT);
    if (row < 0 || row >= contributors.length) return null;
    const c = contributors[row];
    let segment = null;
    for (const s of c.segments) {
      const x0 = xScale(new Date(s.start * 1000));
      const x1 = xScale(new Date(s.end * 1000));
      const w = Math.max(MIN_SEGMENT_WIDTH, x1 - x0);
      if (x >= x0 - 3 && x <= x0 + w + 3) {
        segment = s;
        break;
      }
    }
    return { row, contributor: c, segment };
  }

  scroller.addEventListener("mousemove", (e) => {
    const rect = scroller.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Detect scrollbar region for both classic (take layout space) and
    // overlay (drawn over content, clientWidth === offsetWidth) scrollbars.
    const sbW = scroller.offsetWidth - scroller.clientWidth;
    const sbH = scroller.offsetHeight - scroller.clientHeight;
    const OVERLAY_EST = 10;
    const onVBar =
      scroller.scrollHeight > scroller.clientHeight &&
      (sbW > 0
        ? mx >= scroller.clientWidth
        : mx >= scroller.clientWidth - OVERLAY_EST);
    const onHBar =
      scroller.scrollWidth > scroller.clientWidth &&
      (sbH > 0
        ? my >= scroller.clientHeight
        : my >= scroller.clientHeight - OVERLAY_EST);

    if (onVBar || onHBar) {
      if (_hover) {
        _hover = null;
        drawAll();
      }
      tooltip.hide();
      return;
    }

    const hit = findHit(mx, my);
    const prev = _hover;
    _hover = hit;
    const changed =
      !prev !== !hit ||
      (prev && hit && (prev.row !== hit.row || prev.segment !== hit.segment));
    if (changed) drawAll();

    if (hit && hit.segment) {
      showTooltip(hit, e.clientX, e.clientY);
    } else if (hit) {
      showRowTooltip(hit, e.clientX, e.clientY);
    } else {
      tooltip.hide();
    }
  });

  scroller.addEventListener("mouseleave", () => {
    if (_hover) {
      _hover = null;
      drawAll();
    }
    tooltip.hide();
  });

  function showTooltip(hit, clientX, clientY) {
    const fmt = d3.timeFormat("%b %-d, %Y");
    const s = hit.segment;
    let html = `<div class="tt-title">${tooltip.escapeHtml(hit.contributor.name)}</div>`;
    const sameDay = s.end - s.start < 86400;
    html += `<div class="tt-meta">${fmt(new Date(s.start * 1000))}${sameDay ? "" : ` – ${fmt(new Date(s.end * 1000))}`}</div>`;
    html += `<div class="tt-meta">${tooltip.pluralize(s.total, "contribution")}</div>`;
    html += tooltip.categoryRows(
      _catScale.domain(),
      s.counts,
      s.total,
      categoryColor,
    );
    tooltip.show(html, clientX, clientY);
  }

  function showRowTooltip(hit, clientX, clientY) {
    const fmt = d3.timeFormat("%b %Y");
    const c = hit.contributor;
    let html = `<div class="tt-title">${tooltip.escapeHtml(c.name)}</div>`;
    html += `<div class="tt-meta">${tooltip.pluralize(c.total, "contribution")} · ${tooltip.pluralize(c.segments.length, "active period")}</div>`;
    html += `<div class="tt-meta">${fmt(new Date(c.firstTs * 1000))} – ${fmt(new Date(c.lastTs * 1000))}</div>`;
    tooltip.show(html, clientX, clientY);
  }

  // -- Range filter ----------------------------------------------------
  function rerun() {
    processData();
    updateCornerStats();
    zoomLevel = 0;
    setupScales();
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
    scrollLeft = 0;
    scrollTop = 0;
    _hover = null;
    tooltip.hide();
    isZoomed = false;
    drawAll();
    chart.onZoomChange(false);
  }

  // -- Public API ------------------------------------------------------
  const chart = (values) => {
    const catToGroup = values[2] || {};
    raw_contributions = values[0]
      .map((d) => ({
        ts: +d.timestamp,
        cat: d.category,
        group: catToGroup[d.category] ?? d.category,
        contributor: d.contributor_id,
        contributorName: d.contributor_name,
      }))
      .filter((d) => d.contributor && Number.isFinite(d.ts));

    FULL_MIN = d3.min(raw_contributions, (d) => d.ts);
    FULL_MAX = d3.max(raw_contributions, (d) => d.ts);

    const cats = values[1];
    _catScale = d3
      .scaleOrdinal()
      .domain(Object.keys(cats))
      .range(Object.values(cats));
    processData();
    updateCornerStats();
    sizeCanvases();
    setupScales();
    drawAll();
    return chart;
  };

  chart.setSortBy = (v) => {
    if (v === sortBy) return chart;
    sortBy = v;
    applySort();
    const prevLabelWidth = LABEL_WIDTH;
    applyLabelWidth();
    // Career sort widens the label column, shrinking viewportW and shifting minZoom - reset to re-fit.
    if (LABEL_WIDTH !== prevLabelWidth) zoomLevel = 0;
    sizeCanvases();
    setupScales();
    _hover = null;
    scroller.scrollTop = 0;
    scrollTop = 0;
    isZoomed = zoomLevel > minZoom;
    drawAll();
    chart.onZoomChange(isZoomed);
    return chart;
  };

  chart.selectContributor = (id) => {
    _selectedId = id || null;
    stopAnim();
    if (!_selectedId) {
      drawAll();
      return chart;
    }

    // Reset zoom if applied
    if (zoomLevel > minZoom) {
      zoomLevel = 0;
      setupScales();
      scroller.scrollLeft = 0;
      scrollLeft = 0;
    }

    // Scroll selected row into view
    const rowIdx = contributors.findIndex((c) => c.id === _selectedId);
    if (rowIdx >= 0) {
      const targetTop = Math.max(
        0,
        rowIdx * ROW_HEIGHT - Math.floor((viewportH - ROW_HEIGHT) / 2),
      );
      scroller.scrollTop = targetTop;
      scrollTop = scroller.scrollTop;
    }

    drawAll();
    startAnim();
    return chart;
  };

  chart.fullDateRange = () => [FULL_MIN, FULL_MAX];
  chart.setRange = (start, end) => {
    const newStart = start == null ? null : start;
    const newEnd = end == null ? null : end;
    if (newStart === RANGE_START && newEnd === RANGE_END) return chart;
    RANGE_START = newStart;
    RANGE_END = newEnd;
    if (raw_contributions.length) rerun();
    return chart;
  };
  chart.resize = () => {
    sizeCanvases();
    setupScales();
    scrollLeft = scroller.scrollLeft;
    scrollTop = scroller.scrollTop;
    isZoomed = zoomLevel > minZoom;
    drawAll();
    chart.onZoomChange(isZoomed);
    return chart;
  };
  chart.onZoomChange = () => {};
  chart.resetZoom = () => {
    if (!isZoomed) return chart;
    zoomLevel = 0;
    setupScales();
    scroller.scrollLeft = 0;
    scrollLeft = 0;
    isZoomed = false;
    drawAll();
    chart.onZoomChange(false);
    return chart;
  };

  window.addEventListener("themechange", () => {
    readColors();
    drawAll();
  });

  return chart;
}
