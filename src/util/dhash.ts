// dHash + friends. Pure functions on grayscale arrays so they can be unit tested without a browser.

export type Gray = ArrayLike<number>;

/** RGBA (ImageData.data) -> luminance 0..255 */
export function rgbaToGray(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * (rgba[p] as number) + 0.587 * (rgba[p + 1] as number) + 0.114 * (rgba[p + 2] as number);
  }
  return out;
}

/** Area-average (box) resample of a grayscale image. */
export function boxResize(src: Gray, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh);
  for (let dy = 0; dy < dh; dy++) {
    const y0 = (dy * sh) / dh;
    const y1 = ((dy + 1) * sh) / dh;
    for (let dx = 0; dx < dw; dx++) {
      const x0 = (dx * sw) / dw;
      const x1 = ((dx + 1) * sw) / dw;
      let sum = 0;
      let wsum = 0;
      for (let y = Math.floor(y0); y < Math.min(sh, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.min(sw, Math.ceil(x1)); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          const wgt = wx * wy;
          sum += (src[y * sw + x] as number) * wgt;
          wsum += wgt;
        }
      }
      out[dy * dw + dx] = wsum > 0 ? sum / wsum : 0;
    }
  }
  return out;
}

/** 64-bit difference hash: 9x8 grayscale, bit = left pixel brighter than right neighbour. Returns 16 hex chars. */
export function dhash(gray: Gray, w: number, h: number): string {
  const s = boxResize(gray, w, h, 9, 8);
  let hi = 0;
  let lo = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const bit = (s[y * 9 + x] as number) > (s[y * 9 + x + 1] as number) ? 1 : 0;
      const idx = y * 8 + x;
      if (idx < 32) hi = (hi * 2 + bit) >>> 0;
      else lo = (lo * 2 + bit) >>> 0;
    }
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function hamming(a: string, b: string): number {
  const ah = parseInt(a.slice(0, 8), 16);
  const al = parseInt(a.slice(8), 16);
  const bh = parseInt(b.slice(0, 8), 16);
  const bl = parseInt(b.slice(8), 16);
  return popcount32((ah ^ bh) >>> 0) + popcount32((al ^ bl) >>> 0);
}

export const GRID_W = 32;
export const GRID_H = 18;

/** Coarse luminance grid used to notice small localised changes (typing, a new toast) that dHash can miss. */
export function gridSignature(gray: Gray, w: number, h: number): Float32Array {
  return boxResize(gray, w, h, GRID_W, GRID_H);
}

/** Fraction of grid cells whose mean luminance moved by more than `tol`. */
export function gridChange(a: Float32Array, b: Float32Array, tol = 10): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs((a[i] as number) - (b[i] as number)) > tol) changed++;
  return changed / a.length;
}

/** True for blank / nearly black frames (screen off, DRM black-out). */
export function isBlackFrame(gray: Gray): boolean {
  let sum = 0;
  let max = 0;
  const n = gray.length;
  for (let i = 0; i < n; i++) {
    const v = gray[i] as number;
    sum += v;
    if (v > max) max = v;
  }
  return n > 0 && sum / n < 4 && max < 16;
}

/** Cheap text-likelihood: share of pixels on strong horizontal/vertical gradients (glyph edges). */
export function textLikelihood(gray: Gray, w: number, h: number): number {
  let edges = 0;
  let total = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const v = gray[y * w + x] as number;
      const dx = Math.abs(v - (gray[y * w + x + 1] as number));
      const dy = Math.abs(v - (gray[(y + 1) * w + x] as number));
      if (dx > 48 || dy > 48) edges++;
      total++;
    }
  }
  return total ? edges / total : 0;
}
