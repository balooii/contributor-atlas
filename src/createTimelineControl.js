import * as d3 from "d3";

export function createTimelineControl(container) {
  let CHAPTERS = [];
  let CATEGORIES_ENABLED = false;
  let EXTRAS = [];

  const RANGE_KEY = "range";
  function saveRange(start, end) {
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify({ start, end }));
    } catch (e) {}
  }
  function loadRange() {
    try {
      return JSON.parse(localStorage.getItem(RANGE_KEY));
    } catch (e) {
      return null;
    }
  }

  let visual = null;
  let posL = 0,
    posR = 1;
  let selectedCategories = new Set();
  let allCats = [];
  let pills = []; // [{ el, cat, countEl }]
  let activeChapter = null; // { pill, label } or null

  // Time-axis state - set by build() once visual is attached.
  let minTs = 0,
    maxTs = 0,
    span = 0;
  let fmt = null;
  let render = null;

  const tsFromPos = (p) => Math.round(minTs + p * span);
  const posFromTs = (ts) => (ts - minTs) / span;
  const clampPct = (ts) => Math.max(0, Math.min(100, posFromTs(ts) * 100));

  const els = {};

  function clearActiveChapter() {
    if (!activeChapter) return;
    activeChapter.pill.classList.remove("tc-active");
    activeChapter.label.classList.remove("tc-active");
    activeChapter = null;
  }

  function control() {}

  function parseDateToTs(dateStr, isEnd) {
    if (dateStr == null || typeof dateStr === "number") return dateStr;
    return Date.parse(dateStr + (isEnd ? "T23:59:59Z" : "T00:00:00Z")) / 1000;
  }

  control.chapters = function (v) {
    CHAPTERS = (v || []).map((ch) => ({
      ...ch,
      start: parseDateToTs(ch.start, false),
      end: parseDateToTs(ch.end, true),
    }));
    return control;
  };
  control.categories = function (v) {
    CATEGORIES_ENABLED = !!v;
    return control;
  };
  control.extras = function (v) {
    EXTRAS = v == null ? [] : Array.isArray(v) ? v : [v];
    return control;
  };
  control.attach = function (v) {
    visual = v;
    build();
    return control;
  };

  return control;

  // -- DOM construction --------------------------------------------

  function build() {
    const hasChapters = CHAPTERS.length > 0;

    [minTs, maxTs] = visual.fullDateRange();
    span = maxTs - minTs;
    fmt = d3.timeFormat("%b %Y");

    const stored = loadRange();
    if (stored && (stored.start !== null || stored.end !== null)) {
      const s = stored.start !== null ? stored.start : minTs;
      const e = stored.end !== null ? stored.end : maxTs;
      posL = Math.max(0, Math.min(1, (s - minTs) / span));
      posR = Math.max(0, Math.min(1, (e - minTs) / span));
    }

    buildDom(hasChapters);

    render = () => {
      els.handleL.style.left = posL * 100 + "%";
      els.handleR.style.left = posR * 100 + "%";
      els.range.style.left = posL * 100 + "%";
      els.range.style.width = (posR - posL) * 100 + "%";
      els.labelL.style.left = posL * 100 + "%";
      els.labelR.style.left = posR * 100 + "%";
      els.labelL.style.transform = `translateX(-${Math.min(50, posL * 100)}%)`;
      els.labelR.style.transform = `translateX(-${Math.max(50, posR * 100)}%)`;
      els.labelL.textContent = fmt(new Date(tsFromPos(posL) * 1000));
      els.labelR.textContent = fmt(new Date(tsFromPos(posR) * 1000));
    };

    initTimeline();
    if (hasChapters) initChapterTrack(CHAPTERS);
    if (CATEGORIES_ENABLED) initCategoryFilter();
    els.resetBtn.addEventListener("click", onReset);
    updateResetButton();

    render();
    if (posL !== 0 || posR !== 1) {
      visual.setRange(tsFromPos(posL), tsFromPos(posR));
    }
  }

  function buildDom(hasChapters) {
    container.innerHTML = "";
    container.classList.add("tc-controls");

    if (CATEGORIES_ENABLED) {
      els.categoryFilter = div("tc-category-filter");
      container.appendChild(els.categoryFilter);
    }

    els.controlsRow = div("tc-controls-row");
    container.appendChild(els.controlsRow);

    els.timeline = div("tc-timeline");
    if (hasChapters) els.timeline.classList.add("tc-has-chapters");
    els.controlsRow.appendChild(els.timeline);

    els.actions = div("tc-actions");
    els.controlsRow.appendChild(els.actions);
    EXTRAS.forEach((node) => els.actions.appendChild(node));

    els.resetBtn = document.createElement("button");
    els.resetBtn.className = "tc-btn tc-reset-btn";
    els.resetBtn.textContent = CATEGORIES_ENABLED
      ? "reset filters"
      : "reset range";
    els.actions.appendChild(els.resetBtn);

    if (hasChapters) {
      els.chapterTrack = div("tc-chapter-track");
      els.timeline.appendChild(els.chapterTrack);
    }
    els.track = div("tc-track");
    els.timeline.appendChild(els.track);
    els.range = div("tc-range");
    els.timeline.appendChild(els.range);
    els.handleL = div("tc-handle tc-handle-left");
    els.timeline.appendChild(els.handleL);
    els.handleR = div("tc-handle tc-handle-right");
    els.timeline.appendChild(els.handleR);
    els.labelL = div("tc-label tc-label-left");
    els.timeline.appendChild(els.labelL);
    els.labelR = div("tc-label tc-label-right");
    els.timeline.appendChild(els.labelR);

    if (hasChapters) {
      els.tooltip = div("tc-chapter-tooltip");
      document.body.appendChild(els.tooltip);
    }
  }

  function div(className) {
    const node = document.createElement("div");
    node.className = className;
    return node;
  }

  // Generic pointer-drag wiring. canDrag may veto a pointerdown; onStart/
  // onEnd hook setup and teardown around the move stream.
  function onDrag(target, onMove, { canDrag, onStart, onEnd } = {}) {
    target.addEventListener("pointerdown", (e) => {
      if (canDrag && !canDrag(e)) return;
      e.preventDefault();
      target.setPointerCapture(e.pointerId);
      clearActiveChapter();
      onStart?.(e);
      const move = (ev) => onMove(ev);
      target.addEventListener("pointermove", move);
      target.addEventListener(
        "pointerup",
        () => {
          target.removeEventListener("pointermove", move);
          onEnd?.();
        },
        { once: true },
      );
    });
  }

  // -- Timeline slider ---------------------------------------------

  function snapToMonthStart(ts) {
    const d = new Date(ts * 1000);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000;
  }

  function snapToMonthEnd(ts) {
    const d = new Date(ts * 1000);
    return (
      new Date(
        d.getFullYear(),
        d.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      ).getTime() / 1000
    );
  }

  function initTimeline() {
    function posFromClient(clientX) {
      const rect = els.track.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }

    let debounceTimer = null;
    function applyRange() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const isFullRange = posL === 0 && posR === 1;
        const startVal = isFullRange ? null : tsFromPos(posL);
        const endVal = isFullRange ? null : tsFromPos(posR);
        visual.setRange(startVal, endVal);
        saveRange(startVal, endVal);
        updateResetButton();
      }, 60);
    }

    onDrag(els.handleL, (e) => {
      const rawPos = Math.min(posFromClient(e.clientX), posR - 0.001);
      const snappedTs = snapToMonthStart(tsFromPos(rawPos));
      posL = Math.max(0, Math.min(posFromTs(snappedTs), posR - 0.001));
      render();
      applyRange();
    });

    onDrag(els.handleR, (e) => {
      const rawPos = Math.max(posFromClient(e.clientX), posL + 0.001);
      const snappedTs = snapToMonthEnd(tsFromPos(rawPos));
      posR = Math.max(posL + 0.001, Math.min(posFromTs(snappedTs), 1));
      render();
      applyRange();
    });

    let dragStartPos = 0,
      dragStartL = 0,
      dragWidth = 0;
    onDrag(
      els.range,
      (e) => {
        const delta = posFromClient(e.clientX) - dragStartPos;
        const rawL = Math.max(0, Math.min(dragStartL + delta, 1 - dragWidth));
        const rawR = rawL + dragWidth;
        const snappedLTs = snapToMonthStart(tsFromPos(rawL));
        const snappedRTs = snapToMonthEnd(tsFromPos(rawR));
        posL = Math.max(0, posFromTs(snappedLTs));
        posR = Math.min(1, posFromTs(snappedRTs));
        if (posR <= posL) posR = posL + 0.001;
        render();
        applyRange();
      },
      {
        canDrag: () => !(posL === 0 && posR === 1),
        onStart: (e) => {
          dragWidth = posR - posL;
          dragStartPos = posFromClient(e.clientX);
          dragStartL = posL;
          els.range.classList.add("is-dragging");
        },
        onEnd: () => els.range.classList.remove("is-dragging"),
      },
    );
  }

  // -- Chapter track -----------------------------------------------

  function initChapterTrack(chapters) {
    if (span <= 0) return;

    // Resolve null start/end: sort by start, then fill the earliest chapter's
    // null start with minTs and the latest chapter's null end with maxTs.
    chapters = chapters
      .map((ch) => ({ ...ch }))
      .sort((a, b) => (a.start ?? -Infinity) - (b.start ?? -Infinity));
    if (chapters.length > 0) {
      if (chapters[0].start == null) chapters[0].start = minTs;
      if (chapters[chapters.length - 1].end == null)
        chapters[chapters.length - 1].end = maxTs;
    }

    let hideTimer = null;
    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        els.tooltip.style.display = "none";
      }, 200);
    }
    function cancelHide() {
      clearTimeout(hideTimer);
    }
    els.tooltip.addEventListener("mouseenter", cancelHide);
    els.tooltip.addEventListener("mouseleave", scheduleHide);

    function positionTooltip(pill) {
      const pillRect = pill.getBoundingClientRect();
      const tipRect = els.tooltip.getBoundingClientRect();
      let left = pillRect.left + pillRect.width / 2 - tipRect.width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
      let top = pillRect.top - tipRect.height - 8;
      if (top < 8) top = pillRect.bottom + 8;
      els.tooltip.style.left = left + "px";
      els.tooltip.style.top = top + "px";
    }

    function showTooltip(pill, chapter) {
      els.tooltip.innerHTML = "";
      if (chapter.image_url) {
        const img = document.createElement("img");
        img.src = chapter.image_url;
        img.alt = "";
        img.onerror = () => {
          img.remove();
          positionTooltip(pill);
        };
        img.onload = () => positionTooltip(pill);
        els.tooltip.appendChild(img);
      }
      const title = document.createElement("div");
      title.className = "tc-chapter-tooltip-title";
      title.textContent = chapter.name;
      els.tooltip.appendChild(title);

      const dates = document.createElement("div");
      dates.className = "tc-chapter-tooltip-dates";
      dates.textContent = `${fmt(new Date(chapter.start * 1000))} – ${fmt(new Date(chapter.end * 1000))}`;
      els.tooltip.appendChild(dates);

      if (chapter.text) {
        const text = document.createElement("p");
        text.className = "tc-chapter-tooltip-text";
        text.textContent = chapter.text;
        els.tooltip.appendChild(text);
      }

      if (chapter.link_url) {
        const link = document.createElement("a");
        link.href = chapter.link_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Read more →";
        els.tooltip.appendChild(link);
      }

      els.tooltip.style.display = "block";
      positionTooltip(pill);
    }

    const chapterLabelsEl = div("tc-chapter-labels");
    els.timeline.insertBefore(chapterLabelsEl, els.track);

    const labelEls = [];

    chapters.forEach((chapter) => {
      const startPct = clampPct(chapter.start);
      const endPct = clampPct(chapter.end);
      if (endPct <= startPct) return;

      const pill = div("tc-chapter-pill");
      pill.style.left = startPct + "%";
      pill.style.width = endPct - startPct + "%";

      const labelEl = div("tc-chapter-label");
      labelEl.style.left = startPct + "%";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = chapter.name;
      labelEl.appendChild(nameSpan);
      chapterLabelsEl.appendChild(labelEl);
      labelEls.push({ labelEl, pill });

      pill.addEventListener("click", () => {
        posL = Math.max(0, Math.min(1, posFromTs(chapter.start)));
        posR = Math.max(0, Math.min(1, posFromTs(chapter.end)));
        render();
        visual.setRange(chapter.start, chapter.end);
        saveRange(chapter.start, chapter.end);
        clearActiveChapter();
        pill.classList.add("tc-active");
        labelEl.classList.add("tc-active");
        activeChapter = { pill, label: labelEl };
        updateResetButton();
      });

      pill.addEventListener("mouseenter", () => {
        cancelHide();
        showTooltip(pill, chapter);
      });
      pill.addEventListener("mouseleave", scheduleHide);

      els.chapterTrack.appendChild(pill);
    });

    function updateLabelRows() {
      if (labelEls.length < 2) return;
      labelEls.forEach(({ labelEl }) =>
        labelEl.classList.remove("tc-label-row-0", "tc-label-row-1"),
      );
      chapterLabelsEl.classList.remove("tc-two-row");
      els.timeline.classList.remove("tc-two-row");

      const rects = labelEls.map(({ labelEl }) =>
        labelEl.getBoundingClientRect(),
      );
      const GAP = 4;
      const hasOverlap = rects.some(
        (r, i) => i > 0 && rects[i - 1].right + GAP > r.left,
      );
      if (!hasOverlap) return;

      const rowRights = [-Infinity, -Infinity];
      labelEls.forEach(({ labelEl }, i) => {
        const { left, right } = rects[i];
        const row =
          rowRights[0] + GAP <= left ? 0 : rowRights[1] + GAP <= left ? 1 : 0;
        rowRights[row] = Math.max(rowRights[row], right);
        labelEl.classList.add("tc-label-row-" + row);
      });
      chapterLabelsEl.classList.add("tc-two-row");
      els.timeline.classList.add("tc-two-row");
    }

    requestAnimationFrame(updateLabelRows);
    new ResizeObserver(() => requestAnimationFrame(updateLabelRows)).observe(
      els.timeline,
    );
  }

  // -- Category filter pills ---------------------------------------

  function initCategoryFilter() {
    const initialStats = visual.getCategoryStats();
    const statMapInit = new Map(initialStats.map((s) => [s.cat, s]));
    allCats = visual
      .allCategories()
      .sort(
        (a, b) =>
          (statMapInit.get(b)?.count || 0) - (statMapInit.get(a)?.count || 0),
      );
    selectedCategories = new Set(allCats);

    allCats.forEach((cat) => {
      const pillEl = div("tc-category-pill");

      const dot = document.createElement("span");
      dot.className = "tc-category-pill-dot";
      dot.style.background = visual.categoryColor(cat);

      const labelEl = document.createElement("span");
      labelEl.className = "tc-category-pill-label";
      labelEl.textContent = cat;

      const countEl = document.createElement("span");
      countEl.className = "tc-category-pill-count";

      pillEl.append(dot, labelEl, countEl);

      pillEl.addEventListener("click", () => {
        if (selectedCategories.has(cat)) {
          if (selectedCategories.size > 1) selectedCategories.delete(cat);
          else return;
        } else {
          selectedCategories.add(cat);
        }
        updatePillStates();
        visual.setCategories(
          selectedCategories.size === allCats.length
            ? null
            : [...selectedCategories],
        );
        updateResetButton();
      });

      els.categoryFilter.appendChild(pillEl);
      pills.push({ el: pillEl, cat, countEl });
    });

    visual.onRerun = updatePillCounts;
    updatePillCounts(initialStats);
  }

  function updatePillStates() {
    pills.forEach((p) =>
      p.el.classList.toggle("tc-inactive", !selectedCategories.has(p.cat)),
    );
  }

  function updatePillCounts(stats) {
    if (!pills.length) return;
    const statMap = new Map(stats.map((s) => [s.cat, s]));
    pills.forEach((p) => {
      const s = statMap.get(p.cat);
      if (s) p.countEl.textContent = `${s.count}  ${s.pct}%`;
    });
  }

  // -- Reset button ------------------------------------------------

  function onReset() {
    posL = 0;
    posR = 1;
    saveRange(null, null);
    render();
    clearActiveChapter();
    if (CATEGORIES_ENABLED) {
      selectedCategories = new Set(allCats);
      updatePillStates();
      visual.reset();
    } else {
      visual.setRange(null, null);
    }
    updateResetButton();
  }

  function updateResetButton() {
    const timeActive = posL !== 0 || posR !== 1;
    const catActive =
      CATEGORIES_ENABLED &&
      allCats.length > 0 &&
      selectedCategories.size < allCats.length;
    els.resetBtn.classList.toggle("tc-visible", timeActive || catActive);
  }
}

