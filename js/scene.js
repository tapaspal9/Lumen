/* ============================================================================
 * Lumen — Smart Scene Classifier  (js/scene.js)
 * Heuristic pixel-analysis scene detection. 10 scene categories with
 * portrait / face awareness and night / low-light detection.
 * No ML model required — runs entirely on existing pixel statistics.
 * ============================================================================ */
(function (global) {
  'use strict';
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ---- Color family from a dominant-color entry -------------------------- */
  function family(c) {
    const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (sat < 0.18) return 'neutral';
    if (c.b >= c.r && c.b >= c.g) return 'blue';
    if (c.g >= c.r && c.g >= c.b) return 'green';
    // Skin: warm mid-range, r > g > b, not too saturated, not too dark
    if (c.r > 110 && c.r < 245 && c.g > 65 && c.g < 210 &&
        c.g >= c.b && c.r > c.g &&
        (c.r - c.b) > 18 && (c.r - c.b) < 140 &&
        (c.r - c.g) < 80) return 'skin';
    return 'warm';
  }

  /* ---- Main classifier --------------------------------------------------- */
  function classify(s) {
    // Build color family weights from dominant-color palette
    const fam = { blue: 0, green: 0, warm: 0, neutral: 0, skin: 0 };
    let tot = 0;
    (s.dominant || []).forEach(c => { fam[family(c)] += c.weight; tot += c.weight; });
    if (tot <= 0) tot = 1;
    for (const k in fam) fam[k] /= tot;

    const m      = s.meanL / 255;
    const r      = s.regions || {};
    const edge   = s.edgeEnergy || 0;
    const warmCast = (s.meanR || 128) - (s.meanB || 128);

    // Region analysis
    const topBright    = r.top > (r.bottom || 0) * 1.08;
    const centerBright = (r.center || 128) > (r.top || 128) * 0.98;

    // Derived flags — used to boost/suppress candidate scores
    const isNight    = m < 0.24 && (s.stdL || 0) > 18;
    const isLowLight = m < 0.36 && !isNight;
    const hasPortraitSkin = fam.skin > 0.13 && centerBright && fam.skin > fam.green * 0.7;
    const isIndoor   = edge < 20 && !topBright && (fam.warm + fam.neutral) > 0.52 && m > 0.26;

    /* Candidate list — each type scores independently ------------------- */
    const C = [
      { type: 'Sunset / Golden Hour', preset: 'cr_golden',
        score: fam.warm * 1.3 + (warmCast > 12 ? 0.4 : 0) + (s.highClip > 0.01 ? 0.2 : 0) +
               (m > 0.28 && m < 0.62 ? 0.25 : 0) - (isNight ? 0.6 : 0) },

      { type: 'Landscape', preset: 'ls_vibrant',
        score: fam.blue * 0.9 + (topBright ? 0.55 : 0) + (edge < 22 ? 0.3 : 0) +
               fam.green * 0.35 - (hasPortraitSkin ? 0.6 : 0) - (isNight ? 0.3 : 0) },

      { type: 'Nature', preset: 'ls_deep_greens',
        score: fam.green * 1.45 + (edge > 14 ? 0.2 : 0) -
               (hasPortraitSkin ? 0.6 : 0) - (isIndoor ? 0.3 : 0) },

      { type: 'Beach & Water', preset: 'ls_ocean',
        score: fam.blue * 1.05 + (m > 0.52 ? 0.4 : 0) + (edge < 18 ? 0.3 : 0) -
               (hasPortraitSkin ? 0.35 : 0) - (isNight ? 0.4 : 0) },

      { type: 'City & Architecture', preset: 'ar_urban',
        score: fam.neutral * 1.1 + (edge > 26 ? 0.55 : 0) + (!topBright ? 0.2 : 0) -
               (hasPortraitSkin ? 0.35 : 0) },

      { type: 'Food', preset: 'fo_restaurant',
        // Food: warm + saturated + center-bright + high edge detail (texture)
        // but NOT heavily green (Nature) and NOT skin-dominant (Portrait).
        score: fam.warm * 0.65 + (s.sat > 0.35 ? 0.40 : 0) + (s.sat > 0.46 ? 0.20 : 0) +
               (!topBright ? 0.30 : 0) + (centerBright ? 0.22 : 0) + (edge > 22 ? 0.28 : 0) -
               fam.blue * 0.90 - fam.green * 0.35 -
               (hasPortraitSkin ? 0.65 : 0) - (isNight ? 0.25 : 0) },

      { type: 'Portrait', preset: 'po_natural', isPortrait: true,
        // topBright is a sky signal — penalise it so portrait doesn't win
        // on golden-background shots where Sunset also scores high.
        score: fam.skin * 1.85 + (hasPortraitSkin ? 1.2 : 0) + (!topBright ? 0.30 : 0) -
               (topBright ? 0.28 : 0) - (m < 0.2 ? 0.4 : 0) - (isNight ? 0.25 : 0) },

      { type: 'Night', preset: 'ar_night_city',
        score: (isNight ? 1.6 : 0) + (m < 0.28 && !isNight ? 0.4 : 0) },

      { type: 'Low Light', preset: 'cr_film',
        score: (isLowLight ? 1.0 : 0) + (m < 0.36 && !isNight ? 0.4 : 0) +
               (edge > 12 ? 0.15 : 0) - (isNight ? 0.8 : 0) },

      { type: 'Indoor', preset: 'tr_luxury',
        score: (isIndoor ? 1.0 : 0) + (edge < 16 && !topBright && m > 0.26 ? 0.35 : 0) -
               (topBright ? 0.5 : 0) },
    ];

    C.sort((a, b) => b.score - a.score);
    const best = C[0], second = C[1];
    // Lower base offset so weak detections honestly show lower confidence;
    // higher gap multiplier rewards clear winners more strongly.
    const conf = clamp(0.36 + (best.score - second.score) * 0.62 + best.score * 0.12, 0.30, 0.95);

    return {
      type:         best.type,
      preset:       best.preset,
      confidence:   conf,
      families:     fam,
      isPortrait:   !!(best.isPortrait),
      hasFaces:     hasPortraitSkin,
      isNight,
      isLowLight,
      candidates:   C.slice(0, 3),   // top-3 for the confirm dialog
    };
  }

  /* ---- Scene advice ----------------------------------------------------- */
  const ADVICE = {
    'Sunset / Golden Hour': 'Warm light suits a cinematic golden grade — protect highlights and let color glow.',
    'Landscape':            'Open vista — a vibrant grade with extra clarity makes skies and detail pop.',
    'Nature':               'Lush greenery rewards vibrance over raw saturation to keep foliage natural.',
    'Beach & Water':        'Bright water scene — lift clarity and contrast, watch for blown highlights.',
    'City & Architecture':  'Structured scene — clarity and contrast emphasise lines; consider B&W.',
    'Food':                 'Close subject — boost vibrance and warmth, keep it crisp and appetising.',
    'Portrait':             'Human subject detected — portrait-safe mode protects skin tones and texture.',
    'Night':                'Night scene — lift shadows carefully, protect light sources, moody grade.',
    'Low Light':            'Low-light — gentle shadow recovery and noise reduction recommended.',
    'Indoor':               'Indoor scene — correct artificial light cast, keep colors warm and natural.',
  };
  function advice(scene) { return ADVICE[scene.type] || 'Balanced grade recommended.'; }

  global.Scene = { classify, advice };
})(window);
