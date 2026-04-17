// color-extractor.js
// Given an <img> (or a URL), return the dominant color as {r,g,b,hex}.
// Tiny k-means-ish bucketing — no library. Runs in ~2ms for 640x640.

(function () {
  const BUCKET_STEP = 24;          // quantize each channel to 24-unit buckets
  const MIN_SATURATION = 0.12;     // drop near-grey pixels
  const MIN_LIGHTNESS = 0.15;      // drop near-black pixels
  const MAX_LIGHTNESS = 0.92;      // drop near-white pixels
  const DOWNSCALE = 64;            // shrink image to this wide before sampling

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    return { h: h / 6, s, l };
  }

  function toHex(r, g, b) {
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function extractFromImage(img) {
    const scale = DOWNSCALE / Math.max(img.naturalWidth, 1);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    let data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      // Cross-origin taint — fall back to null so caller uses default accent.
      return null;
    }

    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue;
      const hsl = rgbToHsl(r, g, b);
      if (hsl.s < MIN_SATURATION) continue;
      if (hsl.l < MIN_LIGHTNESS || hsl.l > MAX_LIGHTNESS) continue;
      const key = (Math.round(r / BUCKET_STEP) << 16) |
                  (Math.round(g / BUCKET_STEP) << 8) |
                  Math.round(b / BUCKET_STEP);
      const prev = buckets.get(key);
      if (prev) { prev.n++; prev.r += r; prev.g += g; prev.b += b; }
      else buckets.set(key, { n: 1, r, g, b });
    }

    if (buckets.size === 0) return null;

    let best = null;
    for (const v of buckets.values()) {
      if (!best || v.n > best.n) best = v;
    }
    const r = Math.round(best.r / best.n);
    const g = Math.round(best.g / best.n);
    const b = Math.round(best.b / best.n);
    return { r, g, b, hex: toHex(r, g, b) };
  }

  async function extract(imgOrUrl) {
    const img = (imgOrUrl instanceof HTMLImageElement)
      ? (imgOrUrl.complete ? imgOrUrl : await loadImage(imgOrUrl.src))
      : await loadImage(imgOrUrl);
    return extractFromImage(img);
  }

  window.ColorExtractor = { extract };
})();
