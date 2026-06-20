/* ============================================================================
 * Lumen — Smart Travel-Photo Detection
 * Heuristic scene classifier from pixel statistics (no model). Buckets the
 * dominant-color palette into hue families and combines with brightness,
 * region balance and edge energy to guess a travel photo type, then maps it
 * to a recommended preset and tailored advice.
 * ==========================================================================*/
(function (global) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function family(c) {
    const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (sat < 0.18) return 'neutral';
    if (c.b >= c.r && c.b >= c.g) return 'blue';
    if (c.g >= c.r && c.g >= c.b) return 'green';
    // warm region: red/orange/yellow. skin = warm but mid, r>g>b moderate
    if (c.r > 120 && c.r < 245 && c.g > 70 && c.g < 200 && c.g >= c.b && c.r > c.g && (c.r - c.b) > 20 && (c.r - c.b) < 130) return 'skin';
    return 'warm';
  }

  function classify(s) {
    const fam = { blue: 0, green: 0, warm: 0, neutral: 0, skin: 0 };
    let tot = 0;
    (s.dominant || []).forEach(c => { fam[family(c)] += c.weight; tot += c.weight; });
    if (tot <= 0) tot = 1;
    for (const k in fam) fam[k] /= tot;

    const m = s.meanL / 255;
    const r = s.regions || {};
    const topBright = r.top > r.bottom * 1.08;          // bright sky up top
    const edge = s.edgeEnergy || 0;
    const warmCast = s.meanR - s.meanB;

    const C = [];                                        // candidate {type, score, preset}
    C.push({ type: 'Sunset', preset: 'golden',
      score: fam.warm * 1.3 + (warmCast > 12 ? 0.4 : 0) + (s.highClip > 0.01 ? 0.2 : 0) + (m > 0.3 && m < 0.62 ? 0.2 : 0) });
    C.push({ type: 'Landscape', preset: 'vibrant',
      score: fam.blue * 0.9 + (topBright ? 0.5 : 0) + (edge < 22 ? 0.3 : 0) + fam.green * 0.4 });
    C.push({ type: 'Nature', preset: 'vibrant',
      score: fam.green * 1.4 + (edge > 16 ? 0.25 : 0) });
    C.push({ type: 'Beach & water', preset: 'vibrant',
      score: fam.blue * 1.0 + (m > 0.55 ? 0.4 : 0) + (edge < 18 ? 0.3 : 0) });
    C.push({ type: 'City & architecture', preset: 'vibrant',
      score: fam.neutral * 1.1 + (edge > 26 ? 0.5 : 0) + (!topBright ? 0.2 : 0) });
    C.push({ type: 'Food', preset: 'vibrant',
      score: fam.warm * 0.7 + (s.sat > 0.4 ? 0.4 : 0) + (!topBright ? 0.3 : 0) + (edge > 24 ? 0.2 : 0) - fam.blue });
    C.push({ type: 'People', preset: 'natural',
      score: fam.skin * 1.8 + (!topBright ? 0.2 : 0) });

    C.sort((a, b) => b.score - a.score);
    const best = C[0], second = C[1];
    const conf = clamp(0.45 + (best.score - second.score) * 0.6 + best.score * 0.15, 0.4, 0.97);
    return { type: best.type, preset: best.preset, confidence: conf, families: fam };
  }

  function advice(scene) {
    switch (scene.type) {
      case 'Sunset': return 'Warm light suits a cinematic golden grade — protect the highlights and let color glow.';
      case 'Landscape': return 'Open vista — a vibrant grade with extra clarity makes skies and detail pop.';
      case 'Nature': return 'Lush greenery rewards vibrance over raw saturation to keep foliage natural.';
      case 'Beach & water': return 'Bright water scene — lift clarity and contrast, watch for blown highlights.';
      case 'City & architecture': return 'Structured scene — clarity and contrast emphasise lines; consider B&W.';
      case 'Food': return 'Close subject — boost vibrance and warmth, keep it crisp and appetising.';
      case 'People': return 'Subject present — a natural grade protects skin tones; avoid over-saturation.';
      default: return 'Balanced grade recommended.';
    }
  }

  global.Scene = { classify, advice };
})(window);
