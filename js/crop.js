/* ============================================================================
 * Lumen — Crop & Composition Assistant (non-destructive)
 * Interactive crop frame over a straightened preview of the ORIGINAL image.
 * Commits only a transform (entry.crop) — the original is never modified.
 * ==========================================================================*/
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  let E = null, disp = { w: 0, h: 0 }, crop = { x: 0, y: 0, w: 1, h: 1 };
  let angle = 0, ratio = 'orig', imageA = 1, cropAn = null, drag = null;

  const ov = $('#cropOverlay'), stage = $('#cropStage'), cv = $('#cropCanvas'), frame = $('#cropFrame');
  const cctx = cv.getContext('2d', { willReadFrequently: true });

  function ratioNum() { return ratio === 'orig' ? imageA : (ratio === 'free' ? null : parseFloat(ratio)); }

  function open(entry) {
    E = entry;
    imageA = (entry.img.naturalWidth || entry.img.width) / (entry.img.naturalHeight || entry.img.height);
    const c = entry.crop || {};
    angle = c.angle || 0;
    crop = { x: c.x || 0, y: c.y || 0, w: c.w == null ? 1 : c.w, h: c.h == null ? 1 : c.h };
    ratio = 'orig'; setRatioButtons();
    $('#cropAngle').value = angle; $('#cropAngleVal').textContent = fmtAngle(angle);
    ov.classList.add('show');
    void ov.offsetHeight;                 // force reflow so flex sizes resolve
    layout(); renderCanvas(); placeFrame(); analyzeSource();
    requestAnimationFrame(() => { layout(); renderCanvas(); placeFrame(); });
  }
  function close() { ov.classList.remove('show'); E = null; }
  const fmtAngle = a => (a > 0 ? '+' : '') + (Math.round(a * 10) / 10) + '°';

  function layout() {
    const area = $('#cropArea').getBoundingClientRect();
    let availW = area.width - 96, availH = area.height - 48;
    if (availW < 60 || availH < 60) { availW = window.innerWidth - 120; availH = window.innerHeight - 210; }
    let bw = availW, bh = bw / imageA;
    if (bh > availH) { bh = availH; bw = bh * imageA; }
    disp = { w: Math.max(60, Math.round(bw)), h: Math.max(40, Math.round(bh)) };
    stage.style.width = disp.w + 'px'; stage.style.height = disp.h + 'px';
  }
  function renderCanvas() {
    const sc = Imaging.straightenedCanvas(E.img, angle, disp.w, disp.h);
    cv.width = disp.w; cv.height = disp.h;
    cv.style.width = disp.w + 'px'; cv.style.height = disp.h + 'px';
    cctx.clearRect(0, 0, disp.w, disp.h);
    cctx.drawImage(sc, 0, 0);
  }
  function analyzeSource() {
    try { cropAn = Imaging.analyze(cctx.getImageData(0, 0, cv.width, cv.height)); } catch (e) { cropAn = null; }
  }
  function placeFrame() {
    frame.style.left = (crop.x * disp.w) + 'px';
    frame.style.top = (crop.y * disp.h) + 'px';
    frame.style.width = (crop.w * disp.w) + 'px';
    frame.style.height = (crop.h * disp.h) + 'px';
  }
  function setRatioButtons() {
    $('#cropRatios').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.r === ratio));
  }

  /* ---- Aspect ratio -----------------------------------------------------*/
  function applyRatio(r) {
    ratio = r; setRatioButtons();
    if (r === 'free') return;
    const rN = ratioNum() / imageA;          // normalized w/h in box space
    let w = 1, h = 1;
    if (rN >= 1) { w = 1; h = 1 / rN; } else { h = 1; w = rN; }
    const s = 0.92; w *= s; h *= s;
    crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    placeFrame();
  }

  /* ---- Drag / resize ----------------------------------------------------*/
  const HANDLES = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
  function start(ev) {
    const cls = [...ev.target.classList];
    const handle = ev.target.classList.contains('ch') ? cls.find(c => HANDLES.includes(c)) : null;
    const onFrame = ev.target === frame || ev.target.classList.contains('crop-grid');
    if (!handle && !onFrame) return;
    ev.preventDefault();
    drag = { mode: handle || 'move', sx: ev.clientX, sy: ev.clientY, c0: { ...crop } };
    stage.setPointerCapture(ev.pointerId);
  }
  function move(ev) {
    if (!drag) return;
    const dx = (ev.clientX - drag.sx) / disp.w, dy = (ev.clientY - drag.sy) / disp.h;
    if (drag.mode === 'move') {
      crop.x = clamp(drag.c0.x + dx, 0, 1 - crop.w);
      crop.y = clamp(drag.c0.y + dy, 0, 1 - crop.h);
    } else {
      resize(drag.mode, dx, dy);
    }
    placeFrame();
  }
  function end() { if (drag) { drag = null; } }
  function resize(mode, dx, dy) {
    const rN = ratioNum() ? ratioNum() / imageA : null;
    let { x, y, w, h } = drag.c0;
    if (mode.includes('e')) w = drag.c0.w + dx;
    if (mode.includes('w')) { w = drag.c0.w - dx; x = drag.c0.x + dx; }
    if (mode.includes('s')) h = drag.c0.h + dy;
    if (mode.includes('n')) { h = drag.c0.h - dy; y = drag.c0.y + dy; }
    if (rN) {
      if (mode === 'e' || mode === 'w') { h = w / rN; y = drag.c0.y + drag.c0.h / 2 - h / 2; }
      else if (mode === 'n' || mode === 's') { w = h * rN; x = drag.c0.x + drag.c0.w / 2 - w / 2; }
      else { h = w / rN; if (mode.includes('n')) y = drag.c0.y + drag.c0.h - h; if (mode.includes('w')) x = drag.c0.x + drag.c0.w - w; }
    }
    w = clamp(w, 0.08, 1); h = clamp(h, 0.08, 1);
    x = clamp(x, 0, 1 - w); y = clamp(y, 0, 1 - h);
    crop = { x, y, w, h };
  }

  /* ---- Auto-crop / straighten / reset / preview -------------------------*/
  function auto() {
    if (!cropAn) analyzeSource();
    if (!cropAn) return;
    const aspectVal = (ratio === 'orig' || ratio === 'free') ? 0 : parseFloat(ratio);
    const c = Analysis.suggestCrop(cropAn, aspectVal, imageA);
    crop = { x: c.x, y: c.y, w: c.w, h: c.h };
    placeFrame();
    Lumen.toast('Composition analysed — crop suggested');
  }
  function setAngle(v) {
    angle = v; $('#cropAngleVal').textContent = fmtAngle(angle);
    renderCanvas(); placeFrame();
  }
  function reset() {
    angle = 0; $('#cropAngle').value = 0; $('#cropAngleVal').textContent = '0°';
    crop = { x: 0, y: 0, w: 1, h: 1 }; ratio = 'orig'; setRatioButtons();
    renderCanvas(); placeFrame(); analyzeSource();
  }
  function showPreview(on) {
    if (on && E) {
      const ws = Lumen.buildWorkingSource({ img: E.img, crop: { ...crop, angle } }, Math.max(disp.w, disp.h));
      const out = new ImageData(ws.w, ws.h);
      Lumen.processInto(ws.data, E.params, out);
      const oc = document.createElement('canvas'); oc.width = ws.w; oc.height = ws.h;
      oc.getContext('2d').putImageData(out, 0, 0);
      cv.width = disp.w; cv.height = disp.h;
      cctx.fillStyle = '#000'; cctx.fillRect(0, 0, disp.w, disp.h);
      const s = Math.min(disp.w / ws.w, disp.h / ws.h), dw = ws.w * s, dh = ws.h * s;
      cctx.drawImage(oc, (disp.w - dw) / 2, (disp.h - dh) / 2, dw, dh);
      stage.classList.add('previewing');
    } else {
      stage.classList.remove('previewing'); renderCanvas();
    }
  }

  /* ---- Bind -------------------------------------------------------------*/
  stage.addEventListener('pointerdown', start);
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', end);
  $('#cropRatios').querySelectorAll('button').forEach(b => b.onclick = () => applyRatio(b.dataset.r));
  $('#cropAuto').onclick = auto;
  $('#cropReset').onclick = reset;
  $('#cropCancel').onclick = close;
  $('#cropDone').onclick = () => { Lumen.commitCrop(E, { ...crop, angle }); close(); };
  $('#cropAngle').addEventListener('input', e => setAngle(+e.target.value));
  $('#cropAngle').addEventListener('change', analyzeSource);
  const pv = $('#cropPreview');
  pv.addEventListener('pointerdown', () => showPreview(true));
  window.addEventListener('pointerup', () => { if (stage.classList.contains('previewing')) showPreview(false); });
  pv.addEventListener('pointerleave', () => { if (stage.classList.contains('previewing')) showPreview(false); });
  window.addEventListener('keydown', ev => { if (ev.key === 'Escape' && ov.classList.contains('show')) close(); });
  window.addEventListener('resize', () => { if (ov.classList.contains('show')) { layout(); renderCanvas(); placeFrame(); } });

  window.Crop = { open };
})();
