// The island body as a single path whose top corners are convex, sharp or
// concave depending on the sign of topRadius:
//
//   topRadius > 0 → convex rounded top corners (expanded)
//   topRadius < 0 → concave ear cutouts, |topRadius| = ear radius (compact)
//   topRadius = 0 → sharp top corners (transient while animating)
//
// The sign is what makes the compact island melt into the top edge of the
// screen instead of reading as a bar floating below it.

export function islandPath(
  w: number,
  h: number,
  radius: number,
  topRadius: number,
): string {
  if (w <= 0 || h <= 0) return "";
  const r = Math.min(radius, Math.min(w, h) / 2);

  if (topRadius > 0) {
    // ── Convex top corners ──────────────────────────────────────────────
    const tr = Math.min(topRadius, w / 2);
    return [
      `M ${tr} 0`,
      `L ${w - tr} 0`,
      `A ${tr} ${tr} 0 0 1 ${w} ${tr}`,
      `L ${w} ${h - r}`,
      `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
      `L ${r} ${h}`,
      `A ${r} ${r} 0 0 1 0 ${h - r}`,
      `L 0 ${tr}`,
      `A ${tr} ${tr} 0 0 1 ${tr} 0`,
      "Z",
    ].join(" ");
  }

  if (topRadius < 0) {
    // ── Concave ear cutouts ─────────────────────────────────────────────
    // The ears are carved out of the body so the compact island flows into the
    // screen edge rather than sitting on it as a rounded rectangle.
    const er = Math.min(-topRadius, w / 2);
    return [
      `M 0 0`,
      `A ${er} ${er} 0 0 0 ${er} ${er}`,
      `L ${w - er} ${er}`,
      `A ${er} ${er} 0 0 0 ${w} 0`,
      `L ${w} ${h - r}`,
      `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
      `L ${r} ${h}`,
      `A ${r} ${r} 0 0 1 0 ${h - r}`,
      "Z",
    ].join(" ");
  }

  // ── Sharp top corners ─────────────────────────────────────────────────
  return [
    `M 0 0`,
    `L ${w} 0`,
    `L ${w} ${h - r}`,
    `A ${r} ${r} 0 0 1 ${w - r} ${h}`,
    `L ${r} ${h}`,
    `A ${r} ${r} 0 0 1 0 ${h - r}`,
    "Z",
  ].join(" ");
}

/** Quadratic through the four corner points, for the canvas halo when the shape
 *  is being stroked rather than filled. */
export function islandOutline(
  w: number,
  h: number,
  radius: number,
  topRadius: number,
): string {
  return islandPath(w, h, radius, topRadius);
}
