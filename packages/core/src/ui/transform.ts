/**
 * Computes the affine transform matrix that maps element-local coordinates
 * to viewport coordinates, accounting for ALL CSS transforms (own + ancestors).
 *
 * Uses DOM probing: temporarily inserts zero-size positioned elements at known
 * corners, reads their viewport positions via getBoundingClientRect(), and derives
 * the 2D affine matrix from 3 corner measurements.
 *
 * Returns identity matrix if the element has no visual transform.
 */
export function getElementToViewportMatrix(el: HTMLElement): DOMMatrix {
  const w = el.offsetWidth;
  const h = el.offsetHeight;

  if (w === 0 && h === 0) return new DOMMatrix();

  // Quick check: if getBoundingClientRect matches offsetWidth/offsetHeight,
  // there's no transform — skip probing
  const rect = el.getBoundingClientRect();
  if (Math.abs(rect.width - w) < 1 && Math.abs(rect.height - h) < 1) {
    return new DOMMatrix([1, 0, 0, 1, rect.left, rect.top]);
  }

  // Ensure element is a positioning context for the probe
  const savedPosition = el.style.position;
  const cs = getComputedStyle(el);
  if (cs.position === "static") {
    el.style.position = "relative";
  }

  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;width:0;height:0;margin:0;padding:0;border:0;pointer-events:none;";
  el.appendChild(probe);

  // Top-left corner
  probe.style.left = "0px";
  probe.style.top = "0px";
  let r = probe.getBoundingClientRect();
  const tlx = r.left,
    tly = r.top;

  // Top-right corner
  probe.style.left = `${w}px`;
  probe.style.top = "0px";
  r = probe.getBoundingClientRect();
  const trx = r.left,
    try_ = r.top;

  // Bottom-left corner
  probe.style.left = "0px";
  probe.style.top = `${h}px`;
  r = probe.getBoundingClientRect();
  const blx = r.left,
    bly = r.top;

  probe.remove();
  el.style.position = savedPosition;

  // Derive 2D affine matrix from 3 corners:
  // screen = matrix * local, where local (0,0)→TL, (w,0)→TR, (0,h)→BL
  const a = (trx - tlx) / w;
  const b = (try_ - tly) / w;
  const c = (blx - tlx) / h;
  const d = (bly - tly) / h;

  return new DOMMatrix([a, b, c, d, tlx, tly]);
}

/**
 * Returns true if the element has any visual transform (own or inherited).
 */
export function hasVisualTransform(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  return Math.abs(rect.width - w) >= 1 || Math.abs(rect.height - h) >= 1;
}
