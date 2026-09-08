// A shared edge uses the same eight samples from either direction.
export const SURFACE_STEPS = 8;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const ease = (t) => t * t * (3 - 2 * t);
export function edgeSurface(a, b, t) {
  const f = t * SURFACE_STEPS,
    i = Math.min(SURFACE_STEPS - 1, Math.floor(f));
  const blend =
    ease(i / SURFACE_STEPS) + (ease((i + 1) / SURFACE_STEPS) - ease(i / SURFACE_STEPS)) * (f - i);
  const p = mix(a, b, t);
  p[1] = a[1] + (b[1] - a[1]) * blend;
  return p;
}
export function surfacePoint(top, u, v) {
  const p = mix(mix(top[0], top[1], u), mix(top[3], top[2], u), v);
  const a = top[0][1] + (top[1][1] - top[0][1]) * ease(u);
  const b = top[3][1] + (top[2][1] - top[3][1]) * ease(u);
  p[1] = a + (b - a) * ease(v);
  return p;
}
// Sample the actual triangles, also used for rooting plants and rocks in the surface.
export function surfaceSample(top, u, v) {
  const n = SURFACE_STEPS,
    i = Math.min(n - 1, Math.floor(u * n)),
    j = Math.min(n - 1, Math.floor(v * n));
  const a = surfacePoint(top, i / n, j / n),
    b = surfacePoint(top, (i + 1) / n, j / n),
    c = surfacePoint(top, (i + 1) / n, (j + 1) / n),
    d = surfacePoint(top, i / n, (j + 1) / n);
  const x = u * n - i,
    y = v * n - j;
  return x >= y
    ? a.map((p, k) => p * (1 - x) + b[k] * (x - y) + c[k] * y)
    : a.map((p, k) => p * (1 - y) + c[k] * x + d[k] * (y - x));
}
export function surfaceNormal(top, u, v) {
  const a = surfacePoint(top, Math.max(0, u - 0.001), v),
    b = surfacePoint(top, Math.min(1, u + 0.001), v);
  const c = surfacePoint(top, u, Math.max(0, v - 0.001)),
    d = surfacePoint(top, u, Math.min(1, v + 0.001));
  const x = b.map((p, k) => p - a[k]),
    y = d.map((p, k) => p - c[k]);
  let n = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const length = Math.hypot(...n) * (n[1] < 0 ? -1 : 1);
  return n.map((p) => p / length);
}
