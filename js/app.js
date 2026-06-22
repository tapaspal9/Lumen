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
    { title: 'Light',     keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
    { title: 'Color',     keys: ['temperature', 'tint', 'saturation', 'vibrance'] },
    { title: 'Color Mix', keys: ['redSat', 'orangeSat', 'yellowSat', 'greenSat', 'cyanSat', 'blueSat', 'purpleSat'] },
    { title: 'Detail',    keys: ['clarity', 'sharpness', 'noise'] },
    { title: 'Toning',    keys: ['hlTint', 'shTint'] },
    { title: 'Local',     keys: ['localExp', 'localSat', 'maskR', 'maskFeather'] },
    { title: 'Effects',   keys: ['vignette'] }
  ];
  const LABELS = {
    exposure: 'Exposure', contrast: 'Contrast', highlights: 'Highlights', shadows: 'Shadows',
    whites: 'Whites', blacks: 'Blacks', temperature: 'Temperature', tint: 'Tint',
    saturation: 'Saturation', vibrance: 'Vibrance', clarity: 'Clarity', sharpness: 'Sharpness',
    noise: 'Noise reduction', vignette: 'Vignette',
    hlTint: 'Highlight tint', shTint: 'Shadow tint',
    localExp: 'Local exposure', localSat: 'Local saturation',
    maskR: 'Mask radius', maskFeather: 'Mask feather',
    redSat: 'Reds', orangeSat: 'Oranges', yellowSat: 'Yellows',
    greenSat: 'Greens', cyanSat: 'Cyans', blueSat: 'Blues', purpleSat: 'Purples'
  };

  // Non-standard ranges / non-zero default values for specific params
  const SLIDER_RANGE = { maskR: [0, 100], maskFeather: [0, 100] };
  const SLIDER_INIT  = { maskR: 45, maskFeather: 25 };

  /* ---- State ------------------------------------------------------------*/
  const library = [];   // { id, name, url, img, w, h, params, strength, edited, stats, history }
  let current = -1;
  let strength = 'professional';
  // active preview buffers
  let origData = null, dispData = null, pw = 0, ph = 0;
  let rafPending = false;
  // Web Worker for off-main-thread image processing
  let worker = null, workerBusy = false, pendingRender = false, renderSeq = 0;
  // Auto-enhance accumulate mode
  let stackMode = false;

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

  const RAW_EXTS = new Set(['.cr2','.cr3','.nef','.arw','.dng','.raf','.orf','.rw2','.pef','.srw','.3fr','.rw1','.iiq']);
  const HEIC_EXTS = new Set(['.heic','.heif']);
  const getFileExt = f => (f.name.toLowerCase().match(/\.[^.]+$/) || [''])[0];

  function loadFiles(files) {
    const allFiles = [...files];
    const rawFiles = allFiles.filter(f => RAW_EXTS.has(getFileExt(f)));
    // Accept image/* types + HEIC/HEIF by extension (non-Safari may report wrong MIME)
    const imgs = allFiles.filter(f => f.type.startsWith('image/') || HEIC_EXTS.has(getFileExt(f)));
    if (rawFiles.length && !imgs.length) {
      toast(`${rawFiles.length} RAW file${rawFiles.length > 1 ? 's' : ''} detected — convert to DNG or JPEG first for full editing`);
      return;
    }
    if (rawFiles.length) toast(`${rawFiles.length} RAW file${rawFiles.length > 1 ? 's' : ''} skipped — JPEG / PNG / WebP / AVIF / BMP / TIFF / HEIC supported`);
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
      img.onerror = async () => {
        // HEIC fallback: try converting via heic2any if browser can't decode natively
        if (HEIC_EXTS.has(getFileExt(f)) && window.heic2any) {
          try {
            toast('Converting HEIC…');
            const blob = await heic2any({ blob: f, toType: 'image/jpeg', quality: 0.94 });
            const convBlob = Array.isArray(blob) ? blob[0] : blob;
            const jUrl = URL.createObjectURL(convBlob);
            const jImg = new Image();
            jImg.onload = async () => {
              const convFile = new File([convBlob], f.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
              if (window.Store) {
                URL.revokeObjectURL(jUrl);
                const entry = await Store.addPhoto(convFile, jImg, exif);
                try {
                  const a = imageDataFrom(jImg, ANALYZE_MAX);
                  entry.stats = Imaging.analyze(a.data);
                  if (window.Scene) entry.stats.scene = Scene.classify(entry.stats);
                } catch (e2) { /* tainted */ }
                library.push(entry); renderFilm();
              } else {
                addImage(jImg, f.name, jUrl, exif);
              }
              if (--pending === 0) finalize();
            };
            jImg.onerror = () => { toast('HEIC conversion failed'); if (--pending === 0) finalize(); };
            jImg.src = jUrl;
            return;
          } catch (e2) { toast('HEIC not supported in this browser'); }
        }
        if (--pending === 0) finalize();
      };
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
    els.main.classList.toggle('solo', library.length === 0);
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
    // Migrate: ensure every default key exists (photos added before new params were created)
    e.params = Object.assign({}, Imaging.DEFAULTS, e.params);
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
    highlightColorMixSliders(e.stats);
    render();
    renderExplanation(e);
    if (window.Panels) Panels.onSelect(e);
  }

  /* ---- Render pipeline ---------------------------------------------------*/
  function flushHistograms(imgData) {
    const h = Imaging.quickHist(imgData);
    Histogram.render($('#histRGB'), h, 'rgb');
    Histogram.render($('#histLuma'), h, 'luma');
  }

  function render() {
    if (current < 0 || !origData) return;
    const e = library[current];
    if (worker && !workerBusy) {
      // Off-main-thread: keeps UI smooth during slider drags on large images
      workerBusy = true;
      const srcBuf = origData.data.buffer.slice(0);  // copy; origData stays intact
      const outBuf = new ArrayBuffer(pw * ph * 4);
      const rid = ++renderSeq;
      worker.postMessage(
        { srcBuf, outBuf, width: pw, height: ph, params: Object.assign({}, e.params), id: rid },
        [srcBuf, outBuf]
      );
    } else if (worker && workerBusy) {
      pendingRender = true;  // worker busy — re-render with latest params when free
    } else {
      // Synchronous fallback (no worker or worker failed to load)
      Imaging.process(origData, e.params, dispData);
      actx.putImageData(dispData, 0, 0);
      flushHistograms(dispData);
    }
  }

  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }

  /* ---- Web Worker setup -------------------------------------------------*/
  function setupWorker() {
    try {
      worker = new Worker('js/workers/imaging-worker.js');
      worker.onmessage = function ({ data }) {
        workerBusy = false;
        if (data.error) { console.warn('[Lumen] Worker error:', data.error); worker = null; render(); return; }
        if (data.id === renderSeq && current >= 0) {
          const arr = new Uint8ClampedArray(data.outBuf);
          dispData = new ImageData(arr, pw, ph);
          actx.putImageData(dispData, 0, 0);
          flushHistograms(dispData);
        }
        if (pendingRender) { pendingRender = false; render(); }
      };
      worker.onerror = function (err) {
        console.warn('[Lumen] Worker unavailable — main thread fallback:', err.message || err);
        worker = null; workerBusy = false; render();
      };
    } catch (err) {
      console.warn('[Lumen] Web Worker not supported:', err);
      worker = null;
    }
  }

  /* ---- Analysis panel ---------------------------------------------------*/
  function _buildQuickFix(s) {
    const box = $('#quickFix'); if (!box) return;
    const expS   = Analysis.exposureScore(s);
    const harmS  = Analysis.colorHarmonyScore(s);
    const sharpS = Analysis.sharpnessScore ? Analysis.sharpnessScore(s) : 100;
    const toneS  = Analysis.tonalBalance   ? Analysis.tonalBalance(s)   : 100;
    const fixes = [];
    if (expS  < 70)  fixes.push({ label: 'Fix exposure',  type: 'exposure', sev: expS  < 45 ? 2 : 1 });
    if (harmS < 65)  fixes.push({ label: 'Fix color',     type: 'color',    sev: harmS < 40 ? 2 : 1 });
    if (sharpS < 50) fixes.push({ label: 'Sharpen',       type: 'sharp',    sev: 1 });
    if (toneS  < 55) fixes.push({ label: 'Balance tones', type: 'tones',    sev: 1 });
    box.innerHTML = fixes.length
      ? fixes.map(f => `<button class="qfix-btn sev${f.sev}" data-type="${f.type}">${f.label}</button>`).join('')
      : `<span class="qfix-ok">✓ Well balanced</span>`;
    box.querySelectorAll('.qfix-btn').forEach(b => b.onclick = () => applyQuickFix(b.dataset.type, s));
  }

  function applyQuickFix(type, s) {
    const e = getCurrentEntry(); if (!e) return;
    pushHistory();
    const k = s || e.stats;
    const auto = Analysis.autoParams(k, 'professional');
    if (type === 'exposure') {
      Object.assign(e.params, { exposure: auto.exposure, shadows: auto.shadows,
        highlights: auto.highlights, blacks: auto.blacks, whites: auto.whites });
    } else if (type === 'color') {
      Object.assign(e.params, { temperature: auto.temperature, tint: auto.tint,
        vibrance: auto.vibrance, saturation: auto.saturation });
    } else if (type === 'sharp') {
      e.params.clarity   = Imaging.clamp((e.params.clarity   || 0) + 20, 0, 100);
      e.params.sharpness = Imaging.clamp((e.params.sharpness || 0) + 25, 0, 100);
    } else if (type === 'tones') {
      Object.assign(e.params, { contrast: auto.contrast, blacks: auto.blacks, whites: auto.whites });
    }
    e.edited = true;
    syncSliders(); scheduleRender(); markEdited(); renderExplanation(e); commitEdit();
    toast('Quick fix applied');
  }

  function setScore(valEl, barEl, score) {
    valEl.innerHTML = score + '<small>/100</small>';
    barEl.style.width = score + '%';
    barEl.style.background = score >= 75 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
  }
  function populateAnalysis(s) {
    setScore($('#expScore'),   $('#expBar'),   Analysis.exposureScore(s));
    setScore($('#harmScore'),  $('#harmBar'),  Analysis.colorHarmonyScore(s));
    if (Analysis.sharpnessScore && $('#sharpScore'))
      setScore($('#sharpScore'), $('#sharpBar'), Analysis.sharpnessScore(s));
    if (Analysis.tonalBalance && $('#toneScore'))
      setScore($('#toneScore'),  $('#toneBar'),  Analysis.tonalBalance(s));
    _buildQuickFix(s);
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
      `<i style="width:${(c.weight / total * 100).toFixed(1)}%;background:rgb(${c.r},${c.g},${c.b})" title="rgb(${c.r},${c.g},${c.b})"></i>`).join('');
    // wire score-card direct controls
    wireScoreCtrl('#expCtrl',   'exposure',  0);
    wireScoreCtrl('#harmCtrl',  'vibrance',  0);
    wireScoreCtrl('#sharpCtrl', 'sharpness', 0);
    wireScoreCtrl('#toneCtrl',  'contrast',  0);
    buildTonalProfiles(s);
  }

  /* ---- Score-card direct controls ---------------------------------------*/
  function wireScoreCtrl(inputId, paramKey, defVal) {
    const inp = $(inputId); if (!inp) return;
    if (current < 0) { inp.value = defVal; return; }
    const e = library[current];
    inp.value = e.params[paramKey] != null ? e.params[paramKey] : defVal;
    inp.oninput = () => {
      if (current < 0) return;
      const ent = library[current];
      ent.params[paramKey] = +inp.value;
      // also drive the matching Adjust-panel slider so both stay in sync
      const mirror = els.sliders.querySelector(`.slider[data-key="${paramKey}"] input`);
      if (mirror) { mirror.value = inp.value; mirror.dispatchEvent(new Event('input')); }
      else scheduleRender();
    };
    inp.onchange = () => { markEdited(); clearPreset(); commitEdit(); };
  }

  function syncScoreCardCtrls() {
    if (current < 0) return;
    const e = library[current];
    const map = { '#expCtrl':'exposure','#harmCtrl':'vibrance','#sharpCtrl':'sharpness','#toneCtrl':'contrast' };
    for (const [id, key] of Object.entries(map)) {
      const inp = $(id); if (inp) inp.value = e.params[key] != null ? e.params[key] : 0;
    }
  }

  /* ---- Tonal profile cards ----------------------------------------------*/
  function buildTonalProfiles(s) {
    const box = $('#tonalProfiles');
    if (!box || !window.Analysis || !Analysis.tonalProfiles) return;
    const profiles = Analysis.tonalProfiles(s);
    box.innerHTML = profiles.map(p =>
      `<div class="tp-card" data-pid="${p.id}">
         <canvas class="tp-canvas" id="tpc_${p.id}" width="60" height="42"></canvas>
         <div class="tp-info">
           <div class="tp-name">${p.name}</div>
           <div class="tp-tags">${p.tags.map(t => `<span>${t}</span>`).join('')}</div>
           <div class="tp-desc">${p.description}</div>
         </div>
         <button class="tp-apply">Apply</button>
       </div>`).join('');
    profiles.forEach(prof => {
      const c = document.getElementById(`tpc_${prof.id}`);
      if (c) drawProfileCurve(c.getContext('2d'), prof.id, 60, 42);
    });
    box.querySelectorAll('.tp-card').forEach(card => {
      const prof = profiles.find(p => p.id === card.dataset.pid);
      if (!prof) return;
      card.querySelector('.tp-apply').onclick = () => {
        if (current < 0) return;
        const e = library[current];
        pushHistory();
        Object.assign(e.params, prof.params);
        e.edited = true; e.preset = null;
        syncSliders(); scheduleRender(); markEdited(); commitEdit();
        toast(`Profile: ${prof.name}`);
        box.querySelectorAll('.tp-card').forEach(c2 => c2.classList.remove('tp-active'));
        card.classList.add('tp-active');
      };
    });
  }

  function drawProfileCurve(ctx, id, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'oklch(0.17 0.005 270)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, 0); ctx.stroke();
    ctx.setLineDash([]);
    const curves = {
      sCurve:   [[0,h],[w*.18,h*.82],[w*.5,h*.5],[w*.82,h*.18],[w,0]],
      filmLift: [[0,h*.86],[w*.25,h*.62],[w*.55,h*.40],[w*.82,h*.18],[w,h*.06]],
      airy:     [[0,h*.90],[w*.28,h*.54],[w*.6,h*.26],[w*.85,h*.10],[w,0]],
      moody:    [[0,h],[w*.18,h*.86],[w*.5,h*.50],[w*.82,h*.12],[w,0]]
    };
    const colors = { sCurve:'#8B9FE8', filmLift:'#C4A96E', airy:'#E8D8B8', moody:'#8090A0' };
    const pts = curves[id] || curves.sCurve;
    ctx.strokeStyle = colors[id] || '#8B9FE8'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const cpx = (pts[i][0] + pts[i+1][0]) / 2;
      const cpy = (pts[i][1] + pts[i+1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], cpx, cpy);
    }
    ctx.lineTo(pts[pts.length-1][0], pts[pts.length-1][1]); ctx.stroke();
  }

  /* ---- Color Mix: highlight detected hue sliders ------------------------*/
  function highlightColorMixSliders(s) {
    if (!s || !s.dominant) return;
    els.sliders.querySelectorAll('.slider[data-key]').forEach(w => w.classList.remove('color-detected'));
    const hueKeys = [
      { key: 'redSat',    peaks: [0, 360], w: 28 },
      { key: 'orangeSat', peaks: [30],     w: 26 },
      { key: 'yellowSat', peaks: [60],     w: 28 },
      { key: 'greenSat',  peaks: [120],    w: 38 },
      { key: 'cyanSat',   peaks: [180],    w: 30 },
      { key: 'blueSat',   peaks: [240],    w: 38 },
      { key: 'purpleSat', peaks: [300],    w: 30 }
    ];
    s.dominant.forEach(c => {
      const r = c.r/255, g = c.g/255, b = c.b/255;
      const mx = Math.max(r,g,b), mn = Math.min(r,g,b), d = mx - mn;
      if (d < 0.10 || c.weight < 0.04) return;
      let hue;
      if (mx===r) hue = ((g-b)/d*60+360)%360;
      else if (mx===g) hue = (b-r)/d*60+120;
      else hue = (r-g)/d*60+240;
      const hd = (pk) => { const x = ((hue-pk+540)%360); return x>180?360-x:x; };
      let best = null, bestDist = 999;
      hueKeys.forEach(hk => {
        const dist = Math.min(...hk.peaks.map(pk => hd(pk)));
        if (dist < bestDist) { bestDist = dist; best = hk.key; }
      });
      if (best && bestDist < 45) {
        const w = els.sliders.querySelector(`.slider[data-key="${best}"]`);
        if (w) w.classList.add('color-detected');
      }
    });
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
    const [min, max] = SLIDER_RANGE[key] || [-100, 100];
    const defVal = SLIDER_INIT[key] != null ? SLIDER_INIT[key] : 0;
    const wrap = document.createElement('div');
    wrap.className = 'slider'; wrap.dataset.key = key;
    wrap.innerHTML =
      `<div class="row"><span class="name">${LABELS[key]}</span><span class="num">${defVal}</span></div>
       <input type="range" min="${min}" max="${max}" step="1" value="${defVal}">`;
    const input = wrap.querySelector('input'), num = wrap.querySelector('.num');
    const set = (v, commit) => {
      v = Math.round(v);
      e.params[key] = v; input.value = v;
      num.textContent = defVal === 0 ? ((v > 0 ? '+' : '') + v) : v;
      wrap.classList.toggle('changed', v !== defVal);
      if (commit) commitEdit();
      scheduleRender();
    };
    input.addEventListener('input', () => set(+input.value, false));
    input.addEventListener('change', () => { markEdited(); clearPreset(); commitEdit(); });
    wrap.querySelector('.row').addEventListener('dblclick', () => { pushHistory(); set(defVal, true); markEdited(); clearPreset(); });
    // Init from current params — fallback to default if param is new on this entry
    set(e.params[key] != null ? e.params[key] : defVal, false);
    wrap._set = set;
    return wrap;
  }
  function syncSliders() {
    if (current < 0) return;
    const e = library[current];
    els.sliders.querySelectorAll('.slider').forEach(w => {
      const k = w.dataset.key;
      const defV = SLIDER_INIT[k] != null ? SLIDER_INIT[k] : 0;
      w._set(e.params[k] != null ? e.params[k] : defV, false);
    });
  }

  /* ---- Edits / history --------------------------------------------------*/
  function isCropped(e) {
    const c = e.crop || {};
    return (c.x || 0) > 0.001 || (c.y || 0) > 0.001 || (c.w == null ? 1 : c.w) < 0.999 ||
      (c.h == null ? 1 : c.h) < 0.999 || Math.abs(c.angle || 0) > 0.01;
  }
  function computeEdited(e) {
    // Compare each param against its default (not against 0) so params like
    // maskR=45 don't falsely mark a photo as edited.
    return Object.keys(Imaging.DEFAULTS).some(k => {
      const def = Imaging.DEFAULTS[k];
      return (e.params[k] != null ? e.params[k] : def) !== def;
    }) || isCropped(e);
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
    const newP = Analysis.autoParamsForScene
      ? Analysis.autoParamsForScene(entry.stats, entry.strength, entry.stats && entry.stats.scene)
      : Analysis.autoParams(entry.stats, entry.strength);
    if (stackMode) {
      // Stack: accumulate — add new corrections as a delta on top of current params
      for (const k in newP) {
        const def = Imaging.DEFAULTS[k] != null ? Imaging.DEFAULTS[k] : 0;
        const delta = (newP[k] || 0) - def;
        if (Math.abs(delta) > 1)
          entry.params[k] = Math.round(Imaging.clamp(
            (entry.params[k] != null ? entry.params[k] : def) + delta * 0.55,
            k === 'bw' ? 0 : -100, 100
          ));
      }
    } else {
      entry.params = newP;
    }
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
    $('#autoBtn').onclick = () => (window.Panels && Panels.onAutoClick) ? Panels.onAutoClick() : runAuto();
    $('#batchBtn').onclick = runBatch;
    $('#exportBtn').onclick = () => { const e = getCurrentEntry(); if (e && window.Export) Export.open([e]); };
    $('#resetBtn').onclick = reset;
    $('#undoBtn').onclick = undo;
    $('#strengthSeg').querySelectorAll('button').forEach(b => b.onclick = () => {
      strength = b.dataset.k; syncStrengthSeg();
      if (current >= 0) library[current].strength = strength;
      if (window.Store) Store.saveSetting('strength', strength).catch(console.error);
    });
    // Stack mode toggle
    const stackToggle = document.getElementById('stackToggle');
    if (stackToggle) stackToggle.onclick = () => {
      stackMode = !stackMode;
      stackToggle.classList.toggle('on', stackMode);
      toast(stackMode ? 'Stack on — auto-enhance adds to current edit' : 'Stack off — auto-enhance replaces params');
    };
    // Power Enhance button
    const powerBtn = document.getElementById('powerBtn');
    if (powerBtn) powerBtn.onclick = () => {
      if (current < 0) return;
      const e = library[current]; e.strength = strength;
      powerBtn.classList.add('busy'); progress(0.2);
      setTimeout(() => {
        pushHistoryFor(e);
        e.params = Analysis.powerParams
          ? Analysis.powerParams(e.stats, e.strength, e.stats && e.stats.scene)
          : Analysis.autoParams(e.stats, 'dramatic');
        e.edited = true; e.preset = null;
        syncSliders(); render(); renderExplanation(e);
        if (window.Panels) Panels.onParamsChanged(e);
        renderFilm(); updateChrome(); powerBtn.classList.remove('busy'); progress(1);
        toast('⚡ Power enhanced');
      }, 120);
    };
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
    // Preset mode toggle (Replace / Layer) — now in auto-block, wired here
    const modeReplace = document.getElementById('modeReplace');
    const modeLayer   = document.getElementById('modeLayer');
    if (modeReplace && modeLayer) {
      modeReplace.onclick = () => {
        if (window.Panels) Panels.setLayerMode(false);
        modeReplace.classList.add('on'); modeLayer.classList.remove('on');
        toast('Replace mode — preset replaces current edits');
      };
      modeLayer.onclick = () => {
        if (window.Panels) Panels.setLayerMode(true);
        modeLayer.classList.add('on'); modeReplace.classList.remove('on');
        toast('Layer mode — preset stacks on top of current edits');
      };
    }

    initCompareDrag();

    // Touch: pinch-to-zoom on the canvas (two-finger spread/pinch)
    let pinchDist0 = 0, pinchScaleApplied = 1, pinchScaleCur = 1;
    els.wrap.addEventListener('touchstart', ev => {
      if (ev.touches.length === 2) {
        ev.preventDefault();
        pinchDist0 = Math.hypot(
          ev.touches[0].clientX - ev.touches[1].clientX,
          ev.touches[0].clientY - ev.touches[1].clientY
        );
      }
    }, { passive: false });
    els.wrap.addEventListener('touchmove', ev => {
      if (ev.touches.length === 2) {
        ev.preventDefault();
        const d = Math.hypot(
          ev.touches[0].clientX - ev.touches[1].clientX,
          ev.touches[0].clientY - ev.touches[1].clientY
        );
        pinchScaleCur = Imaging.clamp(pinchScaleApplied * (d / pinchDist0), 0.5, 5);
        els.wrap.style.transform = `scale(${pinchScaleCur.toFixed(3)})`;
      }
    }, { passive: false });
    els.wrap.addEventListener('touchend', ev => {
      if (ev.touches.length < 2) {
        pinchScaleApplied = pinchScaleCur;
        if (Math.abs(pinchScaleCur - 1) < 0.14) {
          els.wrap.style.transform = ''; pinchScaleApplied = 1; pinchScaleCur = 1;
        }
      }
    });
    // Double-tap canvas to toggle before / after (mobile compare shortcut)
    let lastTap = 0;
    els.wrap.addEventListener('touchend', ev => {
      if (ev.touches.length > 0) return;
      const now = Date.now();
      if (now - lastTap < 300 && current >= 0) {
        els.wrap.classList.toggle('show-original');
        ev.preventDefault();
      }
      lastTap = now;
    });

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
    runAuto,
    toast, get strength() { return strength; },
    commitCrop, enterCrop, buildWorkingSource, processInto: (data, params, out) => Imaging.process(data, params, out),
    scheduleRender, commitEdit, markEdited, pushHistory, syncSliders, clearPreset,
    batch: { preset: batchPreset, auto: batchAuto, crop: batchCrop, exportList: (list) => window.Export && Export.open(list) }
  };

  async function boot() {
    setupWorker();
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
