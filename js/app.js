/* ============================================================================
 * Lumen — Application Controller
 * Wires the imaging engine + analysis brain to the UI.
 * ==========================================================================*/
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const PREVIEW_MAX = 1500;   // working resolution for live editing
  const ANALYZE_MAX = 1100;   // resolution used for statistics
  const EXPORT_MAX = 2560;    // web-optimized export cap

  const SLIDER_GROUPS = [
    { title: 'Light', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
    { title: 'Color', keys: ['temperature', 'tint', 'saturation', 'vibrance'] },
    { title: 'Detail', keys: ['clarity', 'sharpness', 'noise'] },
    { title: 'Effects', keys: ['vignette'] }
  ];
  const LABELS = {
    exposure: 'Exposure', contrast: 'Contrast', highlights: 'Highlights', shadows: 'Shadows',
    whites: 'Whites', blacks: 'Blacks', temperature: 'Temperature', tint: 'Tint',
    saturation: 'Saturation', vibrance: 'Vibrance', clarity: 'Clarity', sharpness: 'Sharpness',
    noise: 'Noise reduction', vignette: 'Vignette'
  };

  /* ---- State ------------------------------------------------------------*/
  const library = [];   // { id, name, url, img, w, h, params, strength, edited, stats, history }
  let current = -1;
  let strength = 'professional';
  // active preview buffers
  let origData = null, dispData = null, pw = 0, ph = 0;
  let rafPending = false;

  const els = {
    stage: $('#stage'), main: $('#main'), film: $('#film'), filmList: $('#filmList'),
    libCount: $('#libCount'), after: $('#afterCanvas'), before: $('#beforeCanvas'),
    wrap: $('#canvasWrap'), divider: $('#divider'), dropzone: $('#dropzone'),
    fileInput: $('#fileInput'), fileName: $('#fileName'), railEmpty: $('#railEmpty'),
    railBody: $('#railBody'), sliders: $('#sliders'), explain: $('#explain'),
    toast: $('#toast'), procBar: $('#procBar')
  };
  const actx = els.after.getContext('2d');
  const bctx = els.before.getContext('2d');

  /* ---- Toast ------------------------------------------------------------*/
  let toastT;
  function toast(msg, action) {
    els.toast.innerHTML = '';
    els.toast.appendChild(document.createTextNode(msg));
    if (action) {
      const b = document.createElement('button');
      b.className = 'toast-action'; b.textContent = action.label;
      b.onclick = () => { action.fn(); els.toast.classList.remove('show'); };
      els.toast.appendChild(b);
    }
    els.toast.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => els.toast.classList.remove('show'), action ? 5200 : 2200);
  }

  /* ---- Image helpers ----------------------------------------------------*/
  function fitDims(w, h, max) {
    const s = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }
  function imageDataFrom(img, max) {
    const { w, h } = fitDims(img.naturalWidth || img.width, img.naturalHeight || img.height, max);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h), w, h };
  }

  // Non-destructive working source: straighten + crop the ORIGINAL into a
  // fresh buffer at the requested resolution. The original image is never
  // modified — crop lives entirely in entry.crop.
  function buildWorkingSource(e, maxDim) {
    const iw = e.img.naturalWidth || e.img.width, ih = e.img.naturalHeight || e.img.height;
    const box = fitDims(iw, ih, maxDim);            // box keeps original aspect
    const c = e.crop || { x: 0, y: 0, w: 1, h: 1, angle: 0 };
    const sc = Imaging.straightenedCanvas(e.img, c.angle || 0, box.w, box.h);
    const cx = Math.round((c.x || 0) * box.w), cy = Math.round((c.y || 0) * box.h);
    const cw = Math.max(1, Math.round((c.w == null ? 1 : c.w) * box.w));
    const ch = Math.max(1, Math.round((c.h == null ? 1 : c.h) * box.h));
    const out = document.createElement('canvas'); out.width = cw; out.height = ch;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(sc, cx, cy, cw, ch, 0, 0, cw, ch);
    return { data: ctx.getImageData(0, 0, cw, ch), w: cw, h: ch };
  }

  /* ---- Library ----------------------------------------------------------*/
  function addImage(img, name, url, exif) {
    let stats;
    try {
      const a = imageDataFrom(img, ANALYZE_MAX);
      stats = Imaging.analyze(a.data);
    } catch (e) {
      // CORS-tainted (external demo that blocked pixel read) — skip silently
      return null;
    }
    if (window.Scene) stats.scene = Scene.classify(stats);
    const entry = {
      id: 'img' + Date.now() + Math.random().toString(36).slice(2, 6),
      name, url, img, w: img.naturalWidth, h: img.naturalHeight,
      params: Object.assign({}, Imaging.DEFAULTS), strength: 'professional',
      edited: false, stats, history: [], preset: null,
      crop: { x: 0, y: 0, w: 1, h: 1, angle: 0 },
      exif: exif ? exif.fields : null,
      exifApp1: exif ? exif.app1 : null,
      exifGpsOff: exif ? exif.gpsOff : -1,
      hasGPS: exif ? exif.hasGPS : false
    };
    library.push(entry);
    renderFilm();
    return entry;
  }

  function loadFiles(files) {
    const imgs = [...files].filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;
    const firstNew = library.length;
    let pending = imgs.length;
    imgs.forEach(async f => {
      let exif = null;
      try { exif = window.Exif ? Exif.parse(await f.arrayBuffer()) : null; } catch (e) { exif = null; }
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = async () => {
        if (window.Store) {
          // Persist path: save metadata + original blob to IndexedDB
          URL.revokeObjectURL(url);   // Store creates its own object URL
          const entry = await Store.addPhoto(f, img, exif);
          try {
            const a = imageDataFrom(img, ANALYZE_MAX);
            entry.stats = Imaging.analyze(a.data);
            if (window.Scene) entry.stats.scene = Scene.classify(entry.stats);
          } catch (e) { /* tainted canvas */ }
          library.push(entry);
          renderFilm();
        } else {
          addImage(img, f.name, url, exif);
        }
        if (--pending === 0) finalize();
      };
      img.onerror = () => { if (--pending === 0) finalize(); };
      img.src = url;
    });
    function finalize() {
      renderFilm();
      if (current === -1 && library.length) selectImage(firstNew < library.length ? firstNew : 0);
      updateChrome();
    }
  }

  function addDemoImage(seed, name) {
    return new Promise(res => {
      let done = false;
      const finish = e => { if (!done) { done = true; res(e); } };
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => finish(addImage(img, name, img.src));
      img.onerror = () => finish(null);
      setTimeout(() => finish(null), 2500); // don't hang if network is slow/absent
      img.src = `https://picsum.photos/seed/${seed}/1600/1067`;
    });
  }

  function renderFilm() {
    els.libCount.textContent = library.length;
    els.filmList.innerHTML = '';
    library.forEach((e, i) => {
      const t = document.createElement('button');
      t.className = 'thumb' + (i === current ? ' active' : '') + (e.edited ? ' edited' : '');
      t.innerHTML = `<img src="${e.url}" alt=""><span class="badge"><svg viewBox="0 0 24 24" fill="none" stroke="#0a2a18" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>`;
      t.onclick = () => selectImage(i);
      els.filmList.appendChild(t);
    });
    els.main.classList.toggle('solo', library.length <= 1);
    if (window.Dashboard) Dashboard.refresh();
  }

  /* ---- Selection --------------------------------------------------------*/
  function selectImage(i) {
    current = i;
    const e = library[i];
    strength = e.strength;
    els.stage.classList.remove('empty');
    els.fileName.textContent = e.name;
    renderFilm();
    syncStrengthSeg();
    updateChrome();          // make rail visible BEFORE rendering histograms
    loadWorking(e);
    switchView('editor');
    // On phone: jump straight to the canvas after selecting a photo
    if (window.innerWidth <= 640) switchMobileTab('edit');
  }

  // (Re)build the active preview buffers from the entry's current crop + analyze.
  function loadWorking(e) {
    const ws = buildWorkingSource(e, PREVIEW_MAX);
    origData = ws.data; pw = ws.w; ph = ws.h;
    dispData = new ImageData(pw, ph);
    els.after.width = pw; els.after.height = ph;
    els.before.width = pw; els.before.height = ph;
    bctx.putImageData(origData, 0, 0);   // before = cropped original, untouched color
    e.stats = Imaging.analyze(origData); // stats reflect the current framing
    if (window.Scene) e.stats.scene = Scene.classify(e.stats);
    populateAnalysis(e.stats);
    populateMeta(e);
    buildSliders();
    render();
    renderExplanation(e);
    if (window.Panels) Panels.onSelect(e);
  }

  /* ---- Render pipeline ---------------------------------------------------*/
  function render() {
    if (current < 0 || !origData) return;
    const e = library[current];
    Imaging.process(origData, e.params, dispData);
    actx.putImageData(dispData, 0, 0);
    const h = Imaging.quickHist(dispData);
    Histogram.render($('#histRGB'), h, 'rgb');
    Histogram.render($('#histLuma'), h, 'luma');
  }
  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }

  /* ---- Analysis panel ---------------------------------------------------*/
  function setScore(valEl, barEl, score) {
    valEl.innerHTML = score + '<small>/100</small>';
    barEl.style.width = score + '%';
    barEl.style.background = score >= 75 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
  }
  function populateAnalysis(s) {
    setScore($('#expScore'), $('#expBar'), Analysis.exposureScore(s));
    setScore($('#harmScore'), $('#harmBar'), Analysis.colorHarmonyScore(s));
    // issues
    const issues = Analysis.detectIssues(s);
    $('#issues').innerHTML = issues.map(it =>
      `<span class="chip sev${it.sev}"><span class="dot"></span>${it.label}</span>`).join('');
    // white balance
    const wb = Analysis.whiteBalance(s, 1);
    const sw = $('#wbSwatch');
    sw.style.background = `rgb(${Math.round(s.meanR)},${Math.round(s.meanG)},${Math.round(s.meanB)})`;
    const parts = [];
    if (wb.temp > 1) parts.push(`warm +${wb.temp}`); else if (wb.temp < -1) parts.push(`cool ${wb.temp}`);
    if (wb.tint > 1) parts.push(`+${wb.tint} magenta`); else if (wb.tint < -1) parts.push(`${wb.tint} green`);
    $('#wbText').innerHTML = parts.length
      ? `Shift <b>${parts.join(', ')}</b> to neutralise the cast in this frame.`
      : `White balance reads <b>neutral</b> — no correction needed.`;
    // dominant colors
    const dom = s.dominant.length ? s.dominant : [{ r: s.meanR, g: s.meanG, b: s.meanB, weight: 1 }];
    const total = dom.reduce((a, c) => a + c.weight, 0) || 1;
    $('#domRow').innerHTML = dom.map(c =>
      `<i style="width:${(c.weight / total * 100).toFixed(1)}%;background:rgb(${c.r},${c.g},${c.b})"></i>`).join('');
  }

  /* ---- Camera metadata card ---------------------------------------------*/
  function populateMeta(e) {
    const box = $('#metaBody'); if (!box) return;
    const x = e.exif;
    if (!x || !(x.Make || x.Model || x.ISO || x.FNumber || x.ExposureTime)) {
      box.innerHTML = '<div class="meta-empty">No camera metadata in this file.</div>';
      return;
    }
    const rows = [
      ['Camera', [x.Make, x.Model].filter(Boolean).join(' ') || '\u2014'],
      ['Lens', x.LensModel || '\u2014'],
      ['ISO', x.ISO != null ? 'ISO ' + x.ISO : '\u2014'],
      ['Shutter', Exif.fmtExposure(x.ExposureTime) || '\u2014'],
      ['Aperture', Exif.fmtAperture(x.FNumber) || '\u2014'],
      ['Focal', x.FocalLength != null ? Math.round(x.FocalLength) + 'mm' : '\u2014']
    ];
    box.innerHTML = '<div class="meta-grid">' +
      rows.map(r => `<div class="meta-cell"><span class="mk">${r[0]}</span><span class="mv">${r[1]}</span></div>`).join('') +
      '</div>' +
      (e.hasGPS
        ? '<div class="meta-gps warn"><span class="dot"></span>GPS location present \u2014 remove it on export for privacy.</div>'
        : '<div class="meta-gps ok"><span class="dot"></span>No GPS location embedded.</div>');
  }

  function renderExplanation(e) {
    if (!e.edited) {
      els.explain.className = 'explain empty';
      els.explain.textContent = 'Run Auto-Enhance to see a breakdown of every correction.';
      return;
    }
    const lines = Analysis.explain(e.stats, e.params);
    els.explain.className = 'explain';
    els.explain.innerHTML =
      `<div class="x-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2L12 3Z"/></svg>Auto-correction report</div>`
      + '<ul>' + lines.map(l => `<li>${l}</li>`).join('') + '</ul>';
  }

  /* ---- Sliders ----------------------------------------------------------*/
  function buildSliders() {
    els.sliders.innerHTML = '';
    SLIDER_GROUPS.forEach(g => {
      const t = document.createElement('div'); t.className = 'grp-title'; t.textContent = g.title;
      els.sliders.appendChild(t);
      g.keys.forEach(k => els.sliders.appendChild(makeSlider(k)));
    });
  }
  function makeSlider(key) {
    const e = library[current];
    const wrap = document.createElement('div');
    wrap.className = 'slider'; wrap.dataset.key = key;
    wrap.innerHTML =
      `<div class="row"><span class="name">${LABELS[key]}</span><span class="num">0</span></div>
       <input type="range" min="-100" max="100" step="1" value="0">`;
    const input = wrap.querySelector('input'), num = wrap.querySelector('.num');
    const set = (v, commit) => {
      v = Math.round(v);
      e.params[key] = v; input.value = v; num.textContent = (v > 0 ? '+' : '') + v;
      wrap.classList.toggle('changed', v !== 0);
      if (commit) commitEdit();
      scheduleRender();
    };
    input.addEventListener('input', () => set(+input.value, false));
    input.addEventListener('change', () => { markEdited(); clearPreset(); commitEdit(); });
    wrap.querySelector('.row').addEventListener('dblclick', () => { pushHistory(); set(0, true); markEdited(); clearPreset(); });
    // initialize from current params
    set(e.params[key] || 0, false);
    wrap._set = set;
    return wrap;
  }
  function syncSliders() {
    if (current < 0) return;
    const e = library[current];
    els.sliders.querySelectorAll('.slider').forEach(w => w._set(e.params[w.dataset.key] || 0, false));
  }

  /* ---- Edits / history --------------------------------------------------*/
  function isCropped(e) {
    const c = e.crop || {};
    return (c.x || 0) > 0.001 || (c.y || 0) > 0.001 || (c.w == null ? 1 : c.w) < 0.999 ||
      (c.h == null ? 1 : c.h) < 0.999 || Math.abs(c.angle || 0) > 0.01;
  }
  function computeEdited(e) {
    return Object.keys(Imaging.DEFAULTS).some(k => (e.params[k] || 0) !== 0) || isCropped(e);
  }
  function snapshot(e) { return { params: Object.assign({}, e.params), crop: Object.assign({}, e.crop) }; }
  function pushHistoryFor(e) { e.history.push(snapshot(e)); if (e.history.length > 40) e.history.shift(); }
  function pushHistory() { if (current >= 0) pushHistoryFor(library[current]); }
  let commitT;
  function commitEdit() {
    clearTimeout(commitT);
    commitT = setTimeout(() => {
      updateChrome();
      // Persist the current edit state to IndexedDB
      if (window.Store && current >= 0) Store.saveEdit(library[current]).catch(console.error);
    }, 60);
  }
  function markEdited() {
    const e = library[current];
    if (!e.edited) { e.edited = true; renderFilm(); }
  }

  /* ---- Auto enhance -----------------------------------------------------*/
  function autoEnhance(entry, render2) {
    pushHistoryFor(entry);
    entry.params = Analysis.autoParams(entry.stats, entry.strength);
    entry.edited = true;
    entry.preset = null;
    if (render2) { syncSliders(); render(); renderExplanation(entry); if (window.Panels) Panels.onParamsChanged(entry); }
  }
  function pushHistoryForLegacy(e) { /* removed */ }

  function runAuto() {
    if (current < 0) return;
    const btn = $('#autoBtn'); btn.classList.add('busy');
    progress(0.2);
    setTimeout(() => {
      const e = library[current]; e.strength = strength;
      autoEnhance(e, true);
      renderFilm(); updateChrome(); btn.classList.remove('busy'); progress(1);
      toast('Auto-enhanced · ' + cap(strength));
    }, 120);
  }

  function runBatch() {
    if (!library.length) return;
    let n = 0;
    library.forEach(e => { e.strength = strength; autoEnhance(e, false); n++; });
    if (current >= 0) { syncSliders(); render(); renderExplanation(library[current]); if (window.Panels) Panels.onParamsChanged(library[current]); }
    renderFilm(); updateChrome();
    toast(`Auto-enhanced ${n} photo${n > 1 ? 's' : ''} · ${cap(strength)}`);
  }

  function progress(v) {
    els.procBar.style.width = (v * 100) + '%';
    if (v >= 1) setTimeout(() => { els.procBar.style.width = '0'; }, 350);
  }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---- Shared edit ops (used by Panels / Suggestions / Dashboard) -------*/
  function getCurrentEntry() { return current >= 0 ? library[current] : null; }
  function clearPreset() {
    const e = getCurrentEntry(); if (e && e.preset) { e.preset = null; if (window.Panels) Panels.onParamsChanged(e); }
  }
  function applyParamsTo(entry, params, opts) {
    opts = opts || {};
    pushHistoryFor(entry);
    entry.params = Object.assign({}, Imaging.DEFAULTS, params);
    entry.edited = computeEdited(entry);
    if ('preset' in opts) entry.preset = opts.preset;
    if (entry === getCurrentEntry()) {
      syncSliders(); render(); renderExplanation(entry);
      if (window.Panels) Panels.onParamsChanged(entry);
    }
    renderFilm(); updateChrome();
  }
  function mergeParamsTo(entry, delta) {
    const p = Object.assign({}, entry.params);
    for (const k in delta) p[k] = Imaging.clamp((p[k] || 0) + delta[k], k === 'bw' ? 0 : -100, 100);
    applyParamsTo(entry, p, {}); // keep preset reference (a tweak on top)
  }

  /* ---- View switching ---------------------------------------------------*/
  let view = 'editor';
  function switchView(v) {
    view = v;
    document.body.classList.toggle('view-dashboard', v === 'dashboard');
    const gb = $('#galleryBtn'); if (gb) gb.classList.toggle('on', v === 'dashboard');
    if (v === 'dashboard' && window.Dashboard) Dashboard.refresh();
  }

  /* ---- Mobile tab switching (phone only) --------------------------------*/
  // Controlled by body classes: mob-lib | mob-edit | mob-adjust
  // Only meaningful on screens ≤640px — no-op on tablet/desktop.
  const MOB_TABS = ['lib', 'edit', 'adjust'];
  function switchMobileTab(tab) {
    if (!MOB_TABS.includes(tab)) return;
    document.body.classList.remove('mob-lib', 'mob-edit', 'mob-adjust');
    document.body.classList.add('mob-' + tab);
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    const ids = { lib: 'navLib', edit: 'navEdit', adjust: 'navAdjust' };
    const btn = document.getElementById(ids[tab]);
    if (btn) btn.classList.add('active');
  }
  window.switchMobileTab = switchMobileTab;

  /* ---- Delete / undo-protected ------------------------------------------*/
  function requestDelete(i) {
    const e = library[i]; if (!e) return;
    showConfirm('Delete photo?', `“${e.name}” will be removed from your library. This can be undone.`, () => doDelete(i));
  }
  function doDelete(i) {
    const e = library[i]; if (!e) return;
    library.splice(i, 1);
    if (window.Store) Store.deletePhoto(e.id).catch(console.error);
    if (current === i) {
      current = -1;
      if (library.length) selectImage(Math.min(i, library.length - 1));
      else { origData = null; els.stage.classList.add('empty'); els.fileName.textContent = 'No image loaded'; updateChrome(); }
    } else if (current > i) { current--; }
    renderFilm(); updateChrome();
    toast(`Deleted “${e.name}”`, { label: 'Undo', fn: () => restoreEntry(e, i) });
  }
  function restoreEntry(entry, i) {
    library.splice(Math.min(i, library.length), 0, entry);
    // Un-mark the tombstone in IndexedDB (blob was kept for exactly this case)
    if (window.Store) Store.restorePhoto(entry).catch(console.error);
    renderFilm();
    selectImage(library.indexOf(entry));
    toast('Photo restored');
  }

  /* ---- Confirm modal ----------------------------------------------------*/
  function showConfirm(title, body, onYes) {
    const m = $('#modal');
    $('#modalTitle').textContent = title;
    $('#modalBody').textContent = body;
    m.classList.add('show');
    const close = () => { m.classList.remove('show'); $('#modalYes').onclick = null; $('#modalNo').onclick = null; };
    $('#modalYes').onclick = () => { close(); onYes(); };
    $('#modalNo').onclick = close;
    $('#modalBackdrop').onclick = close;
  }

  /* ---- Undo / reset -----------------------------------------------------*/
  function undo() {
    const e = library[current];
    if (!e || !e.history.length) return;
    const snap = e.history.pop();
    e.params = snap.params; e.crop = snap.crop;
    e.edited = computeEdited(e);
    loadWorking(e);          // crop may have changed — rebuild working buffers
    renderFilm(); updateChrome();
  }
  function reset() {
    const e = library[current]; if (!e) return;
    pushHistory();
    e.params = Object.assign({}, Imaging.DEFAULTS);
    e.crop = { x: 0, y: 0, w: 1, h: 1, angle: 0 };
    e.edited = false; e.preset = null;
    loadWorking(e); renderFilm(); updateChrome();
    toast('Reset to original photo');
  }

  /* ---- Crop commit (non-destructive) ------------------------------------*/
  function commitCrop(entry, crop) {
    pushHistoryFor(entry);
    entry.crop = Object.assign({ x: 0, y: 0, w: 1, h: 1, angle: 0 }, crop);
    entry.edited = computeEdited(entry);
    if (entry === getCurrentEntry()) loadWorking(entry);
    renderFilm(); updateChrome();
    toast('Crop applied');
  }
  function enterCrop() {
    const e = getCurrentEntry();
    if (e && window.Crop) window.Crop.open(e);
  }

  /* ---- Batch operations -------------------------------------------------*/
  function afterBatch(list, cropChanged) {
    const cur = getCurrentEntry();
    if (cur && list.indexOf(cur) >= 0) {
      if (cropChanged) loadWorking(cur);
      else { syncSliders(); render(); renderExplanation(cur); if (window.Panels) Panels.onParamsChanged(cur); }
    }
    renderFilm(); updateChrome();
    if (window.Dashboard) Dashboard.refresh();
  }
  function batchPreset(list, presetId, intensity) {
    list.forEach(e => { pushHistoryFor(e); e.params = Presets.build(presetId, e.stats, intensity); e.preset = { id: presetId, intensity }; e.edited = true; });
    afterBatch(list);
  }
  function batchAuto(list) {
    list.forEach(e => { pushHistoryFor(e); e.params = Analysis.autoParams(e.stats, e.strength); e.preset = null; e.edited = true; });
    afterBatch(list);
  }
  function batchCrop(list, aspectVal) {
    list.forEach(e => {
      pushHistoryFor(e);
      const ia = (e.img.naturalWidth || e.w) / (e.img.naturalHeight || e.h);
      const c = Analysis.suggestCrop(e.stats, aspectVal, ia);
      e.crop = { x: c.x, y: c.y, w: c.w, h: c.h, angle: e.crop.angle || 0 };
      e.edited = computeEdited(e);
    });
    afterBatch(list, true);
  }

  /* ---- Export -----------------------------------------------------------*/
  function exportImage() {
    const e = library[current]; if (!e) return;
    progress(0.3);
    setTimeout(() => {
      try {
        const full = buildWorkingSource(e, EXPORT_MAX);   // straighten + crop at export res
        const out = new ImageData(full.w, full.h);
        Imaging.process(full.data, e.params, out);
        const c = document.createElement('canvas'); c.width = full.w; c.height = full.h;
        c.getContext('2d').putImageData(out, 0, 0);
        progress(0.8);
        c.toBlob(blob => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = e.name.replace(/\.[^.]+$/, '') + '-lumen.jpg';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          progress(1);
          toast(`Exported ${full.w}×${full.h} · web-optimized JPEG · original preserved`);
        }, 'image/jpeg', 0.9);
      } catch (err) { toast('Export blocked — try an uploaded photo'); progress(1); }
    }, 60);
  }

  /* ---- Strength segments ------------------------------------------------*/
  function syncStrengthSeg() {
    $('#strengthSeg').querySelectorAll('button').forEach(b =>
      b.classList.toggle('on', b.dataset.k === strength));
  }

  /* ---- Compare / hold ---------------------------------------------------*/
  let comparing = false;
  function setSplit(clientX) {
    const r = els.wrap.getBoundingClientRect();
    const pct = Imaging.clamp((clientX - r.left) / r.width * 100, 0, 100);
    els.wrap.style.setProperty('--split', pct + '%');
  }
  function initCompareDrag() {
    let dragging = false;
    els.divider.addEventListener('pointerdown', ev => { dragging = true; els.divider.setPointerCapture(ev.pointerId); });
    els.divider.addEventListener('pointermove', ev => { if (dragging) setSplit(ev.clientX); });
    els.divider.addEventListener('pointerup', () => { dragging = false; });
  }

  /* ---- Chrome state -----------------------------------------------------*/
  function updateChrome() {
    const has = current >= 0;
    const e = has ? library[current] : null;
    $('#exportBtn').disabled = !has;
    $('#resetBtn').disabled = !e || !e.edited;
    $('#undoBtn').disabled = !e || !e.history.length;
    els.railEmpty.style.display = has ? 'none' : '';
    els.railBody.style.display = has ? '' : 'none';
  }

  /* ---- Events -----------------------------------------------------------*/
  function bind() {
    $('#browseBtn').onclick = $('#addTile').onclick = () => els.fileInput.click();
    els.fileInput.onchange = ev => { loadFiles(ev.target.files); ev.target.value = ''; };
    $('#autoBtn').onclick = runAuto;
    $('#batchBtn').onclick = runBatch;
    $('#exportBtn').onclick = () => { const e = getCurrentEntry(); if (e && window.Export) Export.open([e]); };
    $('#resetBtn').onclick = reset;
    $('#undoBtn').onclick = undo;
    $('#strengthSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
      strength = b.dataset.k; syncStrengthSeg();
      if (current >= 0) library[current].strength = strength;
      if (window.Store) Store.saveSetting('strength', strength).catch(console.error);
    });
    // Mobile bottom nav
    document.getElementById('navLib')    .onclick = () => switchMobileTab('lib');
    document.getElementById('navEdit')   .onclick = () => switchMobileTab('edit');
    document.getElementById('navAdjust') .onclick = () => switchMobileTab('adjust');
    // Set initial mobile body class
    document.body.classList.add('mob-edit');

    const gb = $('#galleryBtn');
    if (gb) gb.onclick = () => switchView(view === 'dashboard' ? 'editor' : 'dashboard');
    $('#cropBtn').onclick = enterCrop;
    // compare
    $('#compareBtn').onclick = () => {
      comparing = !comparing;
      els.wrap.classList.toggle('compare', comparing);
      $('#compareBtn').classList.toggle('on', comparing);
      if (comparing) els.wrap.style.setProperty('--split', '50%');
    };
    // hold original
    const hold = $('#holdBtn');
    const down = () => els.wrap.classList.add('show-original');
    const up = () => els.wrap.classList.remove('show-original');
    hold.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    hold.addEventListener('pointerleave', up);
    initCompareDrag();
    // keyboard
    window.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { $('#modal').classList.remove('show'); if (view === 'dashboard') switchView('editor'); }
      else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); }
      else if (ev.key === 'Enter' && current >= 0 && view === 'editor' && !ev.target.matches('input')) runAuto();
    });
    // drag & drop
    ['dragenter', 'dragover'].forEach(t => els.stage.addEventListener(t, ev => {
      ev.preventDefault(); els.stage.classList.add('dragging');
    }));
    ['dragleave', 'drop'].forEach(t => els.stage.addEventListener(t, ev => {
      ev.preventDefault();
      if (t === 'dragleave' && els.stage.contains(ev.relatedTarget)) return;
      els.stage.classList.remove('dragging');
    }));
    els.stage.addEventListener('drop', ev => { if (ev.dataTransfer.files.length) loadFiles(ev.dataTransfer.files); });
    window.addEventListener('resize', () => { if (current >= 0) render(); });
  }

  /* ---- Synthetic fallback scenes (used when offline / no network) --------
   * Procedural abstract landscapes with deliberate flaws so the engine has
   * something real to correct. Same-origin data URLs — never taint-blocked. */
  function makeScene(kind) {
    const W = 1500, H = 1000;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const cfg = {
      dusk:  { sky: ['#3a4a66', '#6f7d92', '#b9a48f'], sun: '#d9c4a0', hill: '#2c3340', cast: [0.78, 0.86, 1.06], dark: 0.72 },
      haze:  { sky: ['#9fb0bd', '#b7c2cb', '#cdd2d4'], sun: '#e7e3da', hill: '#8a96a0', cast: [1.0, 1.0, 1.0], dark: 1.04, flat: 0.45 },
      warm:  { sky: ['#caa46e', '#e0b97f', '#f0d6a4'], sun: '#fff0c8', hill: '#6e5236', cast: [1.12, 1.0, 0.82], dark: 0.92 }
    }[kind];
    // sky gradient
    const g = x.createLinearGradient(0, 0, 0, H * 0.7);
    g.addColorStop(0, cfg.sky[0]); g.addColorStop(0.6, cfg.sky[1]); g.addColorStop(1, cfg.sky[2]);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // sun glow
    const sx = W * 0.68, sy = H * 0.34;
    const rg = x.createRadialGradient(sx, sy, 0, sx, sy, W * 0.34);
    rg.addColorStop(0, cfg.sun); rg.addColorStop(0.25, cfg.sun + '88'); rg.addColorStop(1, '#00000000');
    x.fillStyle = rg; x.fillRect(0, 0, W, H);
    // layered hills
    const hills = [[0.62, 0.5], [0.72, 0.72], [0.84, 1.0]];
    hills.forEach(([base, dk], idx) => {
      x.beginPath(); x.moveTo(0, H);
      for (let px = 0; px <= W; px += 24) {
        const y = H * base + Math.sin(px / 220 + idx * 2) * 38 + Math.sin(px / 70 + idx) * 12;
        x.lineTo(px, y);
      }
      x.lineTo(W, H); x.closePath();
      x.fillStyle = shade(cfg.hill, dk); x.fill();
    });
    // water reflection band
    x.fillStyle = shade(cfg.sky[1], 0.8); x.fillRect(0, H * 0.84, W, H * 0.16);
    // film grain + apply cast & exposure flaw
    const id = x.getImageData(0, 0, W, H), d = id.data;
    const flat = cfg.flat || 1;
    for (let i = 0; i < d.length; i += 4) {
      const noise = (Math.random() - 0.5) * 10;
      for (let k = 0; k < 3; k++) {
        let v = d[i + k] * cfg.cast[k] * cfg.dark + noise;
        if (cfg.flat) v = 128 + (v - 128) * flat; // wash out contrast
        d[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    x.putImageData(id, 0, 0);
    return c.toDataURL('image/jpeg', 0.92);
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) * k, g = ((n >> 8) & 255) * k, b = (n & 255) * k;
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  function addSynthetic(kind, name) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => { addImage(img, name, img.src); res(); };
      img.onerror = () => res();
      img.src = makeScene(kind);
    });
  }

  /* ---- Boot -------------------------------------------------------------*/
  // Shared API for sibling modules (panels.js, dashboard.js)
  window.Lumen = {
    get library() { return library; },
    get currentIndex() { return current; },
    getCurrentEntry, selectImage, applyParamsTo, mergeParamsTo,
    requestDelete, switchView, switchMobileTab, openImport: () => els.fileInput.click(),
    toast, get strength() { return strength; },
    commitCrop, enterCrop, buildWorkingSource, processInto: (data, params, out) => Imaging.process(data, params, out),
    batch: { preset: batchPreset, auto: batchAuto, crop: batchCrop, exportList: (list) => window.Export && Export.open(list) }
  };

  async function boot() {
    bind();
    updateChrome();
    if (window.Panels) Panels.init();
    if (window.Dashboard) Dashboard.init();

    /* ── Phase 1: initialise persistent storage ─────────────────────────── */
    if (window.LumenStore && window.LocalProvider) {
      try {
        const provider = new LocalProvider();
        window.Store = new LumenStore(provider);
        // Restore saved editing-strength preference
        const savedStrength = await Store.loadSetting('strength', 'professional');
        strength = savedStrength; syncStrengthSeg();
        // Load all persisted photos from IndexedDB
        const stored = await Store.init();
        for (const entry of stored) {
          const blob = await Store.loadOriginal(entry.id);
          if (!blob) continue; // original not on this device (future: fetch on demand)
          await new Promise(resolve => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
              entry.img = img; entry.url = url;
              try {
                const ws = imageDataFrom(img, ANALYZE_MAX);
                entry.stats = Imaging.analyze(ws.data);
                if (window.Scene) entry.stats.scene = Scene.classify(entry.stats);
              } catch (e) { /* tainted */ }
              library.push(entry);
              resolve();
            };
            img.onerror = resolve;
            img.src = url;
          });
        }
      } catch (err) { console.warn('[Lumen] Store init error:', err); }
    }

    // If we restored stored photos, skip demo content entirely
    if (library.length) { renderFilm(); selectImage(0); return; }

    /* ── First-run demo content ──────────────────────────────────────────── */
    // Try real demo photos first; fall back to synthetic flawed scenes offline.
    const demos = [
      ['lumen-kyoto', 'Kyoto-alley.jpg'],
      ['lumen-fjord', 'Norway-fjord.jpg'],
      ['lumen-market', 'Marrakech-market.jpg']
    ];
    for (const [seed, name] of demos) await addDemoImage(seed, name);
    if (!library.length) {
      await addSynthetic('dusk', 'Dusk-harbour_underexposed.jpg');
      await addSynthetic('haze', 'Mountain-haze_flat.jpg');
      await addSynthetic('warm', 'Desert-dunes_warm-cast.jpg');
    }
    // Sample EXIF for demo photos so the metadata card demonstrates (real
    // uploads carry their own parsed EXIF).
    const SAMPLE = [
      { f: { Make: 'FUJIFILM', Model: 'X-T5', LensModel: 'XF 16-55mm F2.8', ISO: 200, ExposureTime: 1 / 500, FNumber: 8, FocalLength: 23 }, gps: true },
      { f: { Make: 'SONY', Model: 'A7 IV', LensModel: 'FE 24-70mm F2.8 GM', ISO: 100, ExposureTime: 1 / 1000, FNumber: 11, FocalLength: 35 }, gps: false },
      { f: { Make: 'Canon', Model: 'EOS R6', LensModel: 'RF 35mm F1.8', ISO: 400, ExposureTime: 1 / 250, FNumber: 5.6, FocalLength: 35 }, gps: true }
    ];
    library.forEach((e, i) => { if (!e.exif) { const s = SAMPLE[i % SAMPLE.length]; e.exif = s.f; e.hasGPS = s.gps; } });
    if (library.length) { renderFilm(); selectImage(0); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
