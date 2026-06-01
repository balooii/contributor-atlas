export function createTooltip(container, options = {}) {
  const OX = options.offsetX ?? 14;
  const OY = options.offsetY ?? 14;

  const el = document.createElement("div");
  el.className = "ca-chart-tooltip";
  if (options.font) el.style.font = options.font;
  if (options.zIndex != null) el.style.zIndex = options.zIndex;
  if (options.color) el.style.color = options.color;
  container.appendChild(el);

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  }

  // One category row: colored square + name + count [+ pct%]
  // Pass pct=null to omit the percentage (e.g. Trails segment tooltips)
  function categoryRow(cat, count, pct, color) {
    const pctStr = pct != null ? ` (${pct}%)` : "";
    return (
      `<div class="ca-tt-cat-row">` +
      `<span class="ca-tt-cat-swatch" style="background:${color}"></span>` +
      `<span class="ca-tt-cat-name">${escapeHtml(cat)}</span>` +
      `<span class="ca-tt-cat-count">${count}${pctStr}</span>` +
      `</div>`
    );
  }

  // Build a sorted set of category rows from a scale domain + counts lookup.
  // domain - array of category names; counts - { cat: n }; colorFn - (cat) => hex
  function categoryRows(domain, counts, total, colorFn) {
    return domain
      .map((cat) => ({ cat, count: counts[cat] || 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .map((r) =>
        categoryRow(
          r.cat,
          r.count,
          Math.round((r.count / total) * 100),
          colorFn(r.cat),
        ),
      )
      .join("");
  }

  // "1 contribution" / "3 contributions". Pass display to show a formatted
  // count (e.g. "1.2k") while pluralizing on the true number.
  function pluralize(n, noun, display = n) {
    return `${display} ${noun}${n === 1 ? "" : "s"}`;
  }

  // Cursor-anchored positioning - used by Pulse and Trails.
  // clientX/clientY are raw viewport coords from a MouseEvent.
  function show(html, clientX, clientY) {
    el.innerHTML = html;
    el.style.display = "block";
    const r = container.getBoundingClientRect();
    let left = clientX - r.left + OX;
    let top = clientY - r.top + OY;
    const ttW = el.offsetWidth,
      ttH = el.offsetHeight;
    if (left + ttW > r.width - 4) left = clientX - r.left - ttW - OX;
    if (top + ttH > r.height - 4) top = clientY - r.top - ttH - OY;
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  // Node-anchored centered positioning - used by Cornerstones, Gathering, Ripples.
  // containerX/containerY are CSS-pixel coords relative to the container.
  // placement: "above" | "below"
  function showAt(html, containerX, containerY, placement) {
    el.innerHTML = html;
    el.style.display = "block";
    const ttW = el.offsetWidth,
      ttH = el.offsetHeight;
    const top = placement === "above" ? containerY - ttH - 20 : containerY + 20;
    const left = Math.max(
      4,
      Math.min(container.offsetWidth - ttW - 4, containerX - ttW / 2),
    );
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  function hide() {
    el.style.display = "none";
  }
  function destroy() {
    el.parentNode?.removeChild(el);
  }

  return {
    show,
    showAt,
    hide,
    destroy,
    escapeHtml,
    categoryRow,
    categoryRows,
    pluralize,
  };
}
