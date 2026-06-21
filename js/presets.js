/* ============================================================================
 * Lumen — Preset Library  (js/presets.js)
 * 38 original presets across 6 categories. All parameter values are original
 * creative recipes — not derived from or copied from any commercial preset pack.
 *
 * API:
 *   Presets.LIST          — all presets
 *   Presets.CATEGORIES    — category definitions
 *   Presets.byId(id)      — find one preset
 *   Presets.byCategory(c) — all presets in a category
 *   Presets.recommendFor(sceneType) — ordered preset IDs for a scene
 *   Presets.build(id, stats, intensity, scene) — build final params
 * ============================================================================ */
(function (global) {
  'use strict';
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ---- Category definitions -------------------------------------------- */
  const CATEGORIES = [
    { id: 'landscape',    label: 'Landscape'          },
    { id: 'travel',       label: 'Travel'             },
    { id: 'portrait',     label: 'Portrait'           },
    { id: 'architecture', label: 'City & Architecture'},
    { id: 'food',         label: 'Food'               },
    { id: 'creative',     label: 'Creative'           },
  ];

  /* ---- Preset list ------------------------------------------------------- */
  /* creative: delta values mixed on top of the corrective auto-base.
     portraitSafe: true → always use portrait-safe base correction.
     mono: true         → B&W (bw channel handled specially in build).    */
  const LIST = [

    /* ── Landscape (8) ──────────────────────────────────────────────────── */
    { id: 'ls_natural', cat: 'landscape', name: 'Natural Landscape',
      desc: 'Balanced, true-to-life rendering with gentle clarity.',
      swatch: ['#5d8a6e', '#8fb8a2', '#c8dbd2'],
      creative: { vibrance:18, clarity:10, contrast:8, shadows:6, whites:4, sharpness:10 } },

    { id: 'ls_vibrant', cat: 'landscape', name: 'Vibrant Landscape',
      desc: 'Punchy color, crisp clarity — built for the feed.',
      swatch: ['#1a6faa', '#2da066', '#f5c520'],
      creative: { vibrance:35, clarity:18, contrast:14, saturation:10, whites:8, sharpness:14, vignette:-8 } },

    { id: 'ls_cinematic', cat: 'landscape', name: 'Cinematic Landscape',
      desc: 'Teal-orange grade with lifted shadows and deep vignette.',
      swatch: ['#1e5a6a', '#c97840', '#1a1a20'],
      creative: { temperature:-8, tint:-4, saturation:-12, vibrance:8, contrast:18, highlights:-14, shadows:12, blacks:8, clarity:10, vignette:-16 } },

    { id: 'ls_dramatic_sky', cat: 'landscape', name: 'Dramatic Sky',
      desc: 'Heavy sky recovery, deep blacks, maximum visual impact.',
      swatch: ['#0f2a4e', '#7090b8', '#e8eef6'],
      creative: { highlights:-35, shadows:-18, contrast:24, blacks:-20, clarity:20, vibrance:22, vignette:-20, sharpness:12 } },

    { id: 'ls_deep_greens', cat: 'landscape', name: 'Deep Greens',
      desc: 'Rich, saturated foliage — forests and jungles come alive.',
      swatch: ['#1a3d2b', '#3a7a52', '#8abf8a'],
      creative: { temperature:-6, tint:4, vibrance:28, saturation:12, clarity:14, shadows:10, blacks:-8, sharpness:10 } },

    { id: 'ls_mountain', cat: 'landscape', name: 'Mountain Light',
      desc: 'Cool, crisp, high altitude — pure whites and sharp rock.',
      swatch: ['#6a8fb0', '#b8ccd8', '#e8eef4'],
      creative: { temperature:-14, clarity:22, contrast:12, whites:14, highlights:-10, sharpness:16, vibrance:16, vignette:-8 } },

    { id: 'ls_forest', cat: 'landscape', name: 'Forest Mist',
      desc: 'Soft, moody, desaturated — damp light through canopy.',
      swatch: ['#2e4832', '#5a7a5c', '#9ab89e'],
      creative: { temperature:-4, saturation:-8, vibrance:14, shadows:16, highlights:-8, contrast:8, clarity:8, noise:6 } },

    { id: 'ls_ocean', cat: 'landscape', name: 'Ocean & Coast',
      desc: 'Cool aqua tones, clean highlights, infinite horizon.',
      swatch: ['#0a4a68', '#1a8aaa', '#80c8d8'],
      creative: { temperature:-18, tint:-4, vibrance:24, saturation:8, highlights:-8, whites:10, clarity:12, sharpness:10 } },

    /* ── Travel (6) ─────────────────────────────────────────────────────── */
    { id: 'tr_documentary', cat: 'travel', name: 'Travel Documentary',
      desc: 'Honest, muted, filmic — for stories, not postcards.',
      swatch: ['#7a6a54', '#a89878', '#d4c8b4'],
      creative: { saturation:-18, contrast:12, blacks:8, shadows:8, clarity:10, sharpness:8, temperature:2 } },

    { id: 'tr_warm_vacation', cat: 'travel', name: 'Warm Vacation',
      desc: 'Golden warmth, lifted shadows — holiday in a grade.',
      swatch: ['#e4a040', '#c87030', '#703820'],
      creative: { temperature:18, tint:3, vibrance:20, exposure:6, highlights:-8, shadows:12, clarity:6, vignette:-6 } },

    { id: 'tr_luxury', cat: 'travel', name: 'Luxury Travel',
      desc: 'Bright, airy, aspirational — resorts and fine dining.',
      swatch: ['#e8e0d0', '#c8bca8', '#a89880'],
      creative: { exposure:8, highlights:-12, whites:14, vibrance:12, saturation:4, clarity:8, shadows:10, noise:4 } },

    { id: 'tr_adventure', cat: 'travel', name: 'Adventure',
      desc: 'High-energy contrast and grit — built for action.',
      swatch: ['#2a2a1e', '#6a5a30', '#b89040'],
      creative: { contrast:22, clarity:18, saturation:-8, vibrance:14, sharpness:18, blacks:-16, vignette:-14 } },

    { id: 'tr_film', cat: 'travel', name: 'Film Travel',
      desc: 'Faded blacks, warm grain — like a forgotten roll of film.',
      swatch: ['#8a7060', '#b89a80', '#d8c4a8'],
      creative: { blacks:14, shadows:6, temperature:10, tint:-4, saturation:-20, vibrance:8, contrast:8, highlights:-10, noise:12 } },

    { id: 'tr_golden_road', cat: 'travel', name: 'Golden Road',
      desc: 'Long light, glowing horizon — last hour of the drive.',
      swatch: ['#e8a820', '#b07020', '#5a3010'],
      creative: { temperature:22, vibrance:18, shadows:14, highlights:-8, contrast:10, clarity:8, vignette:-10 } },

    /* ── Portrait (6) ───────────────────────────────────────────────────── */
    { id: 'po_natural', cat: 'portrait', portraitSafe: true, name: 'Natural Portrait',
      desc: 'Gentle, skin-safe — honest light, honest color.',
      swatch: ['#d4a888', '#e8c4a8', '#f4e0cc'],
      creative: { vibrance:10, clarity:2, contrast:4, shadows:8, highlights:-6, sharpness:6 } },

    { id: 'po_warm_skin', cat: 'portrait', portraitSafe: true, name: 'Warm Skin Tones',
      desc: 'Flattering golden warmth — outdoor and studio portraits.',
      swatch: ['#c88058', '#e0a878', '#f0c8a0'],
      creative: { temperature:10, tint:3, vibrance:8, exposure:4, shadows:10, highlights:-8, clarity:0, sharpness:4, noise:6 } },

    { id: 'po_editorial', cat: 'portrait', portraitSafe: true, name: 'Editorial Portrait',
      desc: 'Cool, high-contrast — magazine and fashion work.',
      swatch: ['#282830', '#5a5a6a', '#a8a8b8'],
      creative: { contrast:18, clarity:6, temperature:-6, saturation:-8, vibrance:6, blacks:-10, highlights:-10, sharpness:10, vignette:-10 } },

    { id: 'po_soft', cat: 'portrait', portraitSafe: true, name: 'Soft Portrait',
      desc: 'Dreamy, low clarity — perfect for gentle outdoor light.',
      swatch: ['#e8d0c0', '#d8b8a0', '#c8a088'],
      creative: { clarity:-8, shadows:16, highlights:-12, contrast:-4, vibrance:10, noise:8, sharpness:0 } },

    { id: 'po_golden_portrait', cat: 'portrait', portraitSafe: true, name: 'Golden Hour Portrait',
      desc: 'Warm sunset light — glowing skin and rich backgrounds.',
      swatch: ['#d89040', '#c07028', '#703818'],
      creative: { temperature:16, vibrance:12, highlights:-10, shadows:12, clarity:4, sharpness:6, vignette:-8 } },

    { id: 'po_bw_portrait', cat: 'portrait', portraitSafe: true, mono: true, name: 'B&W Portrait',
      desc: 'Classic monochrome — timeless strength and character.',
      swatch: ['#1a1a1a', '#686868', '#e0e0e0'],
      creative: { bw:100, contrast:20, clarity:8, blacks:-14, whites:12, sharpness:8, vignette:-10 } },

    /* ── Architecture & City (5) ─────────────────────────────────────────── */
    { id: 'ar_urban', cat: 'architecture', name: 'Urban',
      desc: 'Cool, high-contrast, punchy — streets and skylines.',
      swatch: ['#1a2030', '#4a5868', '#8a9aaa'],
      creative: { temperature:-10, contrast:18, clarity:20, saturation:-6, vibrance:8, blacks:-14, sharpness:14, vignette:-10 } },

    { id: 'ar_street', cat: 'architecture', name: 'Street Photography',
      desc: 'Gritty, faded, honest — real life, no filters.',
      swatch: ['#303028', '#686858', '#b0a898'],
      creative: { saturation:-22, contrast:20, blacks:8, clarity:14, sharpness:12, noise:6, vignette:-16 } },

    { id: 'ar_clean', cat: 'architecture', name: 'Clean Architecture',
      desc: 'Bright, minimal, neutral — lines and geometry first.',
      swatch: ['#d8dce0', '#e8ecf0', '#f4f6f8'],
      creative: { exposure:6, highlights:-14, whites:16, clarity:14, saturation:-4, sharpness:16, temperature:-6 } },

    { id: 'ar_night_city', cat: 'architecture', name: 'Night City',
      desc: 'Deep shadows, lifted lights — city after dark.',
      swatch: ['#0a0e1a', '#1a3a5a', '#4a7aaa'],
      creative: { temperature:-12, shadows:20, highlights:8, contrast:14, vibrance:16, clarity:10, sharpness:12, vignette:-12 } },

    { id: 'ar_concrete', cat: 'architecture', name: 'Concrete & Steel',
      desc: 'Cold, industrial, desaturated — brutalist and modern.',
      swatch: ['#1e1e20', '#4a4a50', '#909098'],
      creative: { saturation:-30, temperature:-14, contrast:22, clarity:18, blacks:-16, sharpness:14, vignette:-8 } },

    /* ── Food (4) ───────────────────────────────────────────────────────── */
    { id: 'fo_restaurant', cat: 'food', name: 'Restaurant',
      desc: 'Warm, rich, slightly bright — appetising and inviting.',
      swatch: ['#c88040', '#e0a860', '#f4d090'],
      creative: { temperature:14, vibrance:18, exposure:6, highlights:-10, clarity:10, saturation:8, sharpness:10 } },

    { id: 'fo_bright', cat: 'food', name: 'Bright & Fresh',
      desc: 'Airy, clean, high-key — brunch and healthy eating.',
      swatch: ['#e8e0cc', '#f0e8d8', '#faf6ee'],
      creative: { exposure:10, highlights:-16, whites:18, vibrance:14, clarity:10, temperature:6, sharpness:8 } },

    { id: 'fo_moody', cat: 'food', name: 'Moody Food',
      desc: 'Dark, dramatic — fine dining and cocktail bars.',
      swatch: ['#1a1008', '#4a3018', '#8a6040'],
      creative: { exposure:-8, contrast:18, blacks:-20, shadows:-10, vibrance:12, clarity:14, vignette:-18, temperature:8 } },

    { id: 'fo_golden_plate', cat: 'food', name: 'Golden Plate',
      desc: 'Warm golden light — heritage restaurants and candlelit meals.',
      swatch: ['#c87818', '#e0a040', '#f4cc80'],
      creative: { temperature:20, vibrance:16, highlights:-12, shadows:14, contrast:10, clarity:8, vignette:-12 } },

    /* ── Creative (9) ───────────────────────────────────────────────────── */
    { id: 'cr_film', cat: 'creative', name: 'Film Look',
      desc: 'Faded blacks, warm grain — analog soul in a digital camera.',
      swatch: ['#8a7060', '#b89a80', '#d8c8b0'],
      creative: { blacks:16, shadows:8, temperature:12, saturation:-16, vibrance:8, contrast:10, highlights:-12, noise:12 } },

    { id: 'cr_matte', cat: 'creative', name: 'Matte',
      desc: 'Lifted blacks, flat highlights — low-contrast editorial look.',
      swatch: ['#3a3430', '#6a6058', '#a89c90'],
      creative: { blacks:22, highlights:-18, saturation:-24, contrast:-8, vibrance:4, noise:6 } },

    { id: 'cr_vintage', cat: 'creative', name: 'Vintage',
      desc: 'Warm, faded, slightly yellow — found-photo nostalgia.',
      swatch: ['#c0a050', '#d8c080', '#f0dca8'],
      creative: { temperature:20, tint:6, blacks:18, saturation:-18, vibrance:8, highlights:-16, contrast:6, noise:10 } },

    { id: 'cr_moody', cat: 'creative', name: 'Moody',
      desc: 'Dark teal shadows, orange highlights — cinematic tension.',
      swatch: ['#0e2030', '#2a4848', '#7a9878'],
      creative: { temperature:-8, tint:-4, saturation:-14, contrast:20, blacks:-18, shadows:8, highlights:-14, clarity:10, vignette:-18 } },

    { id: 'cr_high_contrast', cat: 'creative', name: 'High Contrast',
      desc: 'Punchy blacks, bright whites — bold and graphic.',
      swatch: ['#080808', '#484848', '#f0f0f0'],
      creative: { contrast:30, blacks:-24, whites:18, clarity:16, saturation:-6, sharpness:14, vignette:-14 } },

    { id: 'cr_golden', cat: 'creative', name: 'Golden Hour',
      desc: 'Warm cinematic glow — the magic light of any location.',
      swatch: ['#e09030', '#c07020', '#704010'],
      creative: { temperature:24, tint:5, vibrance:14, highlights:-12, shadows:8, contrast:6, vignette:-10, clarity:6 } },

    { id: 'cr_nordic', cat: 'creative', name: 'Nordic Cool',
      desc: 'Clean, cool, Scandinavian — quiet light and open space.',
      swatch: ['#8098b0', '#b0c4d4', '#d8e4ee'],
      creative: { temperature:-20, saturation:-14, vibrance:8, highlights:-8, whites:12, clarity:12, contrast:8, sharpness:10 } },

    { id: 'cr_desert', cat: 'creative', name: 'Desert Heat',
      desc: 'Warm, high-contrast, dry — sunbaked dunes and red rock.',
      swatch: ['#c87820', '#e09840', '#f0b860'],
      creative: { temperature:28, vibrance:10, contrast:16, highlights:-10, blacks:-14, clarity:14, saturation:-6, vignette:-10 } },

    { id: 'cr_bw_dramatic', cat: 'creative', mono: true, name: 'B&W Dramatic',
      desc: 'Extreme mono contrast — gritty, powerful, graphic.',
      swatch: ['#080808', '#404040', '#e8e8e8'],
      creative: { bw:100, contrast:30, blacks:-20, whites:16, clarity:18, sharpness:12, vignette:-18 } },

    /* ── Backward-compatible aliases (used by existing suggestions/scene) ── */
    { id: 'natural', cat: 'travel', name: 'Natural Travel',
      desc: 'Balanced, realistic color — true to the scene.',
      swatch: ['#7c9bb0', '#b8c4cc', '#e8e2d6'],
      creative: {} },

    { id: 'vibrant', cat: 'landscape', name: 'Vibrant Travel',
      desc: 'Punchy color, clarity and impact for the feed.',
      swatch: ['#1f8fbf', '#2bb673', '#f4c020'],
      creative: { vibrance:26, clarity:14, contrast:10, saturation:8, sharpness:12, whites:6 } },

    { id: 'golden', cat: 'creative', name: 'Golden Hour Classic',
      desc: 'Warm, cinematic glow with soft highlights.',
      swatch: ['#e9a23b', '#d97a3c', '#7a4a2a'],
      creative: { temperature:24, tint:5, vibrance:14, highlights:-12, shadows:8, contrast:6, vignette:-10, clarity:6 } },

    { id: 'moody', cat: 'creative', name: 'Moody Documentary',
      desc: 'Muted color, deep shadows, editorial weight.',
      swatch: ['#4a5560', '#2c333b', '#8a7e70'],
      creative: { saturation:-32, contrast:16, blacks:-20, shadows:-12, highlights:-6, clarity:12, vignette:-14, temperature:-4 } },

    { id: 'bw', cat: 'creative', mono: true, name: 'Black & White Classic',
      desc: 'Monochrome with optimised contrast and tonal range.',
      swatch: ['#1a1a1a', '#7d7d7d', '#e6e6e6'],
      creative: { bw:100, contrast:18, clarity:14, blacks:-12, whites:8, sharpness:12 } },
  ];

  /* ---- Scene → recommended presets -------------------------------------- */
  const SCENE_RECS = {
    'Landscape':            ['ls_vibrant', 'ls_dramatic_sky', 'ls_cinematic', 'ls_natural'],
    'Sunset / Golden Hour': ['cr_golden', 'tr_golden_road', 'ls_cinematic', 'tr_warm_vacation'],
    'Nature':               ['ls_deep_greens', 'ls_forest', 'ls_natural', 'ls_vibrant'],
    'Beach & Water':        ['ls_ocean', 'ls_vibrant', 'tr_warm_vacation', 'cr_golden'],
    'City & Architecture':  ['ar_urban', 'ar_street', 'ar_clean', 'cr_high_contrast'],
    'Food':                 ['fo_restaurant', 'fo_bright', 'fo_golden_plate', 'fo_moody'],
    'Portrait':             ['po_natural', 'po_warm_skin', 'po_golden_portrait', 'po_soft'],
    'Night':                ['ar_night_city', 'cr_moody', 'cr_film', 'cr_high_contrast'],
    'Low Light':            ['cr_film', 'cr_moody', 'tr_documentary', 'moody'],
    'Indoor':               ['po_warm_skin', 'tr_luxury', 'fo_restaurant', 'cr_film'],
  };

  /* ---- Lookup helpers ---------------------------------------------------- */
  function byId(id)      { return LIST.find(p => p.id === id) || null; }
  function byCategory(c) { return LIST.filter(p => p.cat === c); }
  function recommendFor(sceneType) { return SCENE_RECS[sceneType] || ['natural', 'vibrant', 'cr_golden', 'cr_film']; }

  /* ---- Build final params ------------------------------------------------ */
  // Mixes auto-corrective base + creative delta, then scales by intensity.
  // Accepts optional scene object to select portrait-safe base correction.
  function build(presetId, stats, intensity, scene) {
    const preset = byId(presetId);
    if (!preset) return Object.assign({}, Imaging.DEFAULTS);
    const usePortrait = preset.portraitSafe || (scene && scene.isPortrait);
    const corr = (usePortrait && window.Analysis && Analysis.autoParamsPortrait)
      ? Analysis.autoParamsPortrait(stats, 'natural')
      : Analysis.autoParams(stats, 'natural');
    const merged = Object.assign({}, Imaging.DEFAULTS);
    [corr, preset.creative].forEach(src => {
      for (const k in src) merged[k] = clamp((merged[k] || 0) + (src[k] || 0), k === 'bw' ? 0 : -100, 100);
    });
    const k = clamp(intensity, 0, 1);
    const out = {};
    for (const key in merged) {
      out[key] = key === 'bw'
        ? (preset.mono ? merged.bw : Math.round(merged.bw * k))
        : Math.round(clamp(merged[key] * k, -100, 100));
    }
    return out;
  }

  global.Presets = { LIST, CATEGORIES, byId, byCategory, recommendFor, build };
})(window);
