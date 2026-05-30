import * as d3 from "d3";

// createGathering.js - random packing around a labelled central node
//   * One central project circle at the origin (fixed)
//   * Every contributor is a dot; bigger contributors get pulled toward the
//     centre more strongly, so they settle next to the central node and push
//     smaller dots outward via collision - no rings, no fixed angles
//   * Dot colour = dominant category
//   * Tooltip mirrors the cornerstones look

import { createTooltip } from "./createTooltip.js";
import * as ChartBase from "./chartBase.js";

export function createGathering(container) {
  const PI = Math.PI;
  const TAU = PI * 2;

  const cos = Math.cos;
  const sin = Math.sin;
  const sqrt = Math.sqrt;

  // -- State ------------------------------------------------
  let nodes = [];
  let delaunay;
  let raw_contributions_all;
  let catToGroup = {};
  let RANGE_START = null;
  let RANGE_END = null;
  let FULL_MIN, FULL_MAX;
  let ACTIVE_CATEGORIES = null;
  let _lastCategoryStats = [];
  let LAYOUT_MODE = "random"; // "sorted" | "random"
  let SELECTED_ID = null;
  let SELECTED_NODE = null;

  let PROJECT_NAME;
  let _logoImage = null;

  // -- Colours / fonts --------------------------------------
  let COLOR_BACKGROUND, COLOR_TEXT, COLOR_PROJECT, COLOR_CONTRIB, COLOR_ACCENT;
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    COLOR_BACKGROUND = cs.getPropertyValue("--c-bg").trim();
    COLOR_TEXT = cs.getPropertyValue("--c-text").trim();
    COLOR_PROJECT = cs.getPropertyValue("--c-bg").trim();
    COLOR_CONTRIB = cs.getPropertyValue("--c-contrib").trim();
    COLOR_ACCENT = cs.getPropertyValue("--accent").trim();
  }
  readColors();
  const FONT_FAMILY = "Encode Sans";

  let scale_category_color = d3.scaleOrdinal();
  const categoryColor = (cat) => scale_category_color(cat);

  // -- Canvases ---------------------------------------------
  const layers = ChartBase.createCanvasLayers(container, COLOR_BACKGROUND);
  const canvas = layers.base,
    canvas_hover = layers.hover;
  const context = layers.baseCtx,
    context_click = layers.clickCtx,
    context_hover = layers.hoverCtx;

  const loadingOverlay = ChartBase.createLoadingOverlay(container);

  const selectionHighlight = ChartBase.makeSelectionHighlight({
    context_click,
    getState: () => ({ WIDTH, HEIGHT, SF, COLOR_ACCENT, TAU }),
    getNode: () => SELECTED_NODE,
  });

  let _activeTick = null;

  const tooltip = createTooltip(container, { zIndex: 22 });

  const interaction = ChartBase.wireInteraction(canvas_hover, {
    context_hover,
    canvas,
    tooltip,
    getSize: () => ({ WIDTH, HEIGHT }),
    findNode,
    drawHoverState,
    showTooltip: showContributorTooltip,
  });

  // -- Sizes ------------------------------------------------
  const DEFAULT_SIZE = 1500;
  let WIDTH = DEFAULT_SIZE,
    HEIGHT = DEFAULT_SIZE;
  let width = DEFAULT_SIZE,
    height = DEFAULT_SIZE;
  let SF, PIXEL_RATIO;

  // Logical layout extents (centred coordinate space, units before SF). The
  // actual outer extent is measured from the simulation result every rerun.
  let LAYOUT_EXTENT = 700;
  const CENTER_RADIUS = 90; // logical radius of the central node

  // Dot size scale (sqrt - contribution counts are heavy-tailed)
  const scale_dot_radius = d3.scaleSqrt().range([2, 55]);
  // Pull-to-centre strength for the force layout: bigger contributors get yanked toward the origin harder
  const scale_pull = d3.scaleSqrt().range([0.01, 0.3]);

  // -- Entry ------------------------------------------------
  function chart(values) {
    const parsed = ChartBase.parseChartValues(values);
    raw_contributions_all = parsed.contributions;
    catToGroup = parsed.catToGroup;
    FULL_MIN = parsed.FULL_MIN;
    FULL_MAX = parsed.FULL_MAX;
    scale_category_color = parsed.scale_category_color;
    rerun();
  }

  // -- Pipeline ---------------------------------------------
  function rerun() {
    ({ nodes: nodes, categoryStats: _lastCategoryStats } =
      ChartBase.runPipeline(
        raw_contributions_all,
        RANGE_START,
        RANGE_END,
        ACTIVE_CATEGORIES,
        catToGroup,
      ));

    if (nodes.length === 0) {
      chart.resize();
      if (chart.onRerun) chart.onRerun(_lastCategoryStats);
      return;
    }

    // Scale domains
    const maxCount = d3.max(nodes, (n) => n.count);
    scale_dot_radius.domain([1, maxCount]);
    scale_pull.domain([1, maxCount]);

    nodes.forEach((n) => {
      n.type = "contributor";
      n.r = scale_dot_radius(n.count);
      n.color = n.dominant_cat ? categoryColor(n.dominant_cat) : COLOR_CONTRIB;
    });

    if (LAYOUT_MODE === "random") {
      // Random placement that keeps large nodes off the outer edge.
      // packSiblings places earlier array elements nearer the centre and the
      // radius of element i grows like sqrt(cumulative area), so the array
      // RANK maps to radius, not the raw key. A node's final radius is
      // therefore set by its sort position: smaller key => smaller radius.
      // We give every node a random key but cap its ceiling by size, so the
      // bigger a node is the lower its rank must be - large nodes are confined
      // to an inner band while small nodes keep the full spread and fill out
      // to the edge.
      const maxR = d3.max(nodes, (n) => n.r);
      nodes.forEach((n) => {
        const sz = n.r / maxR; // 0 (smallest) .. 1 (largest)
        const lo = 0.05 + 0.1 * sz; // keep the biggest off the dead centre
        const hi = 1 - 0.65 * sz; // and well inside the outer edge
        n._sortKey = lo + Math.random() * (hi - lo);
      });
      nodes.sort((a, b) => a._sortKey - b._sortKey);
    } else {
      nodes.sort((a, b) => b.r - a.r);
    }

    const { catMap: centralCatMap, total: centralTotal } =
      ChartBase.buildCentralData(nodes);
    const centralNode = {
      type: "project",
      data: {
        contributor_name: PROJECT_NAME,
        total_contribution_count: centralTotal,
        contribution_count_by_category: centralCatMap,
        contributor_count: nodes.length,
      },
      r: CENTER_RADIUS,
      color: COLOR_PROJECT,
    };

    nodes = [centralNode, ...nodes];

    // packSiblings doesn't guarantee the first element lands at the origin, so
    // shift everything afterward so the project node ends up at (0,0).
    const PAD = 0.5;
    const packed = d3.packSiblings(nodes.map((n) => ({ r: n.r + PAD })));
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].x = packed[i].x;
      nodes[i].y = packed[i].y;
    }
    const proj = nodes.find((n) => n.type === "project");
    const dx = proj.x,
      dy = proj.y;
    nodes.forEach((n) => {
      n.x -= dx;
      n.y -= dy;
    });

    LAYOUT_EXTENT =
      d3.max(nodes, (n) => Math.sqrt(n.x * n.x + n.y * n.y) + n.r) || 700;

    SELECTED_NODE = SELECTED_ID ? findContributorNode(SELECTED_ID) : null;

    interaction.reset();
    chart.resize();
    if (chart.onRerun) chart.onRerun(_lastCategoryStats);
  }

  // -- Drawing ----------------------------------------------
  function draw() {
    context.fillStyle = COLOR_BACKGROUND;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    context.save();
    context.translate(WIDTH / 2, HEIGHT / 2);

    nodes.forEach((n) => drawNode(context, n));

    context.restore();
  }

  function drawNode(ctx, n) {
    if (n.type === "project") {
      drawCenterNode(ctx);
      return;
    }
    ctx.fillStyle = n.color;
    ctx.beginPath();
    ctx.arc(n.x * SF, n.y * SF, n.r * SF, 0, TAU);
    ctx.fill();
  }

  // The logo only appears when the center node itself is hovered.
  function drawCenterNode(ctx, hovered = false) {
    const r = CENTER_RADIUS * SF;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = COLOR_PROJECT;
    ctx.fill();

    ChartBase.drawProjectNodeContent(ctx, {
      cx: 0,
      cy: 0,
      r,
      name: PROJECT_NAME,
      logoImage: hovered ? _logoImage : null,
      COLOR_TEXT,
      FONT_FAMILY,
      fontSize: 30 * SF,
      letterSpacing: 0,
    });
  }

  const drawNodeHighlight = (ctx, n) =>
    ChartBase.drawNodeHighlight(ctx, n, { SF, TAU, COLOR_BACKGROUND });

  // -- Resize -----------------------------------------------
  function findContributorNode(id) {
    return (
      nodes.find(
        (n) => n.type === "contributor" && n.data.contributor_id === id,
      ) || null
    );
  }

  chart.resize = () => {
    ({ PIXEL_RATIO, WIDTH, HEIGHT } = ChartBase.sizeCanvasLayers(
      layers,
      width,
      height,
    ));

    // Scale logical space so the packed cluster fits with margin for tooltips
    SF = Math.min(WIDTH, HEIGHT) / (2 * LAYOUT_EXTENT * 1.1);

    if (nodes.length > 0) {
      delaunay = d3.Delaunay.from(nodes.map((n) => [n.x, n.y]));
    }

    draw();
    selectionHighlight.draw();
  };

  function drawHoverState(ctx, d) {
    ChartBase.drawClusterHoverState(ctx, d, {
      WIDTH,
      HEIGHT,
      isCenterNode: (n) => n.type === "project",
      drawCenter: drawCenterNode,
      drawHighlight: drawNodeHighlight,
    });
  }

  // -- Hit detection ----------------------------------------
  function findNode(mx, my) {
    if (!delaunay || nodes.length === 0) return [null, false];
    mx = (mx * PIXEL_RATIO - WIDTH / 2) / SF;
    my = (my * PIXEL_RATIO - HEIGHT / 2) / SF;

    const i = delaunay.find(mx, my);
    const d = nodes[i];
    if (!d) return [null, false];
    const dist = sqrt((d.x - mx) ** 2 + (d.y - my) ** 2);
    const FOUND = dist < d.r + 8;
    return [d, FOUND];
  }

  function showContributorTooltip(d) {
    const isCentral = d.type === "project";
    const html = ChartBase.buildContributorTooltipHTML(d, {
      tooltip,
      categoryColor,
      accent: isCentral ? COLOR_PROJECT : COLOR_CONTRIB,
      isProject: isCentral,
    });
    ChartBase.showAnchoredTooltip(tooltip, html, d, {
      width,
      height,
      SF,
      pixelRatio: PIXEL_RATIO,
    });
  }

  const setFont = (ctx, size, weight, style = "normal") =>
    ChartBase.setFont(ctx, FONT_FAMILY, size, weight, style);

  // -- Accessors --------------------------------------------
  chart.width = function (v) {
    if (!arguments.length) return width;
    width = v;
    return chart;
  };
  chart.height = function (v) {
    if (!arguments.length) return height;
    height = v;
    return chart;
  };
  chart.project = function (data) {
    if (!arguments.length) return PROJECT_NAME;
    if (!data || !data.name) throw new Error("project.json must define a name");
    PROJECT_NAME = data.name;
    if (data.logo) {
      ChartBase.loadProjectImage(data.logo, (img) => {
        _logoImage = img;
        draw();
      });
    }
    return chart;
  };

  chart.fullDateRange = () => [FULL_MIN, FULL_MAX];
  chart.setRange = (s, e) => {
    const newStart = s == null ? null : s;
    const newEnd = e == null ? null : e;
    if (newStart === RANGE_START && newEnd === RANGE_END) return;
    RANGE_START = newStart;
    RANGE_END = newEnd;
    if (raw_contributions_all) rerun();
  };
  chart.reset = () => {
    RANGE_START = null;
    RANGE_END = null;
    ACTIVE_CATEGORIES = null;
    rerun();
  };
  chart.allCategories = () => scale_category_color.domain().slice();
  chart.getCategoryStats = () => _lastCategoryStats;
  chart.setCategories = (cats) => {
    ACTIVE_CATEGORIES =
      !cats || (Array.isArray(cats) && !cats.length) ? null : new Set(cats);
    rerun();
  };
  chart.getActiveCategories = () => ACTIVE_CATEGORIES;
  chart.categoryColor = categoryColor;
  chart.layout = function (mode) {
    if (!arguments.length) return LAYOUT_MODE;
    if (mode !== "sorted" && mode !== "random") return chart;
    if (mode === LAYOUT_MODE) return chart;
    LAYOUT_MODE = mode;
    if (raw_contributions_all) rerun();
    return chart;
  };
  chart.selectContributor = function (id) {
    SELECTED_ID = id || null;
    SELECTED_NODE = id ? findContributorNode(id) : null;
    selectionHighlight.restart();
    return chart;
  };

  chart.onRerun = null;

  window.addEventListener("themechange", () => {
    readColors();
    container.style.backgroundColor = COLOR_BACKGROUND;
    rerun();
  });

  return chart;
}
