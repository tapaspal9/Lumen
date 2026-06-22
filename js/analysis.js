/* ============================================================================
 * Lumen — Analysis Brain
 * Interprets raw stats into scores, detected issues, white-balance advice,
 * auto-correction parameters, and a plain-language explanation.
 * ==========================================================================*/
(function (global) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const STRENGTH = { subtle: 0.45, natural: 0.72, professional: 1.0, dramatic: 1.45 };

  // Per-scene correction targets — drives auto-enhance toward goals that are
  // appropriate for the detected subject rather than a single universal average.
  // meanL:       ideal mid-brightness (0–1).  contrastMult: scales contrast boost.
  // satTarget:   ideal mean saturation — vibrance & saturation drive toward this.
  const SCENE_TARGETS = {
    'Portrait':             { meanL: 0.50, satTarget: 0.38, contrastMult: 0.65 },
    'Landscape':            { meanL: 0.46, satTarget: 0.44, contrastMult: 1.10 },
    'Nature':               { meanL: 0.46, satTarget: 0.46, contrastMult: 1.05 },
    'Night':                { meanL: 0.30, satTarget: 0.34, contrastMult: 1.25 },
    'Low Light':            { meanL: 0.40, satTarget: 0.36, contrastMult: 1.05 },
    'Sunset / Golden Hour': { meanL: 0.48, satTarget: 0.46, contrastMult: 1.00 },
    'Beach & Water':        { meanL: 0.52, satTarget: 0.44, contrastMult: 1.00 },
    'City & Architecture':  { meanL: 0.45, satTarget: 0.32, contrastMult: 1.20 },
    'Food':                 { meanL: 0.52, satTarget: 0.46, contrastMult: 0.90 },
    'Indoor':               { meanL: 0.50, satTarget: 0.40, contrastMult: 0.90 },
  };

  /* ---- Scores -------------------------------------------------------------*/
  function exposureScore(s) {
    const m = s.meanL / 255;
    let score = 100 - Math.abs(m - 0.47) * 175 - s.shadowClip * 140 - s.highClip * 160;
    // reward healthy dynamic range
    score -= Math.max(0, (40 - s.stdL)) * 0.5;
    return Math.round(clamp(score, 0, 100));
  }

  function colorHarmonyScore(s) {
    const sat = s.sat;
    let score = 100 - Math.abs(sat - 0.42) * 110;
    // cast penalty
    const cast = colorCast(s);
    score -= cast.magnitude * 0.9;
    // reward variety of dominant hues
    score += Math.min(12, s.dominant.length * 2.5);
    return Math.round(clamp(score, 0, 100));
  }

  function colorCast(s) {
    const rb = s.meanR - s.meanB;          // + warm, - cool
    const green = s.meanG - (s.meanR + s.meanB) / 2; // + green, - magenta
    const magnitude = Math.sqrt(rb * rb + green * green);
    let label = null;
    if (magnitude > 10) {
      if (Math.abs(rb) >= Math.abs(green)) label = rb > 0 ? 'Warm cast' : 'Cool / blue cast';
      else label = green > 0 ? 'Green cast' : 'Magenta cast';
    }
    return { rb, green, magnitude, label };
  }

  /* ---- Issue detection ----------------------------------------------------*/
  function detectIssues(s) {
    const issues = [];
    const m = s.meanL / 255;
    if (m < 0.36) issues.push({ label: 'Underexposed', sev: m < 0.26 ? 2 : 1 });
    else if (m > 0.62) issues.push({ label: 'Overexposed', sev: m > 0.72 ? 2 : 1 });
    if (s.stdL < 42) issues.push({ label: 'Flat / low contrast', sev: s.stdL < 32 ? 2 : 1 });
    if (s.sat < 0.26) issues.push({ label: 'Dull, undersaturated color', sev: s.sat < 0.18 ? 2 : 1 });
    if (s.shadowClip > 0.04) issues.push({ label: 'Crushed shadows', sev: s.shadowClip > 0.1 ? 2 : 1 });
    if (s.highClip > 0.03) issues.push({ label: 'Blown highlights', sev: s.highClip > 0.08 ? 2 : 1 });
    const cast = colorCast(s);
    if (cast.label) issues.push({ label: cast.label, sev: cast.magnitude > 22 ? 2 : 1 });
    if (s.blackPoint > 18) issues.push({ label: 'Hazy / lifted blacks', sev: 1 });
    if (!issues.length) issues.push({ label: 'Well balanced — minor polish only', sev: 0 });
    return issues;
  }

  /* ---- White balance recommendation --------------------------------------*/
  function whiteBalance(s, k) {
    const cast = colorCast(s);
    const temp = clamp(-cast.rb * 0.85, -45, 45) * k;
    const tint = clamp(cast.green * 0.85, -35, 35) * k;
    return { temp: Math.round(temp), tint: Math.round(tint) };
  }

  /* ---- Auto parameters ----------------------------------------------------*/
  function autoParams(s, strengthKey, scene) {
    const k = STRENGTH[strengthKey] != null ? STRENGTH[strengthKey] : 1.0;
    // Scene-specific targets override the universal averages when a scene is known.
    const tgt = (scene && SCENE_TARGETS[scene.type])
      || { meanL: 0.47, satTarget: 0.42, contrastMult: 1.0 };
    const m = s.meanL / 255;
    const wb = whiteBalance(s, k);

    let exposure    = clamp((tgt.meanL - m) * 190, -55, 55) * k;
    let contrast    = clamp((46 - s.stdL) * 1.1 * tgt.contrastMult, -8, 42) * k;
    let blacks      = clamp(-(s.blackPoint - 5) * 1.4, -42, 22) * k;
    let whites      = clamp((250 - s.whitePoint) * 0.95, -12, 40) * k;
    let shadows     = clamp(s.shadowClip * 280 + (m < tgt.meanL - 0.07 ? 14 : 0), 0, 55) * k;
    let highlights  = -clamp(s.highClip * 320 + (m > tgt.meanL + 0.13 ? 12 : 0), 0, 65) * k;
    // vibrance/saturation drive toward scene's saturation ideal rather than a fixed average
    let vibrance    = clamp((tgt.satTarget - 0.06 - s.sat) * 135, 0, 48) * k;
    let saturation  = clamp((tgt.satTarget - 0.12 - s.sat) * 40, -6, 16) * k;
    let clarity     = 9 * k;
    let sharpness   = 22 * k;
    let noise       = strengthKey === 'subtle' ? 0 : 4 * (k - 0.4);
    let vignette    = strengthKey === 'dramatic' ? -14 : strengthKey === 'professional' ? -5 : 0;

    const round = v => Math.round(clamp(v, -100, 100));
    return {
      exposure: round(exposure), contrast: round(contrast),
      highlights: round(highlights), shadows: round(shadows),
      whites: round(whites), blacks: round(blacks),
      temperature: wb.temp, tint: wb.tint,
      saturation: round(saturation), vibrance: round(vibrance),
      sharpness: round(sharpness), clarity: round(clarity),
      noise: round(noise), vignette: round(vignette)
    };
  }

  /* ---- Crop / composition assistant --------------------------------------
   * Given an analyzed image (with profiles), propose an optimal crop rect in
   * normalized box coordinates for a target pixel aspect ratio. Heuristics:
   * horizon detection, rule-of-thirds subject placement, edge-trim, balance. */
  function smoothArr(a) {
    const o = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) {
      let s = 0, c = 0;
      for (let k = -1; k <= 1; k++) { const j = i + k; if (j >= 0 && j < a.length) { s += a[j]; c++; } }
      o[i] = s / c;
    }
    return o;
  }
  function centroid(a) {
    let s = 0, w = 0; for (let i = 0; i < a.length; i++) { s += a[i] * (i + 0.5); w += a[i]; }
    return w ? (s / w) / a.length : 0.5;
  }
  function nearestThird(v) { return Math.abs(v - 1 / 3) <= Math.abs(v - 2 / 3) ? 1 / 3 : 2 / 3; }
  const cl01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  // aspectVal: target pixel ratio (w/h), or 0 for "original". imageAspect = W/H.
  function suggestCrop(an, aspectVal, imageAspect) {
    const pr = an.profiles;
    if (!pr) return { x: 0, y: 0, w: 1, h: 1, angle: 0 };
    const P = pr.rowLuma.length;

    // Horizon: strongest brightness step in vertical luma profile
    const rl = smoothArr(pr.rowLuma);
    let hi = -1, hmax = 0, total = 0;
    for (let i = 1; i < P; i++) { const dd = Math.abs(rl[i] - rl[i - 1]); total += dd; if (dd > hmax) { hmax = dd; hi = i; } }
    const horizonStrength = total ? hmax / (total / P) : 0;   // how dominant the step is
    const horizonY = hi > 0 ? hi / P : 0.5;

    // Subject placement: centroids of edge (detail) energy
    const subjX = centroid(pr.colEdge);
    const subjY = centroid(pr.rowEdge);

    // Crop size: target ratio, maximized within an 0.88 safe box (gentle trim)
    const m = 0.88;
    const rN = aspectVal > 0 ? aspectVal / imageAspect : 1;   // normalized w/h in box space
    let cw = m, ch = m;
    if (rN >= 1) { cw = m; ch = cl01(m / rN); } else { ch = m; cw = cl01(m * rN); }

    // Vertical placement: align horizon (if strong) else subject to a third
    let y;
    if (horizonStrength > 1.7) {
      const t = nearestThird(horizonY);
      y = horizonY - t * ch;
    } else {
      const t = nearestThird(subjY);
      y = subjY - t * ch;
    }
    // Horizontal placement: subject on nearest third
    const tx = nearestThird(subjX);
    let x = subjX - tx * cw;

    x = cl01(Math.min(x, 1 - cw));
    y = cl01(Math.min(y, 1 - ch));
    return { x, y, w: cw, h: ch, angle: 0, horizonY, subjX, subjY, horizonStrength };
  }

  function cropRationale(c, aspectLabel) {
    const out = [];
    const trim = Math.round((1 - c.w * c.h) * 100);
    if (c.horizonStrength > 1.7) {
      const third = c.horizonY < 0.5 ? 'upper' : 'lower';
      out.push(`Detected a horizon around ${Math.round(c.horizonY * 100)}% — aligned it to the ${third} third for a balanced skyline.`);
    } else {
      out.push(`Placed the main subject (detail centred near ${Math.round(c.subjX * 100)}%, ${Math.round(c.subjY * 100)}%) on a rule-of-thirds intersection.`);
    }
    out.push(`Trimmed ~${Math.max(0, trim)}% of distracting edge area and framed to ${aspectLabel}.`);
    return out;
  }
  function explain(s, p) {
    const out = [];
    const m = s.meanL / 255;
    if (Math.abs(p.exposure) > 3)
      out.push(p.exposure > 0
        ? `Lifted exposure +${p.exposure} — the frame read ${Math.round(m * 100)}% mid-brightness, darker than ideal.`
        : `Pulled exposure ${p.exposure} to tame an over-bright frame.`);
    if (p.temperature || p.tint) {
      const c = [];
      if (p.temperature > 2) c.push(`warmed +${p.temperature}`);
      else if (p.temperature < -2) c.push(`cooled ${p.temperature}`);
      if (p.tint > 2) c.push(`+${p.tint} magenta`);
      else if (p.tint < -2) c.push(`${p.tint} green`);
      if (c.length) out.push(`Neutralised the color cast (${c.join(', ')}) toward a clean white balance.`);
    }
    if (p.contrast > 3 || Math.abs(p.blacks) > 4 || p.whites > 4)
      out.push(`Expanded tonal range — contrast +${p.contrast}, whites ${p.whites >= 0 ? '+' : ''}${p.whites}, blacks ${p.blacks >= 0 ? '+' : ''}${p.blacks} — to add depth to a flat histogram (σ≈${Math.round(s.stdL)}).`);
    if (p.shadows > 4) out.push(`Opened shadows +${p.shadows} to recover detail in the darkest ${Math.round(s.shadowClip * 100)}% of pixels.`);
    if (p.highlights < -4) out.push(`Recovered highlights ${p.highlights} to hold sky and bright detail.`);
    if (p.vibrance > 4) out.push(`Boosted vibrance +${p.vibrance} — saturation averaged ${Math.round(s.sat * 100)}%, on the dull side for travel work.`);
    if (p.sharpness > 4 || p.clarity > 4) out.push(`Added clarity +${p.clarity} and sharpening +${p.sharpness} for crisp, publish-ready edges.`);
    if (p.vignette < -2) out.push(`Applied a subtle vignette (${p.vignette}) to draw the eye into the scene.`);
    if (!out.length) out.push('The image was already well balanced — only micro-adjustments were applied.');
    return out;
  }

  /* ---- Portrait-safe auto parameters ------------------------------------
   * Dramatically reduced clarity, sharpness, saturation and contrast to
   * protect skin texture, natural skin tones and facial brightness.
   * Called automatically when Scene.isPortrait is true.               */
  function autoParamsPortrait(s, strengthKey) {
    const k = (STRENGTH[strengthKey] != null ? STRENGTH[strengthKey] : 1.0) * 0.55;
    const m = s.meanL / 255;
    const wb = whiteBalance(s, k * 0.75);
    const round = v => Math.round(clamp(v, -100, 100));
    return {
      exposure:    round(clamp((0.47 - m) * 130, -30, 30) * k),
      contrast:    round(clamp((46 - s.stdL) * 0.55, -4, 16) * k),
      highlights:  round(-clamp(s.highClip * 220 + (m > 0.6 ? 7 : 0), 0, 36) * k),
      shadows:     round(clamp(s.shadowClip * 180 + (m < 0.4 ? 9 : 0), 0, 32) * k),
      whites:      round(clamp((250 - s.whitePoint) * 0.55, -7, 20) * k),
      blacks:      round(clamp(-(s.blackPoint - 5) * 0.75, -20, 12) * k),
      temperature: Math.round(wb.temp),
      tint:        Math.round(wb.tint),
      saturation:  round(clamp((0.3 - s.sat) * 18, -4, 7) * k),
      vibrance:    round(clamp((0.36 - s.sat) * 70, 0, 18) * k),
      sharpness:   round(10 * k),   // much lower than landscape
      clarity:     round(2 * k),    // minimal — protects skin texture
      noise:       round(strengthKey === 'subtle' ? 0 : 7 * k),
      vignette:    strengthKey === 'dramatic' ? -7 : 0,
    };
  }

  /* ---- Additional quality scores --------------------------------------*/
  // Sharpness quality: edge energy normalised to a 0–100 scale.
  function sharpnessScore(s) {
    return Math.round(clamp(((s.edgeEnergy || 0) / 36) * 100, 0, 100));
  }

  // Tonal balance: how evenly the histogram spans shadows / mids / highlights.
  function tonalBalance(s) {
    if (!s.histL) return 50;
    const n = s.n || 1;
    let sh = 0, mi = 0, hi = 0;
    for (let i = 0;   i < 85;  i++) sh += s.histL[i];
    for (let i = 85;  i < 171; i++) mi += s.histL[i];
    for (let i = 171; i < 256; i++) hi += s.histL[i];
    sh /= n; mi /= n; hi /= n;
    // Ideal: roughly 20/60/20 distribution
    const dev = Math.abs(sh - 0.20) + Math.abs(mi - 0.60) + Math.abs(hi - 0.20);
    return Math.round(clamp(100 - dev * 150, 0, 100));
  }

  // Dynamic range: how fully the tonal range is used (black → white spread).
  function dynamicRangeScore(s) {
    const spread = (s.whitePoint || 255) - (s.blackPoint || 0);
    return Math.round(clamp((spread / 220) * 100, 0, 100));
  }

  /* ---- Power enhance: aggressive scene-aware corrections ----------------
   * Amplifies corrections proportional to detected severity. Use when the
   * image needs a strong treatment rather than conservative polish.      */
  function powerParams(s, strengthKey, scene) {
    const base = autoParamsForScene(s, strengthKey, scene);
    const m = s.meanL / 255;
    const amp = (key, factor) => {
      if (Math.abs(base[key] || 0) > 3)
        base[key] = Math.round(clamp((base[key] || 0) * factor, -100, 100));
    };
    if (m < 0.38 || m > 0.62) { amp('exposure', 1.45); amp('shadows', 1.35); amp('highlights', 1.35); }
    if ((s.stdL || 0) < 44) { amp('contrast', 1.4); amp('blacks', 1.3); amp('whites', 1.3); }
    if ((s.sat  || 0) < 0.30) { amp('vibrance', 1.45); amp('saturation', 1.3); }
    if ((s.edgeEnergy || 0) < 20) { amp('clarity', 1.5); amp('sharpness', 1.4); }
    base.clarity   = Math.round(clamp((base.clarity   || 0) + 12, 0, 100));
    base.sharpness = Math.round(clamp((base.sharpness || 0) + 14, 0, 100));
    return base;
  }

  /* ---- Scene-aware dispatcher -------------------------------------------
   * Use this instead of autoParams when the scene is known.             */
  function autoParamsForScene(s, strengthKey, scene) {
    if (scene && scene.isPortrait) return autoParamsPortrait(s, strengthKey);
    return autoParams(s, strengthKey, scene);
  }

  /* ---- Tonal profiles ---------------------------------------------------
   * Returns 4 named correction sets adapted to actual pixel statistics.
   * Each profile: id, name, icon, tags[], description, params{}           */
  function tonalProfiles(s) {
    const m   = (s.meanL   || 128) / 255;
    const std = (s.stdL    || 40);
    const bp  = s.blackPoint || 0;
    const wp  = s.whitePoint || 255;
    return [
      {
        id: 'sCurve', name: 'S-Curve', icon: '◉',
        tags: ['Classic', 'Punchy'],
        description: 'Classic S-curve: richens contrast while keeping midtones alive.',
        params: {
          contrast:   clamp(Math.round(24 + (45 - std) * 0.42), 16, 48),
          blacks:     clamp(Math.round(-(bp - 4) * 0.9), -22, 5),
          whites:     clamp(Math.round((252 - wp) * 0.44), 0, 22),
          shadows:    clamp(Math.round((s.shadowClip || 0) * 110), 0, 16),
          highlights: -clamp(Math.round((s.highClip || 0) * 110), 0, 14)
        }
      },
      {
        id: 'filmLift', name: 'Film Lift', icon: '◑',
        tags: ['Cinematic', 'Matte'],
        description: 'Lifted blacks, reduced contrast — the flat cinematic look.',
        params: { blacks: 16, contrast: -16, highlights: -8, hlTint: 7, shTint: -10, saturation: -5 }
      },
      {
        id: 'airy', name: 'Airy & Bright', icon: '○',
        tags: ['Light', 'Soft'],
        description: 'High-key and open — great for lifestyle, food and portraits.',
        params: {
          exposure:   clamp(Math.round((0.54 - m) * 110), -10, 24),
          contrast: -10, whites: 18, shadows: 14, vibrance: 15, hlTint: 5
        }
      },
      {
        id: 'moody', name: 'Moody & Deep', icon: '●',
        tags: ['Dark', 'Dramatic'],
        description: 'Crushed blacks, high contrast, subdued color — brooding atmosphere.',
        params: {
          blacks:     clamp(Math.round(-(bp - 3) * 1.4), -32, -8),
          contrast: 34, highlights: -20, shadows: -10,
          saturation: -8, shTint: -14, clarity: 16
        }
      }
    ];
  }

  global.Analysis = {
    STRENGTH, exposureScore, colorHarmonyScore, colorCast,
    detectIssues, whiteBalance, autoParams, autoParamsPortrait, autoParamsForScene,
    explain, suggestCrop, cropRationale,
    sharpnessScore, tonalBalance, dynamicRangeScore, powerParams, tonalProfiles
  };
})(window);
