/* ============================================================================
 * Lumen — Global Presets
 * Each preset layers a creative grade on top of the image's own corrective
 * needs (auto base), then scales by an intensity (0..1). B&W stays monochrome
 * at any intensity; only its tonal grade scales.
 * ==========================================================================*/
(function (global) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const LIST = [
    { id: 'natural',  name: 'Natural Travel',     desc: 'Balanced, realistic color — true to the scene.',
      swatch: ['#7c9bb0', '#b8c4cc', '#e8e2d6'], creative: {} },
    { id: 'vibrant',  name: 'Vibrant Travel',     desc: 'Punchy color, clarity and impact for the feed.',
      swatch: ['#1f8fbf', '#2bb673', '#f4c020'], creative: { vibrance: 26, clarity: 14, contrast: 10, saturation: 8, sharpness: 12, whites: 6 } },
    { id: 'golden',   name: 'Golden Hour',        desc: 'Warm, cinematic glow with soft highlights.',
      swatch: ['#e9a23b', '#d97a3c', '#7a4a2a'], creative: { temperature: 24, tint: 5, vibrance: 14, highlights: -12, shadows: 8, contrast: 6, vignette: -10, clarity: 6 } },
    { id: 'moody',    name: 'Moody Documentary',  desc: 'Muted color, deep shadows, editorial weight.',
      swatch: ['#4a5560', '#2c333b', '#8a7e70'], creative: { saturation: -32, contrast: 16, blacks: -20, shadows: -12, highlights: -6, clarity: 12, vignette: -14, temperature: -4 } },
    { id: 'bw',       name: 'Black & White Classic', desc: 'Monochrome with optimized contrast and grain detail.',
      swatch: ['#1a1a1a', '#7d7d7d', '#e6e6e6'], mono: true, creative: { bw: 100, contrast: 18, clarity: 14, blacks: -12, whites: 8, sharpness: 12 } }
  ];

  function byId(id) { return LIST.find(p => p.id === id); }

  /* build final params for a preset given image stats + intensity (0..1) */
  function build(presetId, stats, intensity) {
    const preset = byId(presetId);
    if (!preset) return Object.assign({}, Imaging.DEFAULTS);
    const corr = Analysis.autoParams(stats, 'natural');   // image-specific corrections
    const merged = Object.assign({}, Imaging.DEFAULTS);
    [corr, preset.creative].forEach(src => {
      for (const k in src) merged[k] = clamp((merged[k] || 0) + src[k], k === 'bw' ? 0 : -100, 100);
    });
    const k = clamp(intensity, 0, 1);
    const out = {};
    for (const key in merged) {
      out[key] = key === 'bw'
        ? (preset.mono ? merged.bw : Math.round(merged.bw * k))   // keep mono full-strength
        : Math.round(clamp(merged[key] * k, -100, 100));
    }
    return out;
  }

  global.Presets = { LIST, byId, build };
})(window);
