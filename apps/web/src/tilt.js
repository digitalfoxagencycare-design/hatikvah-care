/** Rotation for a pointer at (x, y) inside a w × h element: the corner under the pointer tips away, up to max degrees. */
export function tiltAngles(x, y, w, h, max = 8) {
  const across = Math.min(1, Math.max(0, x / w)), down = Math.min(1, Math.max(0, y / h));
  return { rx: +((0.5 - down) * 2 * max).toFixed(2), ry: +((across - 0.5) * 2 * max).toFixed(2), gx: Math.round(across * 100), gy: Math.round(down * 100) };
}

const still = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Pointer handlers that set --rx, --ry, --gx and --gy for the stylesheet. Through the style object, so the site's Content-Security-Policy allows it. */
export const tiltHandlers = (max) => ({
  onPointerMove(e) {
    if (e.pointerType !== "mouse" || still()) return;
    const el = e.currentTarget, r = el.getBoundingClientRect();
    const { rx, ry, gx, gy } = tiltAngles(e.clientX - r.left, e.clientY - r.top, r.width, r.height, max);
    el.style.setProperty("--rx", `${rx}deg`); el.style.setProperty("--ry", `${ry}deg`);
    el.style.setProperty("--gx", `${gx}%`); el.style.setProperty("--gy", `${gy}%`);
  },
  onPointerLeave(e) { for (const v of ["--rx", "--ry", "--gx", "--gy"]) e.currentTarget.style.removeProperty(v); },
});
