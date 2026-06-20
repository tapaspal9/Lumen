/* ============================================================================
 * Lumen — Web Export + Pre-flight Safety Checks
 * Format (JPEG/WebP), quality, resize presets, live size estimate, quality
 * checks, optional EXIF retention / GPS removal, and zipped batch export.
 * ==========================================================================*/
(function (global) {
  'use strict';
  const $ = s => document.querySelector(s);

  const RESIZE = [
    { id: 'original', label: 'Original resolution', sub: 'up to 4096px', cap: 4096 },
    { id: 'fullscreen', label: 'Full-screen travel photo', sub: '2560px longest edge', cap: 2560 },
    { id: 'website', label: 'Website optimized', sub: '2048px longest edge', cap: 2048 },
    { id: 'blog', label: 'Blog thumbnail', sub: '600px longest edge', cap: 600 }
  ];
  let entries = [], opts = { format: 'jpeg', quality: 85, resize: 'website', keepExif: true, removeGps: true };
  let estT = null;

  function open(list) {
    entries = list.filter(Boolean);
    if (!entries.length) return;
    render();
    $('#xport').classList.add('show');
    estimate(); checks();
  }
  function close() { $('#xport').classList.remove('show'); }
  const mime = () => opts.format === 'webp' ? 'image/webp' : 'image/jpeg';
  const fmtBytes = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(2) + ' MB';

  function render() {
    const multi = entries.length > 1;
    $('#xport').innerHTML = `
      <div class="xp-backdrop" id="xpBack"></div>
      <div class="xp-card">
        <div class="xp-head">
          <div><h3>Export ${multi ? entries.length + ' photos' : 'for web'}</h3>
          <p>${multi ? 'Bundled as a ZIP · ' : ''}originals are always preserved</p></div>
          <button class="xp-x" id="xpClose">✕</button>
        </div>
        <div class="xp-body">
          <div class="xp-col">
            <div class="xp-label">Format</div>
            <div class="seg xp-seg" id="xpFormat">
              <button data-v="jpeg" class="${opts.format === 'jpeg' ? 'on' : ''}">JPEG</button>
              <button data-v="webp" class="${opts.format === 'webp' ? 'on' : ''}">WebP</button>
            </div>
            <div class="xp-label">Quality <span id="xpQv">${opts.quality}</span></div>
            <input type="range" id="xpQuality" class="xp-range" min="40" max="100" step="1" value="${opts.quality}">
            <div class="xp-label">Resize</div>
            <div class="xp-resize" id="xpResize">
              ${RESIZE.map(r => `<button data-v="${r.id}" class="${opts.resize === r.id ? 'on' : ''}"><b>${r.label}</b><span>${r.sub}</span></button>`).join('')}
            </div>
            <div class="xp-label">Metadata</div>
            <label class="xp-toggle"><span>Keep EXIF (camera info)</span><span class="switch"><input type="checkbox" id="xpExif" ${opts.keepExif ? 'checked' : ''}><span class="track"></span></span></label>
            <label class="xp-toggle"><span>Remove GPS location <em>(privacy)</em></span><span class="switch"><input type="checkbox" id="xpGps" ${opts.removeGps ? 'checked' : ''}><span class="track"></span></span></label>
          </div>
          <div class="xp-col">
            <div class="xp-label">Estimated output</div>
            <div class="xp-estimate" id="xpEstimate"><div class="xp-est-size">…</div><div class="xp-est-dim"></div></div>
            <div class="xp-label">Pre-flight quality checks</div>
            <div class="xp-checks" id="xpChecks"></div>
          </div>
        </div>
        <div class="xp-foot">
          <button class="tbtn" id="xpCancel">Cancel</button>
          <button class="tbtn primary" id="xpGo">${multi ? 'Export all (ZIP)' : 'Export'}</button>
        </div>
      </div>`;

    $('#xpBack').onclick = $('#xpClose').onclick = $('#xpCancel').onclick = close;
    $('#xpFormat').querySelectorAll('button').forEach(b => b.onclick = () => { opts.format = b.dataset.v; syncSeg('#xpFormat', b); if (opts.format === 'webp') { /* webp can't carry exif here */ } estimate(); });
    $('#xpResize').querySelectorAll('button').forEach(b => b.onclick = () => { opts.resize = b.dataset.v; syncSeg('#xpResize', b); estimate(); checks(); });
    const q = $('#xpQuality'); q.oninput = () => { opts.quality = +q.value; $('#xpQv').textContent = q.value; estimate(); };
    $('#xpExif').onchange = e => opts.keepExif = e.target.checked;
    $('#xpGps').onchange = e => opts.removeGps = e.target.checked;
    $('#xpGo').onclick = run;
  }
  function syncSeg(sel, btn) { $(sel).querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn)); }
  function capFor() { return (RESIZE.find(r => r.id === opts.resize) || RESIZE[2]).cap; }

  async function encode(entry, cap) {
    const ws = Lumen.buildWorkingSource(entry, cap);
    const out = new ImageData(ws.w, ws.h);
    Lumen.processInto(ws.data, entry.params, out);
    const c = document.createElement('canvas'); c.width = ws.w; c.height = ws.h;
    c.getContext('2d').putImageData(out, 0, 0);
    let blob = await new Promise(r => c.toBlob(r, mime(), opts.quality / 100));
    if (opts.format === 'jpeg' && opts.keepExif && entry.exifApp1) {
      let app1 = entry.exifApp1;
      if (opts.removeGps && entry.exifGpsOff >= 0) app1 = Exif.stripGPS(entry.exifApp1, entry.exifGpsOff);
      blob = await Exif.inject(blob, app1);
    }
    return { blob, w: ws.w, h: ws.h, out };
  }

  function estimate() {
    clearTimeout(estT);
    const el = $('#xpEstimate'); if (!el) return;
    el.querySelector('.xp-est-size').textContent = '…';
    estT = setTimeout(async () => {
      const r = await encode(entries[0], capFor());
      const each = r.blob.size;
      const total = each * entries.length;
      el.querySelector('.xp-est-size').textContent = entries.length > 1
        ? `≈ ${fmtBytes(total)} total` : fmtBytes(each);
      el.querySelector('.xp-est-dim').textContent = `${r.w} × ${r.h}px · ${opts.format.toUpperCase()} q${opts.quality}` + (entries.length > 1 ? ` · ${entries.length} photos` : '');
    }, 240);
  }

  /* ---- Pre-flight quality checks on the FINAL processed image ------------*/
  async function checks() {
    const box = $('#xpChecks'); if (!box) return;
    box.innerHTML = '<div class="xp-checking">Analysing output…</div>';
    const r = await encode(entries[0], capFor());
    const a = Imaging.analyze(r.out);
    const cast = Analysis.colorCast(a);
    const items = [
      ['Highlights', a.highClip <= 0.06, a.highClip > 0.06 ? `${Math.round(a.highClip * 100)}% blown — pull highlights` : 'No clipping'],
      ['Shadows', a.shadowClip <= 0.08, a.shadowClip > 0.08 ? `${Math.round(a.shadowClip * 100)}% crushed — lift shadows` : 'Detail retained'],
      ['Saturation', a.sat <= 0.6, a.sat > 0.6 ? `Very high (${Math.round(a.sat * 100)}%) — may look unnatural` : 'Natural'],
      ['White balance', cast.magnitude <= 20, cast.magnitude <= 20 ? 'Neutral' : `${cast.label || 'Color cast'} — correct before publishing`],
      ['Resolution', Math.max(r.w, r.h) >= 1200 || opts.resize === 'blog', Math.max(r.w, r.h) < 1200 ? `${Math.max(r.w, r.h)}px — small for full-screen` : `${r.w}×${r.h} OK`],
      ['Sharpness', a.edgeEnergy >= 7, a.edgeEnergy < 7 ? 'Looks soft — check focus / add sharpening' : 'Crisp']
    ];
    box.innerHTML = items.map(([k, ok, msg]) =>
      `<div class="xp-check ${ok ? 'ok' : 'warn'}"><span class="xp-ci">${ok ? '✓' : '!'}</span><span class="xp-ck">${k}</span><span class="xp-cm">${msg}</span></div>`).join('');
  }

  /* ---- Run export -------------------------------------------------------*/
  async function run() {
    const go = $('#xpGo'); go.disabled = true; go.textContent = 'Exporting…';
    const cap = capFor();
    const ext = opts.format === 'webp' ? '.webp' : '.jpg';
    try {
      if (entries.length === 1) {
        const r = await encode(entries[0], cap);
        download(r.blob, base(entries[0].name) + '-lumen' + ext);
      } else {
        const files = [];
        for (const e of entries) { const r = await encode(e, cap); files.push({ name: base(e.name) + '-lumen' + ext, data: new Uint8Array(await r.blob.arrayBuffer()) }); }
        const zip = makeZip(files);
        download(zip, `lumen-export-${entries.length}-photos.zip`);
      }
      Lumen.toast(`Exported ${entries.length} photo${entries.length > 1 ? 's' : ''} · original${entries.length > 1 ? 's' : ''} preserved`);
      close();
    } catch (e) { Lumen.toast('Export failed — try JPEG or a smaller size'); }
    go.disabled = false;
  }
  const base = n => n.replace(/\.[^.]+$/, '');
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---- Minimal store-only ZIP (CRC32) -----------------------------------*/
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(files) {
    const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
    const u16 = v => [v & 255, (v >> 8) & 255]; const u32 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255];
    files.forEach(f => {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data);
      const local = [0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      parts.push(new Uint8Array(local), name, data);
      central.push([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]);
      central.push(name);
      offset += local.length + name.length + data.length;
    });
    let cenSize = 0; const cenArrs = central.map(c => { const a = c instanceof Uint8Array ? c : new Uint8Array(c); cenSize += a.length; return a; });
    const cenStart = offset;
    const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cenSize), ...u32(cenStart), ...u16(0)]);
    return new Blob([...parts, ...cenArrs, end], { type: 'application/zip' });
  }

  global.Export = { open };
})(window);
