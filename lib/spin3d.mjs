// The spinning logo: the SLOP wordmark as solid 3D letters inside the red pen ring from the app's
// logo, lit by a moving light and drawn with a brightness ramp of characters. Plain math, no
// dependencies: surface points are sampled once, then each frame rotates, projects and z-buffers them.

// SLOP in a chunky rounded face: strokes two cells wide and one cell (two units) tall, so every
// stroke has the same weight. One cell is 1 unit wide and 2 tall, like a terminal cell.
const WORD = [
  " █████    ██          █████    ██████  ",
  "██   ██   ██         ██   ██   ██   ██ ",
  "██        ██         ██   ██   ██   ██ ",
  " █████    ██         ██   ██   ██████  ",
  "     ██   ██         ██   ██   ██      ",
  "██   ██   ██         ██   ██   ██      ",
  " █████    ███████     █████    ██      ",
];
const CELL_H = 2;
const DEPTH = 3;
const STEP = 0.34; // sampling distance on every surface: small enough that no cell is skipped

const RAMP = ".-:*+=#%@";

/** Surface points with normals and a material: "w" for the letters, "r" for the ring. */
function buildPoints() {
  const pts = [];
  const rows = WORD.length;
  const cols = WORD[0].length;
  const on = (x, y) => y >= 0 && y < rows && x >= 0 && x < cols && WORD[y][x] === "█";
  const ox = cols / 2;
  const oy = (rows * CELL_H) / 2;
  const add = (x, y, z, nx, ny, nz, m) => pts.push([x - ox, y - oy, z, nx, ny, nz, m, (x / cols)]);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (!on(gx, gy)) continue;
      const x0 = gx;
      const y0 = gy * CELL_H;
      for (let u = 0; u <= 1.0001; u += STEP) {
        for (let v = 0; v <= CELL_H + 0.0001; v += STEP) {
          add(x0 + u, y0 + v, -DEPTH / 2, 0, 0, -1, "w"); // front
          add(x0 + u, y0 + v, DEPTH / 2, 0, 0, 1, "w"); // back
        }
      }
      // Side walls only where the neighbouring cell is empty.
      // Between the faces only: at the very edge a wall point would tie with the face and
      // sometimes win the depth test, leaving dark specks in the letters.
      for (let d = -DEPTH / 2 + STEP / 2; d < DEPTH / 2; d += STEP) {
        for (let v = 0; v <= CELL_H + 0.0001; v += STEP) {
          if (!on(gx - 1, gy)) add(x0, y0 + v, d, -1, 0, 0, "w");
          if (!on(gx + 1, gy)) add(x0 + 1, y0 + v, d, 1, 0, 0, "w");
        }
        for (let u = 0; u <= 1.0001; u += STEP) {
          if (!on(gx, gy - 1)) add(x0 + u, y0, d, 0, -1, 0, "w");
          if (!on(gx, gy + 1)) add(x0 + u, y0 + CELL_H, d, 0, 1, 0, "w");
        }
      }
    }
  }
  // The pen ring: an elliptical tube around the word, tilted back a little.
  const RX = cols / 2 + 5;
  const RY = oy + 4.5;
  const R = 0.95;
  const tilt = 0.32;
  const [ct, st] = [Math.cos(tilt), Math.sin(tilt)];
  for (let a = 0; a < Math.PI * 2; a += STEP / Math.max(RX, RY)) {
    const [ca, sa] = [Math.cos(a), Math.sin(a)];
    // The tube's frame: outward normal in the ring's plane, and the plane's normal.
    const len = Math.hypot(ca / RX, sa / RY) || 1;
    const [ex, ey] = [ca / RX / len, sa / RY / len];
    for (let b = 0; b < Math.PI * 2; b += STEP / R) {
      const [cb, sb] = [Math.cos(b), Math.sin(b)];
      const nx = ex * cb;
      const ny = ey * cb;
      const nz = sb;
      const x = RX * ca + R * nx;
      const y = RY * sa + R * ny;
      const z = R * nz;
      // Tilt about the x axis.
      pts.push([x, y * ct - z * st, y * st + z * ct, nx, ny * ct - nz * st, ny * st + nz * ct, "r", (x + RX) / (2 * RX)]);
    }
  }
  return { pts, halfW: RX + R + 1, halfH: RY + R + 1 };
}

