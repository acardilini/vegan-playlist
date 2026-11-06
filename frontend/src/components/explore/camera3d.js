// Pure 3D camera maths for the Explore map: orbit rotation, perspective projection onto the
// plot, camera presets and interpolation, depth cues, the axis gizmo, and depth-aware picking.
// No React, no canvas - the draw loop, the orbit hook and `node --test` share these functions.
//
// Conventions: Y is up. Angles are DEGREES. `yaw` spins the world about Y; `pitch` raises the
// camera above the horizon (90 = looking straight down). Pan is in plot pixels.

export const DEFAULT_CAMERA = { yaw: 35, pitch: 20, zoom: 1, panX: 0, panY: 0 };

// Top = the X-Z plane, Front = X-Y, Side = Z-Y.
export const PRESETS = {
  iso: { yaw: 35, pitch: 20 },
  top: { yaw: 0, pitch: 90 },
  front: { yaw: 0, pitch: 0 },
  side: { yaw: 90, pitch: 0 },
};

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 8;

// The camera sits CAM_DIST in front of the origin. Zoom scales the focal length, NOT the
// distance: dividing the distance by zoom would carry dots behind the camera at high zoom.
// FOCAL is tuned so the server-normalised cloud (|v| <= 1/1.15 on its longest axis) clears a 5%
// margin in every preset on a landscape plot, while still filling most of it.
const CAM_DIST = 4.2;
const FOCAL = 1.2;

const RAD = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Wraps an angle to [-180, 180).
function wrapDeg(d) {
  if (d >= -180 && d < 180) return d;   // already in range: do not perturb it with float error
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

// Largest pan (px) a URL may carry. Any real plot is far smaller; beyond this a link is junk.
export const MAX_PAN = 5000;

// With the plot size the pan is also limited so the cloud's centre stays on the plot (a hand-
// edited link or a wild drag cannot leave an empty plot); without it, only yaw/pitch/zoom.
export function clampCamera(cam, size) {
  const out = {
    ...cam,
    yaw: wrapDeg(cam.yaw),
    pitch: clamp(cam.pitch, -90, 90),
    zoom: clamp(cam.zoom, MIN_ZOOM, MAX_ZOOM),
  };
  if (size) {
    out.panX = clamp(cam.panX, -size.w / 2, size.w / 2);
    out.panY = clamp(cam.panY, -size.h / 2, size.h / 2);
  }
  return out;
}

// Camera-space coordinates [right, up, away]: yaw about Y, then the pitch tilt. `away` grows
// with distance from the camera.
export function rotate(p, yaw, pitch) {
  const Y = yaw * RAD;
  const P = pitch * RAD;
  const x1 = p[0] * Math.cos(Y) + p[2] * Math.sin(Y);
  const z1 = -p[0] * Math.sin(Y) + p[2] * Math.cos(Y);
  return [
    x1,
    p[1] * Math.cos(P) + z1 * Math.sin(P),
    -p[1] * Math.sin(P) + z1 * Math.cos(P),
  ];
}

export function activePreset(cam) {
  if (cam.zoom !== 1 || cam.panX !== 0 || cam.panY !== 0) return null;
  for (const [name, p] of Object.entries(PRESETS)) {
    if (Math.abs(wrapDeg(cam.yaw - p.yaw)) <= 0.5 && Math.abs(cam.pitch - p.pitch) <= 0.5) {
      return name;
    }
  }
  return null;
}

// `k` is the depth factor (CAM_DIST / depth): above 1 near the camera, below 1 far away. It
// drives dot size and opacity.
export function projectCloud(coords3, cam, size) {
  const f = FOCAL * Math.min(size.w, size.h) * cam.zoom;
  return coords3.map(p => {
    if (!p) return null;
    const r = rotate(p, cam.yaw, cam.pitch);
    const depth = r[2] + CAM_DIST;
    return {
      x: size.w / 2 + (r[0] * f) / depth + cam.panX,
      y: size.h / 2 - (r[1] * f) / depth + cam.panY,
      depth,
      k: CAM_DIST / depth,
    };
  });
}

export function interpolateCamera(a, b, t) {
  const lerp = (u, v) => u + (v - u) * t;
  return {
    yaw: wrapDeg(a.yaw + wrapDeg(b.yaw - a.yaw) * t),
    pitch: lerp(a.pitch, b.pitch),
    zoom: lerp(a.zoom, b.zoom),
    panX: lerp(a.panX, b.panX),
    panY: lerp(a.panY, b.panY),
  };
}

// Painter's algorithm: the farthest dot is drawn first so nearer ones overlap it.
export function sortBackToFront(points) {
  return points.filter(Boolean).sort((a, b) => b.depth - a.depth);
}

export function dotRadius(base, k) {
  return base * clamp(k, 0.55, 1.6);
}

export function dotAlpha(k) {
  return 0.35 + 0.6 * clamp((k - 0.75) / 0.5, 0, 1);
}

// Unit axes in screen space for the orientation gizmo (y already flipped: screen y grows down).
export function gizmoAxes(cam) {
  return [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]].map(([axis, v]) => {
    const r = rotate(v, cam.yaw, cam.pitch);
    return { axis, x: r[0], y: -r[1], depth: r[2] };
  });
}

// A dot "covers" the pointer when it is within its drawn radius `r` plus this much slack.
const PICK_SLACK = 3;

// The point under the pointer. Dots that actually cover it win first: among those a lit dot
// beats a dimmed one (so picking matches what is painted on top), then the dot nearest the
// camera (smallest depth), then the nearest on screen. Only when no dot covers the pointer does
// it fall back to the nearest dot within grabPx, so a near-miss still selects something. Points
// without `r`/`lit`/`depth` (the 2D view) behave as plain nearest-on-screen.
export function pickPoint(points, mx, my, grabPx) {
  const rank = (p, d) => [p.lit === false ? 1 : 0, p.depth ?? 0, d];
  const better = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };
  let under = null;
  let underRank = null;
  let near = null;
  let nearDist = Infinity;
  for (const p of points) {
    const d = Math.hypot(p.x - mx, p.y - my);
    if (d <= (p.r ?? 0) + PICK_SLACK) {
      const r = rank(p, d);
      if (!under || better(r, underRank)) { under = p; underRank = r; }
    }
    if (d <= grabPx && d < nearDist) { near = p; nearDist = d; }
  }
  return under || near;
}
