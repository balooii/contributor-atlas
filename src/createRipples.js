import * as d3 from "d3";
import { createTooltip } from "./createTooltip.js";
import * as ChartBase from "./chartBase.js";

export function createRipples(container) {
  container.classList.add("ca-view");

  const PI = Math.PI;
  const TAU = PI * 2;

  const cos = Math.cos;
  const sin = Math.sin;
  const sqrt = Math.sqrt;

  let nodes = [];
  let single_nodes = []; // count == 1: single time contributors drawn in side wings
  let main_nodes = []; // count >= 2: everyone else in the main disc (log radial scale)
  let _wingLayout = null; // { centers, halfAngle, innerEdge, outerEdge } for wing-background drawing
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

  let COLOR_BACKGROUND, COLOR_PROJECT, COLOR_CONTRIBUTOR, COLOR_HIGHLIGHT;
  let COLOR_RING_EVEN, COLOR_RING_ODD, COLOR_RING_STROKE;
  let GLOW_RGB, GLOW_ALPHA, VIGNETTE_ALPHA, NODE_GLOW, NODE_GLOW_ALPHA;
  let FONT_FAMILY;
  function readColors() {
    const cs = getComputedStyle(container);
    COLOR_BACKGROUND = cs.getPropertyValue("--c-bg").trim();
    COLOR_PROJECT = cs.getPropertyValue("--c-project").trim();
    GLOW_RGB = cs.getPropertyValue("--c-glow").trim();
    GLOW_ALPHA = cs.getPropertyValue("--c-glow-alpha").trim();
    VIGNETTE_ALPHA = cs.getPropertyValue("--c-vignette-alpha").trim();
    NODE_GLOW = cs.getPropertyValue("--c-node-glow").trim();
    NODE_GLOW_ALPHA = cs.getPropertyValue("--c-node-glow-alpha").trim();
    COLOR_CONTRIBUTOR = cs.getPropertyValue("--c-contributor").trim();
    COLOR_HIGHLIGHT = cs.getPropertyValue("--c-highlight").trim();
    COLOR_RING_EVEN = cs.getPropertyValue("--c-ring-even").trim();
    COLOR_RING_ODD = cs.getPropertyValue("--c-ring-odd").trim();
    COLOR_RING_STROKE = cs.getPropertyValue("--c-ring-stroke").trim();
    FONT_FAMILY = cs.getPropertyValue("--font-family").trim();
  }
  readColors();

  let scale_category_color = d3.scaleOrdinal();
  const categoryColor = (cat) => scale_category_color(cat);

  let SELECTED_ID = null;
  let SELECTED_NODE = null;

  const layers = ChartBase.createCanvasLayers(container, COLOR_BACKGROUND);
  const canvas = layers.base,
    canvas_hover = layers.hover;
  const context = layers.baseCtx,
    context_click = layers.clickCtx,
    context_hover = layers.hoverCtx;

  const tooltip = createTooltip(container, { zIndex: 22 });

  const selectionHighlight = ChartBase.makeSelectionHighlight({
    context_click,
    getState: () => ({ WIDTH, HEIGHT, SF, COLOR_HIGHLIGHT, TAU }),
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
  let _layoutMaxR = LAYOUT_OUTER; // main-disc outer edge after layout (fallback before first rerun)
  // Half-extents of the whole layout (disc + wings) in logical units, measured
  // each resize. The cluster halo/vignette tracks this bounding ellipse - the
  // wings make it wider than tall, so a single radius wouldn't bound it.
  let CLUSTER_XR = LAYOUT_OUTER,
    CLUSTER_YR = LAYOUT_OUTER;

  // Side-wing layout for the count==1 nodes
  const WING_MIN_ASPECT = 1.2;
  const WING_MIN_HALF_ANGLE = (18 * PI) / 180;
  const WING_MAX_HALF_ANGLE = (72 * PI) / 180; // leave a gap at the poles
  const WING_DISC_GAP = 10; // empty gap between the disc edge and the wings
  const SINGLE_GAP = 1.5;

  // Dot size scale (sqrt - contribution counts are heavy-tailed)
  const scale_dot_radius = d3.scaleSqrt().range([2, 28]);
  // Radial-position scale (log - counts span orders of magnitude). Inverted: big count -> small radius.
  const scale_target_radius = d3
    .scaleLog()
    .range([LAYOUT_OUTER, LAYOUT_INNER])
    .clamp(true);

  function chart(values) {
    const parsed = ChartBase.parseChartValues(values);
    raw_contributions_all = parsed.contributions;
    catToGroup = parsed.catToGroup;
    FULL_MIN = parsed.FULL_MIN;
    FULL_MAX = parsed.FULL_MAX;
    scale_category_color = parsed.scale_category_color;
    rerun();
  }

  // Groups nodes by exact contribution count (same count => same node_r) and
  // anchors each group at its log-scale target radius. Processes groups
  // innermost-first, filling concentric sub-rings: each ring spreads its nodes
  // evenly around the full circle, stepping out by 2*node_r + gap when full.
  // Returns the actual max radius (outermost node edge) for dynamic SF scaling.
  function placeNodes(allNodes) {
    const gap = 1.5;
    let maxR = LAYOUT_INNER;

    const countGroups = d3.group(allNodes, (d) => d.count);
    const sortedCounts = Array.from(countGroups.keys()).sort((a, b) => b - a);

    for (const count of sortedCounts) {
      const group = countGroups.get(count);
      const node_r = group[0].r;
      const step = 2 * node_r + gap;

      let current_r = scale_target_radius(count);
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
    }

    return maxR;
  }

  // Places the count==1 nodes (likely to be majority of nodes). On a non-square
  // viewport they fill two side wings along the long axis (left/right when landscape,
  // top/bottom when portrait), freeing the short axis so the main disc. Therefore
  // every node on the disc scales larger.
  // Near-square viewports have no lateral slack so singles are placed the same way as
  // as other count groups - within full concentric rings around the center.
  function layoutSingles() {
    if (single_nodes.length === 0) {
      _wingLayout = null;
      return;
    }

    const node_r = single_nodes[0].r;
    const step = 2 * node_r + SINGLE_GAP;
    const aspect = Math.max(WIDTH, HEIGHT) / Math.min(WIDTH, HEIGHT);
    const innerR = _layoutMaxR + WING_DISC_GAP + node_r;

    let centers, halfAngle, fullRing;
    if (aspect < WING_MIN_ASPECT) {
      centers = [0];
      halfAngle = PI;
      fullRing = true;
    } else {
      // Mathematically speaking a wing is a annulus sector. We need to find
      // inner (ri) and outer radius (Ro) to determine how wide each wing should be
      // and how they extend outwards.
      // We want the wing to roughly equal the discs height (discR). This complicates
      // things but looks better (avoids having overly "thick" wings no using
      // available height).
      // Place wings either left+right or top+bottom depending on aspect ratio.
      // Formula for annulus sector area (our wing): 2*halfAngle*(Ro^2 - ri^2)
      const N = single_nodes.length;
      const discR = _layoutMaxR;
      const ri = innerR;
      const need = N * step * step; // approx area needed for nodes

      // binary search to find smallest outer radius that fits all nodes
      let lo = ri * 1.0001;
      let hi = ri * 8;
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        const f =
          2 * Math.asin(Math.min(1, discR / mid)) * (mid * mid - ri * ri) -
          need;
        if (f > 0) hi = mid;
        else lo = mid;
      }
      let Ro = hi;

      // Don't let the wings overshoot the disc
      const RoCap = discR * aspect * 0.99;
      if (Ro <= RoCap) {
        // wing fits, use natural angle
        halfAngle = Math.asin(Math.min(1, discR / Ro));
      } else {
        // wing would extend too far; keep Ro at max then calc angle that
        // fits all nodes
        Ro = RoCap;
        halfAngle = need / (2 * (Ro * Ro - ri * ri));
      }
      halfAngle = Math.max(
        WING_MIN_HALF_ANGLE,
        Math.min(WING_MAX_HALF_ANGLE, halfAngle),
      );
      centers = WIDTH >= HEIGHT ? [0, PI] : [PI / 2, -PI / 2]; // orientation
      fullRing = false;
    }

    // now that we have our geometry we can place the nodes
    const span = fullRing ? TAU : 2 * halfAngle;
    let r = innerR;
    let idx = 0;
    while (idx < single_nodes.length) {
      const perWing = Math.max(1, Math.floor((span * r) / step));
      for (const c of centers) {
        for (let k = 0; k < perWing && idx < single_nodes.length; k++) {
          let angle;
          if (fullRing) {
            // Fallback (no wings). Evenly distribute around full circle
            angle = c + (k / perWing) * TAU;
          } else {
            if (perWing === 1) {
              // Only one node fits on this wing ring. Place it at wing center
              angle = c;
            } else {
              // Multiple nodes fit on this wing ring.
              const t = k / (perWing - 1); // 0..1
              const startAngle = c - halfAngle;
              const endAngle = c + halfAngle;
              angle = startAngle + t * (endAngle - startAngle);
            }
          }
          const n = single_nodes[idx++];
          n.x = r * cos(angle);
          n.y = r * sin(angle);
        }
      }
      r += step;
    }

    _wingLayout = {
      centers,
      halfAngle, // PI for the full-ring fallback
      nodeR: node_r,
      innerEdge: innerR - node_r,
      outerEdge: r - step + node_r,
    };
  }

  function rerun() {
    ({ nodes: nodes, categoryStats: _lastCategoryStats } =
      ChartBase.runPipeline(
        raw_contributions_all,
        range.start,
        range.end,
        ACTIVE_CATEGORIES,
        catToGroup,
      ));

    const {
      catMap: centerCatMap,
      total: centerTotal,
      secMin: centerSecMin,
      secMax: centerSecMax,
    } = ChartBase.buildCentralData(nodes);
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
        contribution_sec_min: centerSecMin,
        contribution_sec_max: centerSecMax,
      },
    };

    if (nodes.length === 0) {
      main_nodes = [];
      single_nodes = [];
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
      n.color = n.dominant_cat
        ? categoryColor(n.dominant_cat)
        : COLOR_CONTRIBUTOR;
    });

    single_nodes = nodes.filter((n) => n.count === 1);
    main_nodes = nodes.filter((n) => n.count > 1);
    _layoutMaxR = main_nodes.length ? placeNodes(main_nodes) : LAYOUT_INNER;

    if (SELECTED_ID) {
      SELECTED_NODE = findContributorNode(SELECTED_ID);
    }
    selectionHighlight.cancel();

    interaction.reset();
    chart.resize();
    if (chart.onRerun) chart.onRerun(_lastCategoryStats);
  }

  // The disc + two lateral wings are wider than tall, so the halo tracks the
  // layout's bounding ellipse (semi-axes from the measured cluster extents).
  function drawClusterHalo() {
    ChartBase.drawClusterHalo(context, {
      cx: WIDTH / 2,
      cy: HEIGHT / 2,
      xr: Math.max(CENTER_RADIUS, CLUSTER_XR) * SF,
      yr: Math.max(CENTER_RADIUS, CLUSTER_YR) * SF,
      WIDTH,
      HEIGHT,
      GLOW_RGB,
      glowAlpha: GLOW_ALPHA,
      vigAlpha: VIGNETTE_ALPHA,
    });
  }

  function drawRings() {
    const fillEven = COLOR_RING_EVEN;
    const fillOdd = COLOR_RING_ODD;
    const strokeCol = COLOR_RING_STROKE;

    context.save();
    context.translate(WIDTH / 2, HEIGHT / 2);
    context.lineWidth = 0.7 * SF;

    const N = 8; // number of rings
    const logOuter = Math.log(_layoutMaxR);
    const logInnerBound = Math.log(CENTER_RADIUS * 2);
    const hasDisc = _layoutMaxR > CENTER_RADIUS * 2;
    // Outermost ring thickness (logical units), reused to space the wing-background strips.
    const discRingT =
      _layoutMaxR -
      Math.exp(logOuter + (1 / (N - 1)) * (logInnerBound - logOuter));

    if (hasDisc) {
      const radii = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        radii.push(Math.exp(logOuter + t * (logInnerBound - logOuter)) * SF);
      }

      // Opaque base so the warm cluster halo stays behind the disc rather than
      // bleeding through the translucent ring bands
      context.fillStyle = COLOR_BACKGROUND;
      context.beginPath();
      context.arc(0, 0, radii[0], 0, TAU);
      context.fill();

      for (let i = 0; i < radii.length - 1; i++) {
        context.beginPath();
        context.arc(0, 0, radii[i], 0, TAU);
        context.arc(0, 0, radii[i + 1], 0, TAU, true);
        context.closePath();
        context.fillStyle = i % 2 === 0 ? fillEven : fillOdd;
        context.fill();
      }

      context.strokeStyle = strokeCol;
      for (const r of radii) {
        context.beginPath();
        context.arc(0, 0, r, 0, TAU);
        context.stroke();
      }
    }

    // Wing background
    if (_wingLayout) {
      const { centers, halfAngle, nodeR, innerEdge, outerEdge } = _wingLayout;
      const bgStripT = hasDisc ? discRingT : (outerEdge - innerEdge) / 6;
      const stripCount = Math.max(
        1,
        Math.round((outerEdge - innerEdge) / bgStripT),
      );
      const t = (outerEdge - innerEdge) / stripCount;
      // Widen the sector so the edge dots (centred on the angular boundary) sit
      // fully on the strip; skip the pad for the full-ring fallback.
      const sectorHalf =
        halfAngle >= PI ? halfAngle : halfAngle + nodeR / innerEdge;

      // Opaque base so the halo stays behind the wings too (see disc above).
      context.fillStyle = COLOR_BACKGROUND;
      for (const c of centers) {
        context.beginPath();
        context.arc(0, 0, outerEdge * SF, c - sectorHalf, c + sectorHalf);
        context.arc(0, 0, innerEdge * SF, c + sectorHalf, c - sectorHalf, true);
        context.closePath();
        context.fill();
      }

      for (let j = 0; j < stripCount; j++) {
        const rIn = (innerEdge + j * t) * SF;
        const rOut = (innerEdge + (j + 1) * t) * SF;
        context.fillStyle = j % 2 === 0 ? fillEven : fillOdd;
        for (const c of centers) {
          context.beginPath();
          context.arc(0, 0, rOut, c - sectorHalf, c + sectorHalf);
          context.arc(0, 0, rIn, c + sectorHalf, c - sectorHalf, true);
          context.closePath();
          context.fill();
        }
      }

      context.strokeStyle = strokeCol;
      for (let j = 0; j <= stripCount; j++) {
        const rr = (innerEdge + j * t) * SF;
        for (const c of centers) {
          context.beginPath();
          context.arc(0, 0, rr, c - sectorHalf, c + sectorHalf);
          context.stroke();
        }
      }
    }

    context.restore();
  }

  function draw() {
    context.fillStyle = COLOR_BACKGROUND;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    drawClusterHalo();

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

    // Spherical sheen to give it some depth
    const sheen = ctx.createRadialGradient(
      -r * 0.35,
      -r * 0.35,
      r * 0.1,
      0,
      0,
      r,
    );
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.22)");
    sheen.addColorStop(0.6, "rgba(255, 255, 255, 0.05)");
    sheen.addColorStop(1, "rgba(0, 0, 0, 0.12)");
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    // Glowing rim
    ctx.strokeStyle = `rgba(${GLOW_RGB}, 0.7)`;
    ctx.lineWidth = Math.max(1.4, 1.8 * SF);
    ctx.beginPath();
    ctx.arc(0, 0, r - ctx.lineWidth / 2, 0, TAU);
    ctx.stroke();

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
    ChartBase.drawNodeHighlight(ctx, n, {
      SF,
      TAU,
      COLOR_BACKGROUND,
      NODE_GLOW,
      NODE_GLOW_ALPHA,
    });

  function findContributorNode(id) {
    return nodes.find((n) => n.data.contributor_id === id) || null;
  }

  chart.resize = () => {
    ({ PIXEL_RATIO, WIDTH, HEIGHT } = ChartBase.sizeCanvasLayers(
      layers,
      width,
      height,
    ));

    // Position the wings for the current aspect ratio
    layoutSingles();

    // Scale so the full layout (disc + side wings) fits, with margin for
    // tooltips. Wings make the layout wider than tall, so a single radius
    // no longer bounds it. So we measure each axis actual reach separately,
    // seeded with _layoutMaxR so the full-circle rings always stay on screen.
    let xHalf = Math.max(CENTER_RADIUS, _layoutMaxR);
    let yHalf = Math.max(CENTER_RADIUS, _layoutMaxR);
    for (const n of nodes) {
      const ax = Math.abs(n.x) + n.r;
      const ay = Math.abs(n.y) + n.r;
      if (ax > xHalf) xHalf = ax;
      if (ay > yHalf) yHalf = ay;
    }
    CLUSTER_XR = xHalf;
    CLUSTER_YR = yHalf;
    SF = Math.min(WIDTH / (2 * xHalf * 1.05), HEIGHT / (2 * yHalf * 1.05));

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
      accent: isProject ? COLOR_PROJECT : COLOR_CONTRIBUTOR,
      isProject,
    });
    ChartBase.showAnchoredTooltip(tooltip, html, d, {
      width,
      height,
      SF,
      pixelRatio: PIXEL_RATIO,
    });
  }

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
