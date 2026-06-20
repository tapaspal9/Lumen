/* ============================================================================
 * Lumen — Photo Dashboard / Gallery + Batch editing
 * ==========================================================================*/
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const selected = new Set();   // entry ids

  function statusOf(e) {
    if (e.preset) return { cls: 'preset', text: (Presets.byId(e.preset.id) || {}).name || 'Preset' };
    if (e.edited) return { cls: 'edited', text: 'Edited' };
    return { cls: 'raw', text: 'Unedited' };
  }
  function selectedEntries() { return Lumen.library.filter(e => selected.has(e.id)); }

  function refresh() {
    const lib = Lumen.library;
    // prune stale selections
    [...selected].forEach(id => { if (!lib.some(e => e.id === id)) selected.delete(id); });
    $('#dashCount').textContent = `${lib.length} photo${lib.length !== 1 ? 's' : ''}`;
    const edited = lib.filter(e => e.edited).length;
    $('#dashSub').textContent = lib.length ? `${edited} edited · ${lib.length - edited} to do` : 'Your library is empty';

    const grid = $('#dashGrid');
    grid.innerHTML = lib.map((e, i) => {
      const st = statusOf(e);
      const sel = selected.has(e.id);
      const cam = e.exif && e.exif.Model ? `${e.exif.Model}` : '';
      return `<div class="gcard ${sel ? 'sel' : ''}" data-i="${i}" data-id="${e.id}">
        <div class="gthumb">
          <img src="${e.url}" alt="">
          <span class="gstatus ${st.cls}">${st.text}</span>
          <button class="gcheck ${sel ? 'on' : ''}" data-id="${e.id}" title="Select">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </button>
        </div>
        <div class="gmeta">
          <div class="gname" title="${e.name}">${e.name}</div>
          ${cam ? `<div class="gcam">${cam}${e.exif.ISO ? ' · ISO ' + e.exif.ISO : ''}</div>` : ''}
          <div class="gactions">
            <button class="gbtn edit" data-i="${i}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              Edit
            </button>
            <button class="gbtn del" data-i="${i}" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          </div>
        </div>
      </div>`;
    }).join('') +
      `<button class="gcard gadd" id="gAdd"><span class="gadd-plus">+</span><span>Import photos</span></button>`;

    grid.querySelectorAll('.edit').forEach(b => b.onclick = ev => { ev.stopPropagation(); Lumen.selectImage(+b.dataset.i); });
    grid.querySelectorAll('.del').forEach(b => b.onclick = ev => { ev.stopPropagation(); Lumen.requestDelete(+b.dataset.i); });
    grid.querySelectorAll('.gcheck').forEach(b => b.onclick = ev => { ev.stopPropagation(); toggle(b.dataset.id); });
    grid.querySelectorAll('.gcard[data-i]').forEach(c =>
      c.querySelector('.gthumb').onclick = () => Lumen.selectImage(+c.dataset.i));
    const add = $('#gAdd'); if (add) add.onclick = () => Lumen.openImport();
    renderBatchBar();
  }

  function toggle(id) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    refresh();
  }

  function renderBatchBar() {
    const bar = $('#batchBar');
    const n = selected.size;
    bar.classList.toggle('show', n > 0);
    if (!n) { bar.innerHTML = ''; return; }
    bar.innerHTML = `
      <span class="bb-count">${n} selected</span>
      <div class="bb-actions">
        <button class="bb-btn" id="bbAuto">Auto-correct all</button>
        <select class="bb-sel" id="bbPreset"><option value="">Apply preset…</option>${Presets.LIST.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select>
        <select class="bb-sel" id="bbCrop"><option value="">Crop ratio…</option><option value="0">Original</option><option value="1.7778">16:9</option><option value="1.3333">4:3</option><option value="1.5">3:2</option><option value="1">1:1</option></select>
        <button class="bb-btn primary" id="bbExport">Export all</button>
        <button class="bb-btn ghost" id="bbClear">Clear</button>
      </div>`;
    $('#bbAuto').onclick = () => { Lumen.batch.auto(selectedEntries()); Lumen.toast(`Auto-corrected ${n} photos`); };
    $('#bbPreset').onchange = e => { if (e.target.value) { Lumen.batch.preset(selectedEntries(), e.target.value, 0.8); Lumen.toast(`Preset applied to ${n} photos`); e.target.value = ''; } };
    $('#bbCrop').onchange = e => { if (e.target.value !== '') { Lumen.batch.crop(selectedEntries(), parseFloat(e.target.value)); Lumen.toast(`Crop applied to ${n} photos`); e.target.value = ''; } };
    $('#bbExport').onclick = () => Lumen.batch.exportList(selectedEntries());
    $('#bbClear').onclick = () => { selected.clear(); refresh(); };
  }

  window.Dashboard = {
    init() {
      $('#dashImport').onclick = () => Lumen.openImport();
      $('#dashBack').onclick = () => Lumen.switchView('editor');
      refresh();
    },
    refresh
  };
})();
