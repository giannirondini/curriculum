// Photo -> ASCII portrait for the neofetch-style banner. Computed once in an
// offscreen canvas from assets/me.jpg (same origin, so no CORS taint), then
// re-mapped per theme: dense glyphs mean "bright" on dark backgrounds and
// "dark" on light ones, so the portrait never renders as a negative.
//
// Pipeline: crop to head & shoulders -> foreground mask (saturation, or
// distance from the wall colour, with per-row handling of horizontal wall
// bands such as shelves) -> unsharp-masked luminance -> per-cell average ->
// histogram equalisation -> glyph ramp.

const RAMP = ' .,:;-=+*#%@';

const OPTS = {
  zoom: 0.75, // fraction of the photo width kept (head & shoulders)
  top: 0.03, // vertical crop offset, as a fraction of the photo height
  sat: 45, // saturation above this = subject (skin, hair)
  dist: 60, // colour distance from the background above this = subject
  cover: 0.4, // share of a cell's samples that must be subject
  agree: 30, // left/right edge colours this close = a horizontal wall band
  bandMax: 0.65, // only look for wall bands above the shoulders
  sharpen: 1.5, // unsharp-mask strength
  blur: 3, // unsharp-mask radius (supersampled px)
};

export async function loadPortrait(src, { cols = 44, rows = 22 } = {}) {
  const img = new Image();
  img.src = src;
  await img.decode();

  const SS = 4; // supersampling per cell axis
  const W = cols * SS;
  const H = rows * SS;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Monospace cells are ~0.6em wide x 1.1em tall: crop to the aspect ratio
  // the character grid will have on screen.
  const aspect = (cols * 0.6) / (rows * 1.1);
  let sw = img.naturalWidth * OPTS.zoom;
  let sh = sw / aspect;
  if (sh > img.naturalHeight) {
    sh = img.naturalHeight;
    sw = sh * aspect;
  }
  const sx = (img.naturalWidth - sw) / 2;
  const sy = Math.max(0, Math.min(img.naturalHeight - sh, img.naturalHeight * OPTS.top));
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;

  const at = (x, y) => {
    const i = (y * W + x) * 4;
    return [px[i], px[i + 1], px[i + 2]];
  };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const median = (list) => [0, 1, 2].map((k) => list.map((v) => v[k]).sort((a, b) => a - b)[list.length >> 1]);

  // Wall colour from the top corners; per-row override where both edges agree
  // on something else (a shelf or panel line crossing behind the subject).
  const strip = Math.max(2, Math.round(W * 0.06));
  const corners = [];
  for (let y = 0; y < Math.round(H * 0.12); y++) {
    for (let x = 0; x < strip; x++) corners.push(at(x, y), at(W - 1 - x, y));
  }
  const wall = median(corners);
  const rowBg = [];
  for (let y = 0; y < H; y++) {
    const left = [];
    const right = [];
    for (let x = 0; x < strip; x++) {
      left.push(at(x, y));
      right.push(at(W - 1 - x, y));
    }
    const l = median(left);
    const r = median(right);
    const band = y < H * OPTS.bandMax && dist(l, r) < OPTS.agree && dist(l, wall) > 20;
    rowBg.push(band ? median(left.concat(right)) : wall);
  }

  // Unsharp-masked luminance: brings eyes / mouth out at this tiny size.
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = at(x, y);
      lum[y * W + x] = (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
    }
  }
  const sharp = new Float32Array(W * H);
  const R = OPTS.blur;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          sum += lum[yy * W + xx];
          n++;
        }
      }
      const v = lum[y * W + x];
      sharp[y * W + x] = v + OPTS.sharpen * (v - sum / n);
    }
  }

  const cells = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let fg = 0;
      let l = 0;
      for (let y = cy * SS; y < (cy + 1) * SS; y++) {
        for (let x = cx * SS; x < (cx + 1) * SS; x++) {
          const p = at(x, y);
          const sat = Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
          if (sat > OPTS.sat || dist(p, rowBg[y]) > OPTS.dist) {
            fg++;
            l += sharp[y * W + x];
          }
        }
      }
      cells.push(fg / (SS * SS) > OPTS.cover ? { l: l / fg } : null);
    }
  }

  // Histogram equalisation over the subject only.
  const sorted = cells.filter(Boolean).map((c) => c.l).sort((a, b) => a - b);
  cells.forEach((c) => {
    if (!c) return;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= c.l) lo = mid + 1;
      else hi = mid;
    }
    c.v = lo / sorted.length;
  });

  return { cols, rows, cells };
}

/** Plain-text art for a theme; glyph density follows perceived contrast. */
export function renderPortrait(p, theme) {
  const dark = theme === 'dark';
  let out = '';
  for (let y = 0; y < p.rows; y++) {
    for (let x = 0; x < p.cols; x++) {
      const c = p.cells[y * p.cols + x];
      if (!c) {
        out += ' ';
        continue;
      }
      const v = dark ? c.v : 1 - c.v;
      out += RAMP[Math.min(RAMP.length - 1, 1 + Math.round(v * (RAMP.length - 2)))];
    }
    if (y < p.rows - 1) out += '\n';
  }
  return out;
}
