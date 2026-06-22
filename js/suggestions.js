/* ============================================================================
 * Lumen — Suggestion Engine ("Lumen AI")
 * Turns measured statistics into a ranked list of optional, user-approved
 * recommendations. Each suggestion carries an action the UI can apply.
 * Optionally enriched with a natural-language note from Claude.
 * ==========================================================================*/
(function (global) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---- Black & white suitability -----------------------------------------
   * Strong contrast + texture + tonal range with low color reliance → mono. */
  function monochromeScore(s) {
    const contrast = clamp(s.stdL / 70, 0, 1);
    const texture = clamp(s.edgeEnergy / 26, 0, 1);
    const range = clamp((s.whitePoint - s.blackPoint) / 245, 0, 1);
    const colorRich = clamp(s.sat / 0.45, 0, 1) * (0.55 + 0.45 * Math.min(1, s.dominant.length / 4));
    const score = 0.40 * contrast + 0.28 * texture + 0.20 * range - 0.42 * colorRich + 0.12;
    return { score: clamp(score, 0, 1), contrast, texture, range, colorRich };
  }

  /* ---- Composition read (region brightness) ------------------------------*/
  function composition(s) {
    const r = s.regions, mean = s.meanL || 1;
    const vertSkew = (r.top - r.bottom) / mean;       // + sky-heavy, - ground-heavy
    const horizSkew = (r.right - r.left) / mean;
    const centerSkew = (r.center - mean) / mean;       // + bright subject centered
    return { vertSkew, horizSkew, centerSkew };
  }

  /* ---- Build ranked suggestions ------------------------------------------*/
  function build(s) {
    const out = [];
    const m = s.meanL / 255;
    const cast = Analysis.colorCast(s);

    // Travel scene detection drives the headline recommendation
    if (s.scene) {
      out.push({
        id: 'scene', icon: 'wand', tag: 'Travel scene',
        title: `${s.scene.type} detected · ${Math.round(s.scene.confidence * 100)}%`,
        detail: (global.Scene ? global.Scene.advice(s.scene) : '') + ` Suggested preset: ${presetName(s.scene.preset)}.`,
        action: { type: 'preset', presetId: s.scene.preset, intensity: 0.8 }, rec: s.scene.confidence > 0.6
      });
    }

    // Exposure
    if (m < 0.4 || m > 0.6) {
      const v = Math.round(clamp((0.47 - m) * 190, -55, 55));
      out.push({
        id: 'exposure', icon: 'sun', tag: 'Exposure',
        title: v > 0 ? `Brighten exposure +${v}` : `Recover exposure ${v}`,
        detail: v > 0
          ? `Mid-brightness reads ${Math.round(m * 100)}% — lifting exposure opens up the scene.`
          : `Frame is hot at ${Math.round(m * 100)}% — pulling exposure protects highlight detail.`,
        action: { type: 'merge', delta: { exposure: v } }, rec: Math.abs(v) > 18
      });
    }

    // Contrast / clarity
    if (s.stdL < 44) {
      const c = Math.round(clamp((46 - s.stdL) * 1.1, 6, 38));
      out.push({
        id: 'contrast', icon: 'contrast', tag: 'Contrast',
        title: `Add contrast +${c}`,
        detail: `Histogram is flat (σ≈${Math.round(s.stdL)}). More contrast plus a touch of clarity adds depth and dimensionality.`,
        action: { type: 'merge', delta: { contrast: c, clarity: Math.round(c * 0.4) } }, rec: s.stdL < 36
      });
    }

    // Color grading — white balance first, then richness
    if (cast.label) {
      const wb = Analysis.whiteBalance(s, 1);
      out.push({
        id: 'wb', icon: 'drop', tag: 'Color grading',
        title: `Correct white balance`,
        detail: `A ${cast.label.toLowerCase()} was detected. Neutralising it (temp ${wb.temp >= 0 ? '+' : ''}${wb.temp}, tint ${wb.tint >= 0 ? '+' : ''}${wb.tint}) gives clean, believable color.`,
        action: { type: 'merge', delta: { temperature: wb.temp, tint: wb.tint } }, rec: cast.magnitude > 16
      });
    }
    if (s.sat < 0.3) {
      const vb = Math.round(clamp((0.36 - s.sat) * 135, 8, 40));
      out.push({
        id: 'color', icon: 'palette', tag: 'Color grading',
        title: `Enrich color +${vb}`,
        detail: `Saturation averages ${Math.round(s.sat * 100)}% — on the dull side. Vibrance protects skin tones while reviving skies and foliage.`,
        action: { type: 'merge', delta: { vibrance: vb, saturation: Math.round(vb * 0.25) } }, rec: s.sat < 0.22
      });
    }

    // Composition / crop — skip for Night and Low Light where vertical
    // brightness skew is natural (bright lights vs dark sky/ground).
    const comp = composition(s);
    const isNightScene = s.scene && (s.scene.isNight || s.scene.isLowLight);
    if (Math.abs(comp.vertSkew) > 0.18 && !isNightScene) {
      const skyHeavy = comp.vertSkew > 0;
      out.push({
        id: 'crop', icon: 'crop', tag: 'Composition',
        title: skyHeavy ? 'Crop toward the foreground' : 'Crop toward the sky',
        detail: skyHeavy
          ? `The upper half is much brighter — likely empty sky. Cropping to a lower horizon (≈ bottom two-thirds) strengthens the rule-of-thirds and the subject.`
          : `Detail and brightness sit up top. Lifting the horizon to the lower third gives the scene more room to breathe.`,
        action: { type: 'merge', delta: { vignette: -10, clarity: 6 } }, advisory: true, rec: false
      });
    }

    // Mood / style — recommend a matching preset
    const mood = recommendPreset(s);
    out.push({
      id: 'mood', icon: 'wand', tag: 'Mood & style',
      title: `Try the “${mood.name}” look`,
      detail: mood.why,
      action: { type: 'preset', presetId: mood.id, intensity: 0.8 }, rec: mood.strong
    });

    // Black & white
    const mono = monochromeScore(s);
    if (mono.score > 0.34) {
      out.push({
        id: 'bw', icon: 'bw', tag: 'Black & white',
        title: mono.score > 0.52 ? 'Strong B&W candidate' : 'Consider a B&W version',
        detail: `${pct(mono.contrast)} contrast, ${pct(mono.texture)} texture and ${pct(mono.range)} tonal range with ${pct(1 - mono.colorRich)} color independence — this frame holds up beautifully in monochrome.`,
        action: { type: 'preset', presetId: 'bw', intensity: 0.85 }, rec: mono.score > 0.52, score: mono.score
      });
    }

    // rank: recommended first, advisory last
    return out.sort((a, b) => (b.rec ? 1 : 0) - (a.rec ? 1 : 0) || (a.advisory ? 1 : 0) - (b.advisory ? 1 : 0));
  }

  function pct(v) { return Math.round(v * 100) + '%'; }

  function presetName(id) {
    return (global.Presets && Presets.byId(id)) ? Presets.byId(id).name : id;
  }

  function recommendPreset(s) {
    if (s.scene && s.scene.confidence > 0.58) {
      return { id: s.scene.preset, name: presetName(s.scene.preset), why: (global.Scene ? global.Scene.advice(s.scene) : ''), strong: s.scene.confidence > 0.7 };
    }
    const m = s.meanL / 255;
    const warm = s.meanR - s.meanB;
    const mono = monochromeScore(s).score;
    if (mono > 0.55) return { id: 'bw', name: 'Black & White Classic', why: 'Bold contrast and texture make this an ideal monochrome frame.', strong: true };
    if (warm > 8 && s.highClip < 0.06) return { id: 'golden', name: 'Golden Hour', why: 'Warm light and gentle highlights suit a cinematic golden grade.', strong: true };
    if (m < 0.38 || s.sat < 0.24) return { id: 'moody', name: 'Moody Documentary', why: 'Low-key light lends itself to a muted, editorial treatment.', strong: false };
    if (s.sat > 0.4 && s.dominant.length >= 3) return { id: 'vibrant', name: 'Vibrant Travel', why: 'Rich, varied color rewards a punchy, high-impact grade.', strong: true };
    return { id: 'natural', name: 'Natural Travel', why: 'A balanced, true-to-life grade keeps this scene authentic.', strong: false };
  }

  /* ---- Optional Claude natural-language art-direction note ----------------*/
  async function aiNote(s) {
    if (!(global.claude && global.claude.complete)) return null;
    const mono = monochromeScore(s).score;
    const summary = {
      brightness: Math.round(s.meanL / 255 * 100) + '%',
      contrastSigma: Math.round(s.stdL),
      saturation: Math.round(s.sat * 100) + '%',
      shadowClip: Math.round(s.shadowClip * 100) + '%',
      highlightClip: Math.round(s.highClip * 100) + '%',
      colorCast: (Analysis.colorCast(s).label || 'neutral'),
      dominantColors: s.dominant.slice(0, 3).map(c => `rgb(${c.r},${c.g},${c.b})`),
      bwSuitability: Math.round(mono * 100) + '%'
    };
    const sceneStr = s.scene
      ? ` Detected scene: ${s.scene.type} (${Math.round(s.scene.confidence * 100)}% confidence).`
      : '';
    const issueStr = s.issues && s.issues.length
      ? ` Key issues detected: ${s.issues.map(i => i.label).join(', ')}.`
      : '';
    const prompt =
      'You are a senior travel-photography editor giving concise, specific art direction. ' +
      'Based ONLY on the measured statistics below, write exactly 2-3 sentences: ' +
      '(1) The mood and visual treatment you would pursue given the scene type. ' +
      '(2) The single most important technical correction and the reason for it. ' +
      '(3) Whether a black-and-white or split-tone treatment is worth exploring, and why. ' +
      'Be direct and specific. Do not use bullet points, headers, or filler phrases. ' +
      'Stats: ' + JSON.stringify(summary) + sceneStr + issueStr;
    try {
      const text = await global.claude.complete({ messages: [{ role: 'user', content: prompt }] });
      return (text || '').trim();
    } catch (e) { return null; }
  }

  global.Suggestions = { build, monochromeScore, recommendPreset, aiNote, available: () => !!(global.claude && global.claude.complete) };
})(window);
