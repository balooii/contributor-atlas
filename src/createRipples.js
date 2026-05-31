import * as d3 from "d3";
import { createTooltip } from "./createTooltip.js";
import * as ChartBase from "./chartBase.js";

export function createRipples(container) {
  const PI = Math.PI;
  const TAU = PI * 2;

  const cos = Math.cos;
  const sin = Math.sin;
  const sqrt = Math.sqrt;

  // -- State ------------------------------------------------
  let nodes = [];
  let center_node = null;
  let delaunay;
  let raw_contributions_all;
  let catToGroup = {};
  const range = ChartBase.createRangeFilter();
  let FULL_MIN, FULL_MAX;
  let ACTIVE_CATEGORIES = null;
  let _lastCategoryStats = [];
  let PROJECT_NAME;
  let _logoImage = null;

  // -- Colours / fonts --------------------------------------
  let COLOR_BACKGROUND, COLOR_PROJECT, COLOR_CONTRIB, COLOR_ACCENT;
  let FONT_FAMILY;
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    COLOR_BACKGROUND = cs.getPropertyValue("--c-bg").trim();
    COLOR_PROJECT = cs.getPropertyValue("--c-project").trim();
    COLOR_CONTRIB = cs.getPropertyValue("--c-contrib").trim();
    COLOR_ACCENT = cs.getPropertyValue("--accent").trim();
    FONT_FAMILY = cs.getPropertyValue("--font-family").trim();
  }
  readColors();

  let scale_category_color = d3.scaleOrdinal();
  const categoryColor = (cat) => scale_category_color(cat);

  // -- Selection state --------------------------------------
  let SELECTED_ID = null;
  let SELECTED_NODE = null;

  // -- Canvases ---------------------------------------------
  const layers = ChartBase.createCanvasLayers(container, COLOR_BACKGROUND);
  const canvas = layers.base,
    canvas_hover = layers.hover;
  const context = layers.baseCtx,
    context_click = layers.clickCtx,
    context_hover = layers.hoverCtx;

  const tooltip = createTooltip(container, { zIndex: 22 });

  const selectionHighlight = ChartBase.makeSelectionHighlight({
    context_click,
    getState: () => ({ WIDTH, HEIGHT, SF, COLOR_ACCENT, TAU }),
    getNode: () => SELECTED_NODE,
  });

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

  // Logical layout extents (centred coordinate space, units before SF)
  const LAYOUT_OUTER = 600; // log scale upper anchor; not necessarily outermost ring as value gets capped
  const LAYOUT_INNER = 55; // log scale lower anchor; innermost ring starts here
  const CENTER_RADIUS = 40; // logical radius of the central project node
  let _layoutMaxR = LAYOUT_OUTER; // actual outermost node edge after layout (fallback before first rerun)

  // Dot size scale (sqrt - contribution counts are heavy-tailed)
  const scale_dot_radius = d3.scaleSqrt().range([2, 28]);
  // Radial-position scale (log - counts span orders of magnitude). Inverted: big count -> small radius.
  const scale_target_radius = d3
    .scaleLog()
    .range([LAYOUT_OUTER, LAYOUT_INNER])
    .clamp(true);

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

  // -- Layout -----------------------------------------------
  // Groups nodes by exact contribution count (same count => same natural_r and
  // node_r). Processes groups innermost-first. Fills concentric sub-rings,
  // spreading each ring's nodes evenly around the full circle and stepping out
  // by 2*node_r + gap when a ring is full, expanding outward indefinitely.
  // Returns the actual max radius (outermost node edge) for dynamic SF scaling.
  function placeNodes(allNodes) {
    const gap = 1.5;
    // Log scale produces large radial gaps at the outer edge (count=1,2,3).
    // Cap how far each group can stray from the previous group's outer edge.
    const MAX_RING_GAP = 10;
    let maxR = LAYOUT_INNER;
    let lastOuterEdge = LAYOUT_INNER;

    const countGroups = d3.group(allNodes, (d) => d.count);
    const sortedCounts = Array.from(countGroups.keys()).sort((a, b) => b - a);

    for (const count of sortedCounts) {
      const group = countGroups.get(count);
      const node_r = group[0].r;
      const step = 2 * node_r + gap;

      let current_r = Math.min(
        scale_target_radius(count),
        lastOuterEdge + MAX_RING_GAP,
      );
      let idx = 0;

      while (idx < group.length) {
        const cap = Math.max(1, Math.floor((TAU * current_r) / step));
        const ringCount = Math.min(cap, group.length - idx);
        const angle_offset = Math.random() * TAU;

        for (let k = 0; k < ringCount; k++) {
          const angle = angle_offset + (k / ringCount) * TAU;
          const n = group[idx++];
          n.x = current_r * cos(angle);
          n.y = current_r * sin(angle);
        }

        if (current_r + node_r > maxR) maxR = current_r + node_r;
        current_r += step;
      }

      lastOuterEdge = current_r - step + node_r;
    }

    return maxR;
  }

  // -- Pipeline ---------------------------------------------
  function rerun() {
    ({ nodes: nodes, categoryStats: _lastCategoryStats } =
      ChartBase.runPipeline(
        raw_contributions_all,
        range.start,
        range.end,
        ACTIVE_CATEGORIES,
        catToGroup,
      ));

    const { catMap: centerCatMap, total: centerTotal } =
      ChartBase.buildCentralData(nodes);
    center_node = {
      type: "project",
      x: 0,
      y: 0,
      r: CENTER_RADIUS,
      color: COLOR_PROJECT,
      data: {
        contributor_name: PROJECT_NAME,
        total_contribution_count: centerTotal,
        contribution_count_by_category: centerCatMap,
        contributor_count: nodes.length,
      },
    };

    if (nodes.length === 0) {
      _layoutMaxR = LAYOUT_OUTER;
      chart.resize();
      if (chart.onRerun) chart.onRerun(_lastCategoryStats);
      return;
    }

    const maxCount = d3.max(nodes, (n) => n.count);
    scale_dot_radius.domain([1, maxCount]);
    scale_target_radius.domain([1, maxCount]);

    nodes.forEach((n) => {
      n.r = scale_dot_radius(n.count);
      n.color = n.dominant_cat ? categoryColor(n.dominant_cat) : COLOR_CONTRIB;
    });

    _layoutMaxR = placeNodes(nodes);

    if (SELECTED_ID) {
      SELECTED_NODE = findContributorNode(SELECTED_ID);
    }
    selectionHighlight.cancel();

    interaction.reset();
    chart.resize();
    if (chart.onRerun) chart.onRerun(_lastCategoryStats);
  }

  // -- Drawing ----------------------------------------------
  function drawRings() {
    const isLight =
      document.documentElement.getAttribute("data-theme") === "light";
    context.save();
    context.translate(WIDTH / 2, HEIGHT / 2);

    const N = 8;
    const logOuter = Math.log(_layoutMaxR);
    const logInnerBound = Math.log(CENTER_RADIUS * 2);
    const radii = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      radii.push(Math.exp(logOuter + t * (logInnerBound - logOuter)) * SF);
    }

    // alternating filled bands between adjacent rings
    const fillEven = isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)";
    const fillOdd = isLight ? "rgba(0,0,0,0.02)" : "rgba(255,255,255,0.02)";
    for (let i = 0; i < radii.length - 1; i++) {
      const rOuter = radii[i];
      const rInner = radii[i + 1];
      context.beginPath();
      context.arc(0, 0, rOuter, 0, TAU);
      context.arc(0, 0, rInner, 0, TAU, true);
      context.closePath();
      context.fillStyle = i % 2 === 0 ? fillEven : fillOdd;
      context.fill();
    }

    // ring strokes on top
    context.strokeStyle = isLight
      ? "rgba(0,0,0,0.16)"
      : "rgba(255,255,255,0.24)";
    context.lineWidth = 0.7 * SF;
    for (const r of radii) {
      context.beginPath();
      context.arc(0, 0, r, 0, TAU);
      context.stroke();
    }

    context.restore();
  }

  function draw() {
    context.fillStyle = COLOR_BACKGROUND;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    drawRings();

    context.save();
    context.translate(WIDTH / 2, HEIGHT / 2);

    nodes.forEach((n) => drawContributorNode(context, n));
    drawCenterNode(context);

    context.restore();
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
      COLOR_TEXT: COLOR_BACKGROUND,
      FONT_FAMILY,
      fontSize: 13 * SF,
      letterSpacing: 2 * SF,
    });
  }

  function drawContributorNode(ctx, n) {
    ctx.fillStyle = n.color;
    ctx.beginPath();
    ctx.arc(n.x * SF, n.y * SF, n.r * SF, 0, TAU);
    ctx.fill();
  }

  const drawNodeHighlight = (ctx, n) =>
    ChartBase.drawNodeHighlight(ctx, n, { SF, TAU, COLOR_BACKGROUND });

  // -- Resize -----------------------------------------------
  function findContributorNode(id) {
    return nodes.find((n) => n.data.contributor_id === id) || null;
  }

  chart.resize = () => {
    ({ PIXEL_RATIO, WIDTH, HEIGHT } = ChartBase.sizeCanvasLayers(
      layers,
      width,
      height,
    ));

    // Scale so the actual outermost node fits with margin for tooltips
    SF = Math.min(WIDTH, HEIGHT) / (2 * _layoutMaxR * 1.05);

    if (nodes.length > 0) {
      delaunay = ChartBase.buildHitIndex(nodes);
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
    const [lx, ly] = ChartBase.toLogical(mx, my, {
      PIXEL_RATIO,
      WIDTH,
      HEIGHT,
      SF,
    });

    if (center_node && sqrt(lx * lx + ly * ly) < CENTER_RADIUS + 8) {
      return [center_node, true];
    }

    return ChartBase.pickNode(delaunay, nodes, lx, ly, 8);
  }

  function showContributorTooltip(d) {
    const isProject = d.type === "project";
    const html = ChartBase.buildContributorTooltipHTML(d, {
      tooltip,
      categoryColor,
      accent: isProject ? COLOR_PROJECT : COLOR_CONTRIB,
      isProject,
    });
    ChartBase.showAnchoredTooltip(tooltip, html, d, {
      width,
      height,
      SF,
      pixelRatio: PIXEL_RATIO,
    });
  }

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

  chart.selectContributor = function (id) {
    SELECTED_ID = id || null;
    SELECTED_NODE = id ? findContributorNode(id) : null;
    selectionHighlight.restart();
    return chart;
  };

  chart.fullDateRange = () => [FULL_MIN, FULL_MAX];
  chart.setRange = (s, e) => {
    if (range.set(s, e) && raw_contributions_all) rerun();
  };
  chart.reset = () => {
    range.clear();
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
  chart.onRerun = null;

  window.addEventListener("themechange", () => {
    readColors();
    container.style.backgroundColor = COLOR_BACKGROUND;
    rerun();
  });

  return chart;
}