// Colour ramps from shadow to highlight. Every step stays saturated, so turned-away faces read
// as deep amber or deep red rather than muddy brown, and highlights go nearly white.
const LETTERS_A = [[150, 70, 10], [235, 140, 20], [255, 205, 60], [255, 240, 170], [255, 252, 238]];
const LETTERS_B = [[140, 55, 8], [230, 120, 18], [255, 185, 40], [255, 228, 140], [255, 248, 228]];
const RING = [[120, 14, 10], [205, 32, 24], [255, 66, 42], [255, 128, 96], [255, 210, 196]];

function shade(ramp, lum, k) {
  const x = Math.max(0, Math.min(0.9999, lum)) * (ramp.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  // Across the word the letters warm slightly from left to right.
  const mix = (a, b) => a + (b - a) * f;
  const c = ramp[i].map((v, j) => mix(v, ramp[i + 1][j]));
  return c.map((v, j) => Math.round(Math.min(255, j === 1 ? v - 18 * k : v)));
}

let model;

/**
 * One frame at time t (seconds), cols x rows cells. Returns rows of cells, each [char, [r, g, b]]
 * or null for empty.
 */
export function frame(t, cols, rows) {
  model ??= buildPoints();
  const { pts, halfW, halfH } = model;
  // A slow turn one way and back, with a little nod, so the letters show their depth.
  const yaw = Math.sin(t * 0.85) * 0.75;
  const pitch = Math.sin(t * 0.55) * 0.18 - 0.08;
  const [cy, sy] = [Math.cos(yaw), Math.sin(yaw)];
  const [cp, sp] = [Math.cos(pitch), Math.sin(pitch)];
  // The light drifts across, so highlights travel over the letters.
  let [lx, ly, lz] = [Math.sin(t * 0.6) * 0.55 - 0.15, -0.45, -1];
  const ll = Math.hypot(lx, ly, lz);
  [lx, ly, lz] = [lx / ll, ly / ll, lz / ll];

  const D = 90; // camera distance
  const scale = Math.min((cols - 2) / (2 * halfW), ((rows - 0.5) * 2) / (2 * halfH));
  const K = scale * D;
  const zbuf = new Float32Array(cols * rows).fill(Infinity);
  const out = new Array(cols * rows).fill(null);
  for (const [x, y, z, nx, ny, nz, m, k] of pts) {
    // yaw (around y), then pitch (around x)
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const nx1 = nx * cy + nz * sy;
    const nz1 = -nx * sy + nz * cy;
    const ny2 = ny * cp - nz1 * sp;
    const nz2 = ny * sp + nz1 * cp;
    const zc = z2 + D;
    const sx = Math.round(cols / 2 + (K * x1) / zc);
    const syc = Math.round(rows / 2 + (K * y2) / zc / 2);
    if (sx < 0 || sx >= cols || syc < 0 || syc >= rows) continue;
    const i = syc * cols + sx;
    if (zc >= zbuf[i]) continue;
    zbuf[i] = zc;
    const lum = 0.18 + 0.82 * Math.max(0, nx1 * lx + ny2 * ly + nz2 * lz);
    const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length))];
    out[i] = [ch, shade(m === "w" ? (k < 0.5 ? LETTERS_A : LETTERS_B) : RING, lum, k)];
  }
  const lines = [];
  for (let r = 0; r < rows; r++) lines.push(out.slice(r * cols, r * cols + cols));
  return lines;
}

/** How big the logo wants to be: a width that fits, and the rows that go with it. */
export function size(maxCols) {
  model ??= buildPoints();
  const cols = Math.min(maxCols, 84);
  const rows = Math.round((cols / (2 * model.halfW)) * model.halfH * 2 / 2) + 1;
  return { cols, rows };
}

/** The largest logo that fits in maxCols x maxRows. */
export function fit(maxCols, maxRows) {
  let { cols, rows } = size(maxCols);
  while (rows > maxRows && cols > 30) ({ cols, rows } = size(cols - 2));
  return { cols, rows };
}
