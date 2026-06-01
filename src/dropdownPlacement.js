// Anchor a left-anchored dropdown panel to whichever side keeps it within its
// visible bounds. Used for theme picker and contributor search dropdowns.

// Returns the horizontal range the dropdown can occupy without being clipped by an ancestor.
function horizontalBounds(el) {
  let left = 0;
  let right = document.documentElement.clientWidth;
  for (let node = el.parentElement; node; node = node.parentElement) {
    // Anything other than `visible` (hidden/auto/scroll/clip) clips children.
    if (getComputedStyle(node).overflowX !== "visible") {
      const r = node.getBoundingClientRect();
      left = Math.max(left, r.left);
      right = Math.min(right, r.right);
    }
  }
  return { left, right };
}

export function placeDropdown(panel, margin = 8) {
  // Reset to the default left-anchored position so a prior open doesn't skew the
  // measurement (if it was flipped to right).
  panel.style.left = "0px";
  panel.style.right = "auto";

  const bounds = horizontalBounds(panel);
  const rect = panel.getBoundingClientRect();

  // Too wide to fit either way
  if (rect.width > bounds.right - bounds.left - margin * 2) return;

  // Overflows the right edge but we have space on its left so switch anchor point.
  if (rect.right > bounds.right - margin) {
    panel.style.left = "auto";
    panel.style.right = "0px";
  }
}
