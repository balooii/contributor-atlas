const createCornerstones = (container) => {
  // -- Constants & variables --------------------------------

  const PI = Math.PI;
  const TAU = PI * 2;

  let cos = Math.cos;
  let sin = Math.sin;
  let min = Math.min;
  let max = Math.max;
  let sqrt = Math.sqrt;

  // Datasets
  let contributors, remainingContributors;
  let nodes = [];
  let links;
  let project_node;

  // Hover options
  let delaunay;
  let nodes_delaunay;
  let delaunay_remaining;
  let HOVER_ACTIVE = false;

  // Visual Settings - Based on SF = 1
  const CENTRAL_RADIUS = 50; // The radius of the central project node
  let RADIUS_CONTRIBUTOR; // The eventual radius along which the contributor nodes are placed
  let RING_WIDTH;

  const MAX_CONTRIBUTOR_WIDTH = 55; // The maximum width (at SF = 1) of the contributor name before it gets wrapped
  const CONTRIBUTOR_PADDING = 20; // The padding between the contributor nodes around the circle (at SF = 1)

  let REMAINING_PRESENT = false; // Is the dataset of remaining contributors present?
  let TOP_N = 30; // Number of top contributors to show in the rings

  // Raw data (preserved across range changes)
  let raw_contributions_all;
  let RANGE_START = null,
    RANGE_END = null;
  let FULL_MIN, FULL_MAX;
  let ACTIVE_CATEGORIES = null; // null = all; Set<string> = selected only
  let _lastCategoryStats = []; // [{cat, count, pct}] updated every rerun

  // -- Colors -----------------------------------------------

  let COLOR_BACKGROUND,
    COLOR_TOP_CONTRIBUTORS_RING,
    COLOR_PROJECT,
    COLOR_CONTRIBUTOR,
    COLOR_LINK,
    COLOR_TEXT;
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    COLOR_BACKGROUND = cs.getPropertyValue("--c-bg").trim();
    COLOR_TOP_CONTRIBUTORS_RING = cs.getPropertyValue("--c-contributor").trim();
    COLOR_PROJECT = cs.getPropertyValue("--c-project").trim();
    COLOR_CONTRIBUTOR = cs.getPropertyValue("--c-contributor").trim();
    COLOR_LINK = cs.getPropertyValue("--c-border").trim();
    COLOR_TEXT = cs.getPropertyValue("--c-text").trim();
  }
  readColors();

  const FONT_FAMILY = "Encode Sans";

  // -- Category arc ring ------------------------------------

  const CATEGORY_RING_GAP = 3; // logical units between node edge and ring
  const CATEGORY_RING_THICKNESS = 6; // radial thickness (logical units)
  const CATEGORY_ARC_SEP = 0.03; // angle gap between arc segments (radians)

  let PROJECT_NAME;
  let _logoImage = null;

  let scale_category_color = d3.scaleOrdinal();

  function categoryColor(cat) {
    return scale_category_color(cat);
  }

  const layers = ChartBase.createCanvasLayers(container, COLOR_BACKGROUND);
  const canvas = layers.base,
    canvas_hover = layers.hover;
  const context = layers.baseCtx,
    context_hover = layers.hoverCtx;

  const loadingOverlay = ChartBase.createLoadingOverlay(container);

  let _activeTick = null;

  const tooltip = createTooltip(container, { zIndex: 22 });

  // -- Sizes ------------------------------------------------

  //Sizes
  const DEFAULT_SIZE = 1500;
  let WIDTH = DEFAULT_SIZE;
  let HEIGHT = DEFAULT_SIZE;
  let width = DEFAULT_SIZE;
  let height = DEFAULT_SIZE;
  let SF, PIXEL_RATIO;

  // -- Scales -----------------------------------------------

  // Based on the number of contributions to the central project
  const scale_contributor_radius = d3.scaleSqrt().range([8, 30]);
  const scale_remaining_contributor_radius = d3.scaleSqrt().range([1, 8]);

  const scale_link_width = d3.scalePow().exponent(0.75).range([1, 2, 60]);

  // -- Entry ------------------------------------------------

  function chart(values) {
    const parsed = ChartBase.parseChartValues(values);
    raw_contributions_all = parsed.contributions;
    FULL_MIN = parsed.FULL_MIN;
    FULL_MAX = parsed.FULL_MAX;
    scale_category_color = parsed.scale_category_color;
    rerun();
  }

  function rerun() {
    nodes = [];

    const rangeFiltered = ChartBase.filterByRange(
      raw_contributions_all,
      RANGE_START,
      RANGE_END,
    );
    const aggregated = ChartBase.aggregateByContributor(
      ChartBase.filterByCategory(rangeFiltered, ACTIVE_CATEGORIES),
    );
    aggregated.sort(
      (a, b) => b.total_contribution_count - a.total_contribution_count,
    );

    const stats = ChartBase.categoryStats(rangeFiltered);
    if (stats.length) _lastCategoryStats = stats; // preserve last non-empty stats on empty filter

    contributors = aggregated.slice(0, TOP_N);
    remainingContributors = aggregated.slice(TOP_N);
    REMAINING_PRESENT = remainingContributors.length > 0;

    prepareData();

    project_node.x = project_node.fx = 0;
    project_node.y = project_node.fy = 0;

    positionContributorNodes();

    // Build contributor -> project links (with node objects) after nodes are fully constructed
    links = nodes
      .filter((n) => n.type === "contributor")
      .map((n) => ({
        source: n,
        target: project_node,
        contribution_count: n.data.total_contribution_count,
      }));
    scale_link_width.domain([
      1,
      10,
      d3.max(links, (d) => d.contribution_count),
    ]);

    if (_activeTick) {
      _activeTick.cancel();
      _activeTick = null;
    }
    if (REMAINING_PRESENT) {
      loadingOverlay.style.display = "flex";
      remainingContributorSimulation(() => {
        loadingOverlay.style.display = "none";
        setupHover();
        chart.resize();
        if (chart.onRerun) chart.onRerun(_lastCategoryStats);
      });
    } else {
      setupHover();
      chart.resize();
      if (chart.onRerun) chart.onRerun(_lastCategoryStats);
    }
  }

  // -- Draw -------------------------------------------------

  function draw() {
    // Fill the background with a color
    context.fillStyle = COLOR_BACKGROUND;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    // Move the visual to the center
    context.save();
    context.translate(WIDTH / 2, HEIGHT / 2);

    // Draw the remaining contributors as small circles outside the contributor ring
    if (REMAINING_PRESENT) {
      context.fillStyle = COLOR_CONTRIBUTOR;
      context.globalAlpha = 0.4;
      remainingContributors.forEach((d) => {
        drawCircle(context, d.x, d.y, SF, d.r);
      }); // forEach
      context.globalAlpha = 1;
    }

    // Draw the ring showing the placement of the top contributors
    drawTopContributorsRing(context, SF);

    // Draw all the links as lines (contributor -> central)
    links.forEach((l) => drawLink(context, SF, l));

    // Draw the project label in the background (in case it is bigger than it's circle)
    drawNodeLabel(context, project_node, true);

    // Draw all the nodes as circles
    nodes.forEach((d) => drawNode(context, SF, d));

    // Draw the labels
    nodes.forEach((d) => drawNodeLabel(context, d));

    context.restore();
  }

  // -- Resize -----------------------------------------------
  chart.resize = () => {
    ({ PIXEL_RATIO, WIDTH, HEIGHT } = ChartBase.sizeCanvasLayers(
      layers,
      width,
      height,
    ));

    // Set the scale factor - scale to ring size with margin for labels outside the ring
    let OUTER_RING = RADIUS_CONTRIBUTOR + (RING_WIDTH / 2) * 2;
    SF = Math.min(WIDTH, HEIGHT) / (2 * OUTER_RING * 1.5);

    // Reset the delaunay for the mouse events
    nodes_delaunay = nodes;
    delaunay = d3.Delaunay.from(nodes_delaunay.map((d) => [d.x, d.y]));
    if (REMAINING_PRESENT)
      delaunay_remaining = d3.Delaunay.from(
        remainingContributors.map((d) => [d.x, d.y]),
      );

    // Draw the visual
    draw();
  }; //function resize

  // -- Data preparation -------------------------------------

  function prepareData() {
    //// CONTRIBUTORS ////
    contributors.forEach((d) => {
      d.color = COLOR_CONTRIBUTOR;

      setContributorFont(context);
      [d.contributor_lines] = getLines(
        context,
        d.contributor_name,
        MAX_CONTRIBUTOR_WIDTH,
      );

      d.contribution_sec_min = ChartBase.parseDateUnix(
        String(d.contribution_sec_min),
      );
      d.contribution_sec_max = ChartBase.parseDateUnix(
        String(d.contribution_sec_max),
      );
    });

    //// REMAINING CONTRIBUTORS ////
    if (REMAINING_PRESENT) {
      remainingContributors = remainingContributors.map((d) => {
        d.contribution_sec_min = ChartBase.parseDateUnix(
          String(d.contribution_sec_min),
        );
        d.contribution_sec_max = ChartBase.parseDateUnix(
          String(d.contribution_sec_max),
        );
        return {
          type: "contributor",
          remaining_contributor: true,
          color: COLOR_CONTRIBUTOR,
          data: d,
        };
      });
    }
    contributors.forEach((d) => {
      nodes.push({
        id: d.contributor_name,
        type: "contributor",
        label: d.contributor_name,
        data: d,
      });
    });

    //// SYNTHETIC PROJECT NODE ////
    const project_cat_map = new Map();
    contributors.forEach((d) => {
      d.contribution_count_by_category.forEach((count, cat) => {
        project_cat_map.set(cat, (project_cat_map.get(cat) || 0) + count);
      });
    });
    if (REMAINING_PRESENT) {
      remainingContributors.forEach((d) => {
        d.data.contribution_count_by_category.forEach((count, cat) => {
          project_cat_map.set(cat, (project_cat_map.get(cat) || 0) + count);
        });
      });
    }
    const project_total = [...project_cat_map.values()].reduce(
      (s, v) => s + v,
      0,
    );
    const project_data = {
      contributor_name: PROJECT_NAME,
      contribution_count_by_category: project_cat_map,
      total_contribution_count: project_total,
      contribution_count: project_total,
      contributor_count: contributors.length + remainingContributors.length,
      color: COLOR_PROJECT,
      name: PROJECT_NAME,
    };
    nodes.push({
      id: PROJECT_NAME,
      type: "project",
      label: PROJECT_NAME,
      data: project_data,
    });

    //// SCALES ////
    scale_contributor_radius.domain(
      d3.extent(contributors, (d) => d.total_contribution_count),
    );
    scale_remaining_contributor_radius.domain([
      0,
      scale_contributor_radius.domain()[0],
    ]);

    //// NODE VISUAL PROPERTIES ////
    nodes.forEach((d, i) => {
      d.index = i;
      d.data.index = i;
      d.x = 0;
      d.y = 0;

      if (d.type === "contributor") {
        d.r = scale_contributor_radius(d.data.total_contribution_count);
      } else if (d.type === "project") {
        d.r = CENTRAL_RADIUS;
      }

      d.color = d.data.color;
    });

    //// SORT: contributors by first contribution date (chronological), the synthetic project node last ////
    nodes.sort((a, b) => {
      const aIsProject = a.type === "project";
      const bIsProject = b.type === "project";
      if (aIsProject !== bIsProject) return aIsProject ? 1 : -1;
      if (
        a.type === "contributor" &&
        a.data.contribution_sec_min &&
        b.data.contribution_sec_min
      ) {
        return a.data.contribution_sec_min - b.data.contribution_sec_min;
      }
      return 0;
    });

    //// PROJECT NODE ////
    project_node = nodes.find((d) => d.type === "project");
    if (!project_node) throw new Error("Project node not found in nodes");
    project_node.r = CENTRAL_RADIUS;
    project_node.padding = CENTRAL_RADIUS;
    project_node.color = COLOR_PROJECT;
    project_node.data.color = COLOR_PROJECT;
  }

  function positionContributorNodes() {
    const contributor_nodes = nodes.filter((d) => d.type === "contributor");
    let sum_radius = contributor_nodes.reduce(
      (acc, curr) => acc + curr.r * 2,
      0,
    );
    sum_radius += contributors.length * CONTRIBUTOR_PADDING;
    const max_r = d3.max(contributor_nodes, (d) => d.r) || 0;
    RADIUS_CONTRIBUTOR = Math.max(
      sum_radius / TAU,
      CENTRAL_RADIUS + max_r + CONTRIBUTOR_PADDING,
    );
    RING_WIDTH = ((RADIUS_CONTRIBUTOR * 2.3) / 2 - RADIUS_CONTRIBUTOR) * 2;

    let angle = 0;
    nodes
      .filter((d) => d.type === "contributor")
      .forEach((d, i) => {
        let contributor_arc = d.r * 2 + CONTRIBUTOR_PADDING;
        let contributor_angle = contributor_arc / RADIUS_CONTRIBUTOR / 2;

        d.x =
          project_node.fx +
          RADIUS_CONTRIBUTOR * cos(angle + contributor_angle - PI / 2);
        d.y =
          project_node.fy +
          RADIUS_CONTRIBUTOR * sin(angle + contributor_angle - PI / 2);
        d.contributor_angle = angle + contributor_angle - PI / 2;
        angle += contributor_angle * 2;

        d.fx = d.x;
        d.fy = d.y;
      }); // forEach
  }

  // -- Force simulation -------------------------------------
  // Run a force simulation to place the remaining contributors somewhere outside the contributor ring
  function remainingContributorSimulation(onDone) {
    let LW = RING_WIDTH;
    let R = RADIUS_CONTRIBUTOR + LW * 2;

    // Initial random position, but outside of the contributor ring
    remainingContributors.forEach((d) => {
      let angle = Math.random() * TAU;
      d.x = (R + Math.random() * 50) * cos(angle);
      d.y = (R + Math.random() * 50) * sin(angle);

      d.r = scale_remaining_contributor_radius(d.data.total_contribution_count);
    }); // forEach

    let simulation = d3
      .forceSimulation()
      .force(
        "collide",
        d3
          .forceCollide()
          .radius((d) => d.r + Math.random() * 20 + 10)
          .strength(1),
      )
      .force("x", d3.forceX().x(0).strength(0.01)) //0.1
      .force("y", d3.forceY().y(0).strength(0.01)); //0.1

    // Add a dummy node to the dataset that is fixed in the center that is as big as the contributor circle
    remainingContributors.push({
      x: 0,
      y: 0,
      fx: 0,
      fy: 0,
      r: RADIUS_CONTRIBUTOR + LW * 0.75,
      id: "dummy",
    });

    // Perform the simulation
    simulation.nodes(remainingContributors).stop();

    if (_activeTick) _activeTick.cancel();
    _activeTick = ChartBase.tickAsync(simulation, 30, 10, () => {
      _activeTick = null;
      // Remove the dummy node from the dataset again
      remainingContributors.pop();
      if (onDone) onDone();
    });
  }

  // -- Background -------------------------------------------
  // Draw a ring around the central node to show the top contributors
  function drawTopContributorsRing(context, SF) {
    context.fillStyle = context.strokeStyle = COLOR_TOP_CONTRIBUTORS_RING;
    let LW = RING_WIDTH;
    let O = 4;
    context.lineWidth = 1.5 * SF;

    context.beginPath();
    context.moveTo(0 + (RADIUS_CONTRIBUTOR + LW / 2) * SF, 0);
    context.arc(0, 0, (RADIUS_CONTRIBUTOR + LW / 2) * SF, 0, TAU);
    context.moveTo(0 + (RADIUS_CONTRIBUTOR - LW / 2 + O) * SF, 0);
    context.arc(0, 0, (RADIUS_CONTRIBUTOR - LW / 2 + O) * SF, 0, TAU, true);
    context.globalAlpha = 0.12;
    context.fill();
    context.globalAlpha = 0.1;
    context.stroke();
    context.globalAlpha = 1;
  }

  // -- Node drawing -----------------------------------------

  function drawNode(context, SF, d) {
    // Draw a circle for the node
    context.shadowBlur = HOVER_ACTIVE ? 0 : max(2, d.r * 0.2) * SF;
    context.shadowColor = COLOR_BACKGROUND;

    context.fillStyle = d.color;
    drawCircle(context, d.x, d.y, SF, d.r);
    context.shadowBlur = 0;

    // Also draw a stroke around the node
    if (!d.remaining_contributor) {
      context.strokeStyle = COLOR_BACKGROUND;
      context.lineWidth = max(HOVER_ACTIVE ? 1.5 : 1, d.r * 0.07) * SF;
      drawCircle(context, d.x, d.y, SF, d.r, true, true);
      context.stroke();
    }

    // Draw category arc ring outside the circle
    if (!d.remaining_contributor) {
      drawCategoryRing(context, d);
    }
  }

  // Draw colored arc segments outside a node showing category breakdown
  function drawCategoryRing(context, node) {
    const cats = node.data.contribution_count_by_category;
    if (!cats || cats.size === 0) return;
    const total = [...cats.values()].reduce((s, v) => s + v, 0);
    if (total === 0) return;

    const innerR = (node.r + CATEGORY_RING_GAP) * SF;
    const outerR = (node.r + CATEGORY_RING_GAP + CATEGORY_RING_THICKNESS) * SF;
    const cx = node.x * SF;
    const cy = node.y * SF;

    const sorted = [...cats.entries()].sort((a, b) => b[1] - a[1]);
    let cumAngle = -PI / 2; // start at 12 o'clock

    sorted.forEach(([cat, count]) => {
      const sweep = (count / total) * TAU;
      const sep = Math.min(CATEGORY_ARC_SEP, sweep * 0.15);
      const start = cumAngle + sep / 2;
      const end = cumAngle + sweep - sep / 2;
      if (end > start) {
        context.beginPath();
        context.arc(cx, cy, outerR, start, end);
        context.arc(cx, cy, innerR, end, start, true);
        context.closePath();
        context.fillStyle = categoryColor(cat);
        context.fill();
      }
      cumAngle += sweep;
    });
  }

  function drawCircle(context, x, y, SF, r = 10, begin = true, stroke = false) {
    if (begin === true) context.beginPath();
    context.moveTo((x + r) * SF, y * SF);
    context.arc(x * SF, y * SF, r * SF, 0, TAU);
    if (begin && stroke == false) context.fill();
  }

  // -- Line drawing -----------------------------------------

  function drawLink(context, SF, l) {
    if (l.source.x !== undefined && l.target.x !== undefined) {
      calculateLinkGradient(context, l);
      calculateEdgeCenters(l, 1);
      context.strokeStyle = l.gradient;
    } else context.strokeStyle = COLOR_LINK;

    // Base line width
    let line_width = scale_link_width(l.contribution_count);

    context.lineWidth = line_width * SF;
    drawLine(context, SF, l);
  }

  function drawLine(context, SF, line) {
    context.beginPath();
    context.moveTo(line.source.x * SF, line.source.y * SF);
    if (line.center) drawCircleArc(context, SF, line);
    else context.lineTo(line.target.x * SF, line.target.y * SF);
    context.stroke();
  }

  function drawCircleArc(context, SF, line) {
    let center = line.center;
    let ang1 = Math.atan2(
      line.source.y * SF - center.y * SF,
      line.source.x * SF - center.x * SF,
    );
    let ang2 = Math.atan2(
      line.target.y * SF - center.y * SF,
      line.target.x * SF - center.x * SF,
    );
    context.arc(
      center.x * SF,
      center.y * SF,
      line.r * SF,
      ang1,
      ang2,
      line.sign,
    );
  }

  function calculateEdgeCenters(l, size = 2, sign = true) {
    //Find a good radius
    l.r =
      sqrt(sq(l.target.x - l.source.x) + sq(l.target.y - l.source.y)) * size; //Can run from > 0.5
    //Find center of the arc function
    let centers = findCenters(
      l.r,
      { x: l.source.x, y: l.source.y },
      { x: l.target.x, y: l.target.y },
    );
    l.sign = sign;
    l.center = l.sign ? centers.c2 : centers.c1;

    //https://stackoverflow.com/questions/26030023
    //http://jsbin.com/jutidigepeta/3/edit?html,js,output
    function findCenters(r, p1, p2) {
      // pm is middle point of (p1, p2)
      let pm = { x: 0.5 * (p1.x + p2.x), y: 0.5 * (p1.y + p2.y) };
      // compute leading vector of the perpendicular to p1 p2 == C1C2 line
      let perpABdx = -(p2.y - p1.y);
      let perpABdy = p2.x - p1.x;
      // normalize vector
      let norm = sqrt(sq(perpABdx) + sq(perpABdy));
      perpABdx /= norm;
      perpABdy /= norm;
      // compute distance from pm to p1
      let dpmp1 = sqrt(sq(pm.x - p1.x) + sq(pm.y - p1.y));
      // sin of the angle between { circle center,  middle , p1 }
      let sin = dpmp1 / r;
      // is such a circle possible ?
      if (sin < -1 || sin > 1) return null; // no, return null
      // yes, compute the two centers
      let cos = sqrt(1 - sq(sin)); // build cos out of sin
      let d = r * cos;
      let res1 = { x: pm.x + perpABdx * d, y: pm.y + perpABdy * d };
      let res2 = { x: pm.x - perpABdx * d, y: pm.y - perpABdy * d };
      return { c1: res1, c2: res2 };
    }
  }

  function calculateLinkGradient(context, l) {
    // The opacity of the links depends on the number of links
    const scale_alpha = d3
      .scaleLinear()
      .domain([300, 800])
      .range([0.5, 0.2])
      .clamp(true);

    // Incorporate opacity into gradient
    let alpha;
    if (HOVER_ACTIVE) alpha = l.target.type === "project" ? 0.3 : 0.7;
    else alpha = l.target.type === "project" ? 0.15 : scale_alpha(links.length);
    createGradient(l, alpha);

    function createGradient(l, alpha) {
      let col;
      let color_rgb_source;
      let color_rgb_target;

      col = d3.rgb(l.source.color);
      color_rgb_source =
        "rgba(" + col.r + "," + col.g + "," + col.b + "," + alpha + ")";
      col = d3.rgb(l.target.color);
      color_rgb_target =
        "rgba(" + col.r + "," + col.g + "," + col.b + "," + alpha + ")";

      if (l.source.x !== undefined && l.target.x !== undefined) {
        l.gradient = context.createLinearGradient(
          l.source.x * SF,
          l.source.y * SF,
          l.target.x * SF,
          l.target.y * SF,
        );

        // Distance between source and target
        let dist = sqrt(
          sq(l.target.x - l.source.x) + sq(l.target.y - l.source.y),
        );
        // What percentage is the source's radius of the total distance
        let perc = l.source.r / dist;
        // Let the starting color be at perc, so it starts changing color right outside the radius of the source node
        l.gradient.addColorStop(perc, color_rgb_source);
        l.gradient.addColorStop(1, color_rgb_target);
      } else l.gradient = COLOR_LINK;
    }
  }

  // -- Hover ------------------------------------------------
  // Setup the hover on the top canvas, get the mouse position and call the drawing functions
  function setupHover() {
    d3.select("#canvas-hover").on("mousemove", function (event) {
      // Get the position of the mouse on the canvas
      let [mx, my] = d3.pointer(event, this);
      let [d, FOUND] = findNode(mx, my);

      // Draw the hover state on the top canvas
      if (FOUND) {
        HOVER_ACTIVE = true;

        // Fade out the main canvas, using CSS - only when hovering a top
        // contributor. The project node represents every contributor, so
        // keep them all visible on its hover.
        if (d.type === "contributor") canvas.style.opacity = "0.25";
        else canvas.style.opacity = "1";

        // Draw the hovered node and its neighbors and links
        drawHoverState(context_hover, d);
        showContributorTooltip(d);
      } else {
        context_hover.clearRect(0, 0, WIDTH, HEIGHT);
        tooltip.hide();
        HOVER_ACTIVE = false;

        canvas.style.opacity = "1";
      }
    }); // on mousemove

    d3.select("#canvas-hover").on("mouseleave", function () {
      context_hover.clearRect(0, 0, WIDTH, HEIGHT);
      HOVER_ACTIVE = false;
      canvas.style.opacity = "1";
      tooltip.hide();
    });
  }

  // Draw the hovered node and its links and neighbors
  function drawHoverState(context, d) {
    // Draw the hover canvas
    context.save();
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.translate(WIDTH / 2, HEIGHT / 2);

    // Get all the connected links (if not done before)
    if (d.neighbor_links === undefined) {
      d.neighbor_links = links.filter(
        (l) => l.source.id === d.id || l.target.id === d.id,
      );
    }

    // Get all the connected nodes (if not done before)
    if (d.neighbors === undefined) {
      d.neighbors = nodes.filter((n) =>
        links.find(
          (l) =>
            (l.source.id === d.id && l.target.id === n.id) ||
            (l.target.id === d.id && l.source.id === n.id),
        ),
      );
    }

    // Draw all the links to this node
    d.neighbor_links.forEach((l) => {
      drawLink(context, SF, l);
    }); // forEach

    // For remaining contributors (outside the ring), draw a link to the center
    if (d.remaining_contributor) {
      const tempLink = {
        source: d,
        target: project_node,
        contribution_count: d.data.total_contribution_count,
      };
      drawLink(context, SF, tempLink);
      drawNode(context, SF, project_node);
      drawNodeLabel(context, project_node);
    }
    d.neighbors.forEach((n) => drawNode(context, SF, n));
    d.neighbors.forEach((n) => drawNodeLabel(context, n));

    // Draw the hovered node
    drawNode(context, SF, d);
    ChartBase.drawNodeHighlight(context, d, {
      SF,
      TAU,
      COLOR_BACKGROUND,
      innerR: (d.r + CATEGORY_RING_GAP + CATEGORY_RING_THICKNESS) * SF,
    });

    // Show its label (remaining contributors have no wrapped label lines)
    if (d.type === "contributor" && !d.remaining_contributor)
      drawNodeLabel(context, d);
    if (d.type === "project" && _logoImage)
      ChartBase.drawProjectNodeContent(context, {
        cx: d.x * SF,
        cy: d.y * SF,
        r: d.r * SF,
        name: PROJECT_NAME,
        logoImage: _logoImage,
        COLOR_TEXT: COLOR_BACKGROUND,
        FONT_FAMILY,
        fontSize: 15 * SF,
        letterSpacing: 1.25 * SF,
      });

    context.restore();
  }

  // -- Interaction ------------------------------------------

  // Turn the mouse position into a canvas x and y location and see if it's close enough to a node
  function findNode(mx, my) {
    mx = (mx * PIXEL_RATIO - WIDTH / 2) / SF;
    my = (my * PIXEL_RATIO - HEIGHT / 2) / SF;

    //Get the closest hovered node
    let point = delaunay.find(mx, my);
    let d = nodes_delaunay[point];

    // Get the distance from the mouse to the node
    let dist = sqrt((d.x - mx) ** 2 + (d.y - my) ** 2);
    // If the distance is too big, don't show anything
    let FOUND = dist < d.r + 50;

    // Check if the mouse is close enough to one of the remaining contributors of FOUND is false
    if (!FOUND && REMAINING_PRESENT) {
      point = delaunay_remaining.find(mx, my);
      d = remainingContributors[point];
      dist = sqrt((d.x - mx) ** 2 + (d.y - my) ** 2);
      FOUND = dist < d.r + 5;
    }

    return [d, FOUND];
  }

  function showContributorTooltip(d) {
    const isProject = d.type === "project";
    const html = ChartBase.buildContributorTooltipHTML(d, {
      tooltip,
      categoryColor,
      accent: isProject ? COLOR_PROJECT : COLOR_CONTRIBUTOR,
      isProject: isProject,
    });
    ChartBase.showAnchoredTooltip(tooltip, html, d, {
      width,
      height,
      SF,
      pixelRatio: PIXEL_RATIO,
    });
  }

  function drawNodeLabel(context, d, DO_PROJECT_OUTSIDE = false) {
    // Draw the name above each node
    context.fillStyle = COLOR_TEXT;
    context.lineWidth = 2 * SF;
    context.textAlign = "center";

    if (d.type === "project") {
      setProjectFont(context, SF);
    } else if (d.type === "contributor") {
      setContributorFont(context, SF);
    }

    if (d.type === "contributor") {
      context.textBaseline = "middle";

      // Draw the contributor name radiating outward from the contributor's node
      context.save();
      context.translate(d.x * SF, d.y * SF);
      context.rotate(
        d.contributor_angle + (d.contributor_angle > PI / 2 ? PI : 0),
      );
      // Move the max_radius farther away
      context.translate(
        (d.contributor_angle > PI / 2 ? -1 : 1) * (d.r + 14) * SF,
        0,
      );
      context.textAlign = d.contributor_angle > PI / 2 ? "right" : "left";

      let n = d.data.contributor_lines.length;
      let label_line_height = 1.2;
      let font_size = 13;
      d.data.contributor_lines.forEach((l, i) => {
        let x = 0;
        // Let the y-position be the center of the contributor node
        let y =
          (0 -
            ((n - 1) * font_size * label_line_height) / 2 +
            i * font_size * label_line_height) *
          SF;

        renderText(context, l, x, y, 1.25 * SF);
      }); // forEach

      context.restore();
    } else if (d.type === "project") {
      context.textBaseline = "middle";
      context.fillStyle = DO_PROJECT_OUTSIDE ? COLOR_PROJECT : COLOR_BACKGROUND;
      // If this is drawing the text in the inside of the project circle, clip it to that circle
      if (!DO_PROJECT_OUTSIDE) {
        context.save();
        context.beginPath();
        context.arc(d.x * SF, d.y * SF, d.r * SF, 0, 2 * PI);
        context.clip();
      }
      renderText(context, d.label, d.x * SF, d.y * SF, 1.25 * SF);
      if (!DO_PROJECT_OUTSIDE) context.restore();
    }
  }

  // -- Fonts ------------------------------------------------

  const setFont = (ctx, size, weight, style = "normal") =>
    ChartBase.setFont(ctx, FONT_FAMILY, size, weight, style);

  function setProjectFont(context, SF = 1, font_size = 15) {
    setFont(context, font_size * SF, 700, "normal");
  }

  function setContributorFont(context, SF = 1, font_size = 13) {
    setFont(context, font_size * SF, 700, "italic");
  }

  const renderText = ChartBase.renderText;

  //From: https://stackoverflow.com/questions/2936112
  function getLines(context, text, max_width, balance = true) {
    let words = text.split(" ");
    let lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      let word = words[i];
      let width = context.measureText(currentLine + " " + word).width;
      if (width < max_width) {
        currentLine += " " + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);

    //Now that we know how many lines are needed, split those of 2 lines into better balanced sections
    if (balance && lines.length === 2) {
      lines = splitSpring(text);
    }

    //Figure out the maximum width of all the lines
    let max_length = 0;
    lines.forEach((l) => {
      let width = context.measureText(l).width;
      if (width > max_length) max_length = width;
    }); //forEach

    return [lines, max_length];
  }

  function splitSpring(text) {
    let len = text.length;

    //Find the index of all spaces
    let indices = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === " ") indices.push(i);
    }

    //Which space is the closes to the middle
    let diff = indices.map((d) => Math.abs(len / 2 - d));
    let min_value = min(...diff);
    let ind = indices[diff.indexOf(min_value)];

    //Split the string at the "most-middle" space
    let str1 = text.substr(0, ind);
    let str2 = text.substr(ind);

    return [str1.trim(), str2.trim()];
  }

  // -- Helpers ----------------------------------------------

  function sq(x) {
    return x * x;
  }

  chart.width = function (value) {
    if (!arguments.length) return width;
    width = value;
    return chart;
  }; // chart.width

  chart.height = function (value) {
    if (!arguments.length) return height;
    height = value;
    return chart;
  }; // chart.height

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

  chart.topContributors = function (value) {
    if (!arguments.length) return TOP_N;
    TOP_N = value;
    return chart;
  }; // chart.topContributors

  chart.contributors = function () {
    return contributors;
  };
  chart.remainingContributors = function () {
    return remainingContributors;
  };

  chart.fullDateRange = () => [FULL_MIN, FULL_MAX];

  chart.setRange = (start, end) => {
    if (start === RANGE_START && end === RANGE_END) return;
    RANGE_START = start;
    RANGE_END = end;
    if (raw_contributions_all) rerun();
  };

  chart.onRerun = null;

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

  chart.categoryColor = (cat) => categoryColor(cat);

  window.addEventListener("themechange", () => {
    readColors();
    container.style.backgroundColor = COLOR_BACKGROUND;
    rerun();
  });

  return chart;
}; // function createCornerstones