createTimelineControl.buildButtonGroup = function (
  label,
  options,
  initial,
  onChange,
) {
  const wrap = document.createElement("div");
  wrap.className = "tc-btn-group";

  const labelEl = document.createElement("span");
  labelEl.className = "tc-btn-group-label";
  labelEl.textContent = label;

  const btns = options.map(({ label: text, value }) => {
    const btn = document.createElement("button");
    btn.className = "tc-btn";
    btn.textContent = text;
    btn.dataset.value = value;
    return btn;
  });

  function update(active) {
    btns.forEach((b) => {
      b.style.opacity = b.dataset.value === active ? "1" : "0.45";
    });
  }

  let current = initial;
  update(current);
  btns.forEach((btn) =>
    btn.addEventListener("click", () => {
      current = btn.dataset.value;
      onChange(current);
      update(current);
    }),
  );

  wrap.append(labelEl, ...btns);
  return wrap;
};

createTimelineControl.buildZoomHint = function (visual) {
  const wrapper = document.createElement("span");
  wrapper.style.alignSelf = "flex-end";

  const hint = document.createElement("span");
  hint.className = "tc-hint";
  const isMacOS = /Mac/.test(navigator.platform);
  const modifierKey = isMacOS ? "Cmd" : "Ctrl";
  hint.textContent = `${modifierKey}+scroll to zoom`;
  wrapper.appendChild(hint);

  if (visual) {
    const btn = document.createElement("button");
    btn.className = "tc-btn";
    btn.textContent = "reset zoom";
    btn.style.display = "none";
    wrapper.appendChild(btn);

    btn.addEventListener("click", () => visual.resetZoom());

    visual.onZoomChange = (isZoomed) => {
      hint.style.display = isZoomed ? "none" : "";
      btn.style.display = isZoomed ? "" : "none";
    };
  }

  return wrapper;
};

createTimelineControl.loadRange = function () {
  try {
    return JSON.parse(localStorage.getItem("range"));
  } catch (e) {
    return null;
  }
};
