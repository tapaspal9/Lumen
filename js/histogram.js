/* ============================================================================
 * Lumen — Histogram Renderer
 * Draws RGB (overlapping, screen-blended) and luminance histograms.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function smooth(hist) {
    const out = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let a = 0, c = 0;
      for (let k = -1; k <= 1; k++) { const j = i + k; if (j >= 0 && j < 256) { a += hist[j]; c++; } }
      out[i] = a / c;
    }
    return out;
  }

  function drawChannel(ctx, hist, max, w, h, color, fill) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * w;
      const y = h - Math.pow(hist[i] / max, 0.42) * h;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke();
  }

  /* mode: 'rgb' | 'luma' */
  function render(canvas, data, mode) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return; // not visible yet
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let g = 1; g < 4; g++) { const x = (g / 4) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }

    ctx.globalCompositeOperation = 'lighter';
    if (mode === 'luma') {
      const hL = smooth(data.histL);
      let max = 1; for (let i = 1; i < 255; i++) if (hL[i] > max) max = hL[i];
      ctx.globalCompositeOperation = 'source-over';
      drawChannel(ctx, hL, max, w, h, 'rgba(220,222,228,0.9)', 'rgba(200,205,215,0.22)');
    } else {
      const hR = smooth(data.histR), hG = smooth(data.histG), hB = smooth(data.histB);
      let max = 1;
      for (let i = 1; i < 255; i++) { if (hR[i] > max) max = hR[i]; if (hG[i] > max) max = hG[i]; if (hB[i] > max) max = hB[i]; }
      drawChannel(ctx, hR, max, w, h, 'rgba(255,86,86,0.85)', 'rgba(255,60,60,0.18)');
      drawChannel(ctx, hG, max, w, h, 'rgba(80,224,120,0.85)', 'rgba(60,220,100,0.18)');
      drawChannel(ctx, hB, max, w, h, 'rgba(90,150,255,0.9)', 'rgba(70,130,255,0.20)');
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  global.Histogram = { render };
})(window);
