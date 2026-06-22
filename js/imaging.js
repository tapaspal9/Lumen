/* ============================================================================
 * Lumen — Imaging Engine
 * Framework-free pixel analysis + adjustment pipeline.
 * Operates on ImageData buffers (Uint8ClampedArray, 0..255 sRGB).
 * ==========================================================================*/
(function (global) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smoothstep(e0, e1, x) {
    if (x <= e0) return 0;
    if (x >= e1) return 1;
    const t = (x - e0) / (e1 - e0);
    return t * t * (3 - 2 * t);
  }

  /* ---- Analysis -----------------------------------------------------------*/
  function analyze(imageData) {
    const d = imageData.data;
    const w = imageData.width, h = imageData.height;
    const n = d.length / 4;
    const histR = new Float32Array(256);
    const histG = new Float32Array(256);
    const histB = new Float32Array(256);
    const histL = new Float32Array(256);
    let sumR = 0, sumG = 0, sumB = 0, sumL = 0, sumSat = 0;
    let shadowClip = 0, highClip = 0;
    const buckets = new Float32Array(4096); // 16×16×16 color cube — 16-value bins per channel
    const luma = new Float32Array(n);
    // region brightness accumulators (composition signals)
    let tSum = 0, tC = 0, bSum = 0, bC = 0, lSum = 0, lC = 0, rSum = 0, rC = 0, cSum = 0, cC = 0;
    const x0 = w / 3, x1 = 2 * w / 3, y0 = h / 3, y1 = 2 * h / 3, hw = w / 2, hh = h / 2;
    // vertical / horizontal profiles (luma + edge) for crop/composition analysis
    const PB = 48;
    const rowL = new Float32Array(PB), rowN = new Float32Array(PB);
    const colL = new Float32Array(PB), colN = new Float32Array(PB);
    const rowE = new Float32Array(PB), colE = new Float32Array(PB);

    let p = 0;
    for (let i = 0; i < d.length; i += 4, p++) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      histR[r]++; histG[g]++; histB[b]++;
      const L = 0.299 * r + 0.587 * g + 0.114 * b;
      const Li = L | 0;
      histL[Li]++; luma[p] = L;
      sumR += r; sumG += g; sumB += b; sumL += L;
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      sumSat += mx === 0 ? 0 : (mx - mn) / mx;
      if (Li < 6) shadowClip++;
      if (Li > 249) highClip++;
      const bi = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4);
      buckets[bi] += (mx - mn > 16 ? 1.6 : 1);
      const x = p % w, y = (p / w) | 0;
      if (y < hh) { tSum += L; tC++; } else { bSum += L; bC++; }
      if (x < hw) { lSum += L; lC++; } else { rSum += L; rC++; }
      if (x >= x0 && x < x1 && y >= y0 && y < y1) { cSum += L; cC++; }
      const ry = (y * PB / h) | 0, rx = (x * PB / w) | 0;
      rowL[ry] += L; rowN[ry]++; colL[rx] += L; colN[rx]++;
    }

    // edge energy (sampled gradient magnitude) → texture / detail signal
    let edge = 0, ec = 0;
    const step = Math.max(1, Math.round(Math.min(w, h) / 300));
    for (let y = step; y < h - step; y += step) {
      for (let x = step; x < w - step; x += step) {
        const o = y * w + x;
        const gx = luma[o + step] - luma[o - step];
        const gy = luma[o + step * w] - luma[o - step * w];
        const mag = Math.sqrt(gx * gx + gy * gy);
        edge += mag; ec++;
        rowE[(y * PB / h) | 0] += mag; colE[(x * PB / w) | 0] += mag;
      }
    }
    for (let i = 0; i < PB; i++) { rowL[i] = rowN[i] ? rowL[i] / rowN[i] : 0; colL[i] = colN[i] ? colL[i] / colN[i] : 0; }

    const meanR = sumR / n, meanG = sumG / n, meanB = sumB / n, meanL = sumL / n;
    let varL = 0;
    for (let l = 0; l < 256; l++) varL += histL[l] * (l - meanL) * (l - meanL);
    const stdL = Math.sqrt(varL / n);

    return {
      n, w, h, histR, histG, histB, histL,
      meanR, meanG, meanB, meanL, stdL,
      sat: sumSat / n,
      shadowClip: shadowClip / n,
      highClip: highClip / n,
      blackPoint: percentile(histL, n, 0.004),
      whitePoint: percentile(histL, n, 0.996),
      dominant: dominant(buckets, n),
      edgeEnergy: ec ? edge / ec : 0,
      regions: {
        top: tC ? tSum / tC : 0, bottom: bC ? bSum / bC : 0,
        left: lC ? lSum / lC : 0, right: rC ? rSum / rC : 0,
        center: cC ? cSum / cC : 0
      },
      profiles: { rowLuma: rowL, colLuma: colL, rowEdge: rowE, colEdge: colE }
    };
  }

  function percentile(hist, n, p) {
    let acc = 0; const target = n * p;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
    return 255;
  }

  function dominant(buckets, n) {
    // 16×16×16 cube: 16-value bins — 64× finer than original 4×4×4.
    // Threshold halved again vs 8×8×8 because pixels spread across 4× more buckets.
    const idx = Array.from(buckets.keys()).sort((a, b) => buckets[b] - buckets[a]).slice(0, 20);
    return idx.filter(i => buckets[i] > n * 0.003).map(i => ({
      r: Math.floor(i / 256) * 16 + 8,
      g: Math.floor((i % 256) / 16) * 16 + 8,
      b: (i % 16) * 16 + 8,
      weight: buckets[i] / n
    })).slice(0, 7);
  }

  /* Lightweight histogram only (for live updates) */
  function quickHist(imageData) {
    const d = imageData.data;
    const histR = new Float32Array(256), histG = new Float32Array(256),
      histB = new Float32Array(256), histL = new Float32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      histR[r]++; histG[g]++; histB[b]++;
      histL[(0.299 * r + 0.587 * g + 0.114 * b) | 0]++;
    }
    return { histR, histG, histB, histL };
  }

  /* ---- Tone helper --------------------------------------------------------*/
  function tone(v, blacks, whites, shadows, highlights) {
    const ws = 1 - smoothstep(0.0, 0.55, v);   // broad shadow region
    const wh = smoothstep(0.45, 1.0, v);        // broad highlight region
    const wbl = 1 - smoothstep(0.0, 0.28, v);   // deep blacks
    const wwh = smoothstep(0.72, 1.0, v);       // bright whites
    v += shadows * 0.5 * ws;
    v += highlights * 0.5 * wh;
    v += blacks * 0.42 * wbl;
    v += whites * 0.42 * wwh;
    return v;
  }

  /* ---- Separable box blur (3-iter approximates gaussian via single pass) --*/
  function blur(src, w, h, rad) {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    const win = rad * 2 + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let k = -rad; k <= rad; k++) acc += src[row + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / win;
        acc += src[row + clamp(x + rad + 1, 0, w - 1)] - src[row + clamp(x - rad, 0, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -rad; k <= rad; k++) acc += tmp[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / win;
        acc += tmp[clamp(y + rad + 1, 0, h - 1) * w + x] - tmp[clamp(y - rad, 0, h - 1) * w + x];
      }
    }
    return out;
  }

  /* ---- Main adjustment pipeline ------------------------------------------*/
  const DEFAULTS = {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temperature: 0, tint: 0, saturation: 0, vibrance: 0,
    sharpness: 0, clarity: 0, noise: 0, vignette: 0, bw: 0,
    // Split toning: +100 = warm orange/amber, −100 = cool teal/blue
    hlTint: 0, shTint: 0,
    // Radial local adjustment mask (maskR / maskFeather are 0–100 scale)
    maskCx: 0.5, maskCy: 0.5, maskR: 45, maskFeather: 25, maskInvert: 0,
    localExp: 0, localSat: 0,
    // HSL Color Mixer: per-hue saturation boost/cut (−100 to +100)
    redSat: 0, orangeSat: 0, yellowSat: 0, greenSat: 0, cyanSat: 0, blueSat: 0, purpleSat: 0
  };

  function process(src, params, out) {
    const w = src.width, h = src.height, d = src.data, o = out.data, N = w * h;
    const p = Object.assign({}, DEFAULTS, params);

    const temp = p.temperature / 100, tint = p.tint / 100;
    const expF = Math.pow(2, (p.exposure / 100) * 1.6);
    const contrastF = 1 + (p.contrast / 100);
    const blacks = p.blacks / 100, whites = p.whites / 100;
    const shadows = p.shadows / 100, highlights = p.highlights / 100;
    const rGain = 1 + 0.35 * temp, bGain = 1 - 0.35 * temp, gGain = 1 - 0.30 * tint;

    const br = new Float32Array(N), bg = new Float32Array(N), bb = new Float32Array(N);
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      let r = d[j] / 255, g = d[j + 1] / 255, b = d[j + 2] / 255;
      r *= rGain; g *= gGain; b *= bGain;          // white balance
      r *= expF; g *= expF; b *= expF;             // exposure
      r = tone(r, blacks, whites, shadows, highlights);
      g = tone(g, blacks, whites, shadows, highlights);
      b = tone(b, blacks, whites, shadows, highlights);
      r = (r - 0.5) * contrastF + 0.5;             // contrast
      g = (g - 0.5) * contrastF + 0.5;
      b = (b - 0.5) * contrastF + 0.5;
      br[i] = r; bg[i] = g; bb[i] = b;
    }

    const clarity = p.clarity / 100, sharp = p.sharpness / 100, noise = p.noise / 100;
    const needLarge = clarity !== 0;
    const needSmall = sharp !== 0 || noise !== 0;
    let lr, lg, lb, sr, sg, sb;
    if (needLarge) {
      const rad = Math.max(2, Math.round(Math.min(w, h) / 48));
      lr = blur(br, w, h, rad); lg = blur(bg, w, h, rad); lb = blur(bb, w, h, rad);
    }
    if (needSmall) {
      sr = blur(br, w, h, 1); sg = blur(bg, w, h, 1); sb = blur(bb, w, h, 1);
    }

    const satN = p.saturation / 100, vibN = p.vibrance / 100, vig = p.vignette / 100;
    const bwAmt = (p.bw || 0) / 100;
    const cx = w / 2, cy = h / 2;
    // HSL Color Mixer — precomputed per-hue gain values
    const hmR = (p.redSat    || 0) / 100, hmO = (p.orangeSat || 0) / 100;
    const hmY = (p.yellowSat || 0) / 100, hmG = (p.greenSat  || 0) / 100;
    const hmC = (p.cyanSat   || 0) / 100, hmB = (p.blueSat   || 0) / 100;
    const hmP = (p.purpleSat || 0) / 100;
    const hasHueMix = !!(hmR || hmO || hmY || hmG || hmC || hmB || hmP);
    // Split toning: positive = warm (orange/amber), negative = cool (teal/blue)
    const hlT = (p.hlTint || 0) / 100, shT = (p.shTint || 0) / 100;
    // Local radial mask
    const hasLocal = (p.localExp || 0) !== 0 || (p.localSat || 0) !== 0;
    const mCx = p.maskCx != null ? p.maskCx : 0.5;
    const mCy = p.maskCy != null ? p.maskCy : 0.5;
    const mR  = (p.maskR  != null ? p.maskR  : 45)  / 100;
    const mF  = (p.maskFeather != null ? p.maskFeather : 25) / 100;
    const mInv = !!(p.maskInvert);
    const lExp = (p.localExp || 0) / 100, lSat = (p.localSat || 0) / 100;

    for (let i = 0, j = 0; i < N; i++, j += 4) {
      let r = br[i], g = bg[i], b = bb[i];

      // — Edge-preserving noise reduction —
      // Smooth only uniform/flat areas; full sharpness preserved on edges.
      // Secondary chroma pass removes colour speckles even near edges.
      if (noise > 0) {
        const edgeMag = Math.abs(br[i]-sr[i]) + Math.abs(bg[i]-sg[i]) + Math.abs(bb[i]-sb[i]);
        const smoothW = clamp(1 - edgeMag / (0.055 + noise * 0.018), 0, 1) * noise * 0.85;
        r += (sr[i] - r) * smoothW; g += (sg[i] - g) * smoothW; b += (sb[i] - b) * smoothW;
        const lumN = 0.299 * r + 0.587 * g + 0.114 * b;
        const cStr = noise * 0.30;
        r -= (r - lumN) * cStr; g -= (g - lumN) * cStr; b -= (b - lumN) * cStr;
      }

      // — Midtone-only clarity —
      // Peaks at 0.5 luminance and fades to zero at extreme shadows + highlights
      // so blown whites and crushed blacks are completely unaffected.
      if (clarity !== 0) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const midW = smoothstep(0.08, 0.35, lum) * (1 - smoothstep(0.65, 0.92, lum));
        const cAmt = clarity * 0.9 * midW;
        r += (r - lr[i]) * cAmt; g += (g - lg[i]) * cAmt; b += (b - lb[i]) * cAmt;
      }

      // — Sharpness (high-frequency unsharp mask) —
      if (sharp > 0) {
        r += (r - sr[i]) * sharp * 1.2; g += (g - sg[i]) * sharp * 1.2; b += (b - sb[i]) * sharp * 1.2;
      }

      // — Saturation + Vibrance —
      if (satN !== 0 || vibN !== 0) {
        const L = 0.299 * r + 0.587 * g + 0.114 * b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const cs = mx <= 0 ? 0 : (mx - mn) / mx;
        const f = 1 + satN + vibN * (1 - clamp(cs, 0, 1));
        r = L + (r - L) * f; g = L + (g - L) * f; b = L + (b - L) * f;
      }

      // — HSL Color Mixer: per-hue saturation —
      // Derives the pixel's hue, blends weighted per-band boosts, applies saturation.
      // Skips achromatic pixels (delta < 0.025). Only runs when a hue param is non-zero.
      if (hasHueMix) {
        const mxH = Math.max(r,g,b), mnH = Math.min(r,g,b), dH = mxH - mnH;
        if (dH > 0.025) {
          let hue;
          if (mxH === r)      hue = ((g - b) / dH * 60 + 360) % 360;
          else if (mxH === g) hue = (b - r) / dH * 60 + 120;
          else                hue = (r - g) / dH * 60 + 240;
          // Circular distance from hue to a peak (0..180)
          const hd = (pk) => { const x = ((hue - pk + 540) % 360); return x > 180 ? 360 - x : x; };
          // Soft bell weight: 1 at peak, 0 at ±width degrees
          const hw = (pk, w2) => Math.max(0, 1 - hd(pk) / w2);
          const wR = hw(0, 28) + hw(360, 28); // red wraps around 0/360
          const wO = hw(30,  26), wY = hw(60,  28);
          const wG = hw(120, 38), wC = hw(180, 30);
          const wB = hw(240, 38), wP = hw(300, 30);
          const tot = wR + wO + wY + wG + wC + wB + wP;
          if (tot > 0.001) {
            const boost = (wR*hmR + wO*hmO + wY*hmY + wG*hmG + wC*hmC + wB*hmB + wP*hmP) / tot;
            if (Math.abs(boost) > 0.001) {
              const Lh = 0.299*r + 0.587*g + 0.114*b;
              r = Lh + (r - Lh) * (1 + boost);
              g = Lh + (g - Lh) * (1 + boost);
              b = Lh + (b - Lh) * (1 + boost);
            }
          }
        }
      }

      // — Split toning: per-zone hue bias —
      // Positive = warm (push red/amber), negative = cool (push teal/blue).
      if (hlT !== 0 || shT !== 0) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const hw  = smoothstep(0.42, 0.85, lum);        // highlights weight
        const sw2 = 1 - smoothstep(0.15, 0.58, lum);    // shadows weight
        if (hlT !== 0) {
          r += hlT > 0 ? hlT*hw*0.060 : hlT*hw*0.030;
          g += hlT > 0 ? hlT*hw*0.015 : hlT*hw*0.005;
          b -= hlT > 0 ? hlT*hw*0.050 : hlT*hw*0.080;
        }
        if (shT !== 0) {
          r += shT > 0 ? shT*sw2*0.060 : shT*sw2*0.030;
          g += shT > 0 ? shT*sw2*0.015 : shT*sw2*0.005;
          b -= shT > 0 ? shT*sw2*0.050 : shT*sw2*0.080;
        }
      }

      // — Black & white conversion —
      if (bwAmt > 0) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r += (gray - r) * bwAmt; g += (gray - g) * bwAmt; b += (gray - b) * bwAmt;
      }

      // — Local radial adjustment mask —
      // Soft-edged circle lets users selectively expose or saturate a zone.
      // maskCx/maskCy are 0–1 normalised; maskR/maskFeather are 0–100 scale.
      if (hasLocal) {
        const px = i % w, py = (i / w) | 0;
        const dx = px / w - mCx, dy = py / h - mCy;
        const d2 = Math.sqrt(dx * dx + dy * dy);
        const hw2 = mF * 0.5;
        let maskW = 1 - smoothstep(mR - hw2, mR + hw2, d2);
        if (mInv) maskW = 1 - maskW;
        if (maskW > 0.001) {
          if (lExp !== 0) {
            const ef = Math.pow(2, lExp * 1.6);
            r = clamp(r * (1 + (ef - 1) * maskW), 0, 1);
            g = clamp(g * (1 + (ef - 1) * maskW), 0, 1);
            b = clamp(b * (1 + (ef - 1) * maskW), 0, 1);
          }
          if (lSat !== 0) {
            const Ll = 0.299 * r + 0.587 * g + 0.114 * b;
            const sf = 1 + lSat * maskW;
            r = Ll + (r - Ll) * sf; g = Ll + (g - Ll) * sf; b = Ll + (b - Ll) * sf;
          }
        }
      }

      // — Elliptical luminance-space vignette —
      // Fixed sign: negative vig darkens edges (traditional vignette).
      // Elliptical distance is aspect-ratio-aware; smooth sigmoid falloff.
      // Multiplies all channels equally → no hue shift at large amounts.
      if (vig !== 0) {
        const px = i % w, py = (i / w) | 0;
        const dnx = (px - cx) / cx, dny = (py - cy) / cy;
        const distN = Math.sqrt(dnx * dnx + dny * dny);
        const falloff = smoothstep(0.40, 1.0, distN);
        const ratio = clamp(1 + vig * 0.85 * falloff, 0, 3);
        r = clamp(r * ratio, 0, 1); g = clamp(g * ratio, 0, 1); b = clamp(b * ratio, 0, 1);
      }

      o[j] = clamp(r * 255, 0, 255);
      o[j + 1] = clamp(g * 255, 0, 255);
      o[j + 2] = clamp(b * 255, 0, 255);
      o[j + 3] = d[j + 3];
    }
  }

  /* ---- Geometry: straighten + cover scale (non-destructive crop source) --*/
  function coverScale(w, h, rad) {
    const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
    return Math.max((w * c + h * s) / w, (w * s + h * c) / h);
  }
  // Draw the image into a BW×BH canvas (same aspect), rotated by angleDeg and
  // scaled to cover so corners never go empty (Lightroom-style straighten).
  function straightenedCanvas(img, angleDeg, BW, BH) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(BW));
    c.height = Math.max(1, Math.round(BH));
    const x = c.getContext('2d', { willReadFrequently: true });
    const rad = (angleDeg || 0) * Math.PI / 180;
    const s = coverScale(c.width, c.height, rad);
    x.save();
    x.translate(c.width / 2, c.height / 2);
    x.rotate(rad);
    x.scale(s, s);
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, -c.width / 2, -c.height / 2, c.width, c.height);
    x.restore();
    return c;
  }

  global.Imaging = { analyze, quickHist, process, DEFAULTS, clamp, smoothstep, coverScale, straightenedCanvas };
// Compatible with both browser main thread and Web Workers
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : self);
