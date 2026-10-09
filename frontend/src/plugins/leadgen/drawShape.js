// Turning a freehand pencil line into the shape the search sends: fewer corners, closed, and big
// enough to mean something. Points are [lat, lng]. Pure functions, so they are tested on their own.

export const MAX_CORNERS = 300; // the server refuses a shape with more corners than this
const MIN_SPAN_DEG = 0.0005; // about 55 m: smaller than this is a slip of the hand, not an area

function span(points) {
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  return Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Douglas-Peucker: drop every point that sits within `tol` of the straight line between its neighbours.
function reduce(points, tol) {
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let far = -1;
    let farDist = tol;
    for (let i = lo + 1; i < hi; i += 1) {
      const d = distToSegment(points[i], points[lo], points[hi]);
      if (d > farDist) { far = i; farDist = d; }
    }
    if (far >= 0) {
      keep[far] = true;
      stack.push([lo, far], [far, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// The drawn line as a closed area with at most `max` corners, or null when it is too small or too short.
export function shapeFromPath(path, max = MAX_CORNERS) {
  const pts = path.filter((p, i) => i === 0 || p[0] !== path[i - 1][0] || p[1] !== path[i - 1][1]);
  if (pts.length < 3 || span(pts) < MIN_SPAN_DEG) return null;
  // The end of the line joins back to its start, so drop a last point that sits on the first one.
  const open = pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < span(pts) / 200 ? pts.slice(0, -1) : pts;
  let tol = span(open) / 600;
  let out = reduce(open, tol);
  while (out.length > max) {
    tol *= 1.4;
    out = reduce(open, tol);
  }
  if (out.length < 3) out = open.slice(0, 3);
  return out.map((p) => [Number(p[0].toFixed(5)), Number(p[1].toFixed(5))]);
}

// How many companies to offer the user to see, given how many an area could hold.
export function amountChoices(candidates) {
  const steps = [100, 500, 1000].filter((n) => n < candidates);
  return [...steps.map((n) => ({ value: n, label: n.toLocaleString() })), { value: Infinity, label: candidates ? `All ${candidates.toLocaleString()}` : "All" }];
}
