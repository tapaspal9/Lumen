/* ============================================================================
 * Lumen — Rail Panels: Global Presets + AI Suggestions
 * ==========================================================================*/
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  let intensity = 0.8;     // shared preset intensity (0..1)
  let aiEnabled = true;
  const ICONS = {
    sun: '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="4"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" fill="currentColor"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.5 1-2 2-2h1a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16" cy="11" r="1"/>',
    crop: '<path d="M6 2v16h16M2 6h16v16"/>',
    wand: '<path d="M5 3v4M3 5h4M6 17v3M4.5 18.5h3M14 4l6 6L9 21l-6-6L14 4Z"/>',
    bw: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none"/>'
  };
  const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ICONS.wand}</svg>`;

  /* ---- Presets ----------------------------------------------------------*/
  function buildPresets() {
    const box = $('#presetsBody');
    box.innerHTML =
      '<div class="preset-grid">' +
      Presets.LIST.map(p =>
        `<button class="preset-card" data-id="${p.id}">
           <span class="preset-swatch">${p.swatch.map(c => `<i style="background:${c}"></i>`).join('')}</span>
           <span class="preset-name">${p.name}</span>
           <span class="preset-desc">${p.desc}</span>
         </button>`).join('') +
      '</div>' +
      `<div class="intensity">
         <div class="row"><span class="name">Intensity</span><span class="num" id="intVal">${Math.round(intensity * 100)}%</span></div>
         <input type="range" id="intRange" min="0" max="100" step="1" value="${Math.round(intensity * 100)}">
       </div>`;
    box.querySelectorAll('.preset-card').forEach(c =>
      c.onclick = () => applyPreset(c.dataset.id));
    const range = $('#intRange');
    range.oninput = () => {
      intensity = +range.value / 100; $('#intVal').textContent = range.value + '%';
      const e = Lumen.getCurrentEntry();
      if (e && e.preset) applyPreset(e.preset.id); // live re-apply active preset
    };
  }
  function applyPreset(id) {
    const e = Lumen.getCurrentEntry(); if (!e) return;
    const params = Presets.build(id, e.stats, intensity);
    Lumen.applyParamsTo(e, params, { preset: { id, intensity } });
    Lumen.toast(`${Presets.byId(id).name} · ${Math.round(intensity * 100)}%`);
  }
  function highlightPreset(e) {
    const id = e && e.preset ? e.preset.id : null;
    document.querySelectorAll('.preset-card').forEach(c => c.classList.toggle('on', c.dataset.id === id));
    if (e && e.preset) { intensity = e.preset.intensity; const r = $('#intRange'); if (r) { r.value = Math.round(intensity * 100); $('#intVal').textContent = r.value + '%'; } }
  }

  /* ---- Suggestions ------------------------------------------------------*/
  function buildSuggestHeader() {
    const head = $('#suggestHead');
    head.innerHTML =
      `<span>AI suggestions</span>
       <label class="switch"><input type="checkbox" id="aiToggle" ${aiEnabled ? 'checked' : ''}><span class="track"></span></label>`;
    $('#aiToggle').onchange = e => { aiEnabled = e.target.checked; renderSuggestions(Lumen.getCurrentEntry()); };
  }
  function renderSuggestions(entry) {
    const box = $('#suggestBody');
    if (!entry) { box.innerHTML = ''; return; }
    if (!aiEnabled) {
      box.innerHTML = `<div class="ai-off">AI recommendations are off. Toggle on to let Lumen analyze this photo and suggest edits — you stay in control of what gets applied.</div>`;
      return;
    }
    const list = Suggestions.build(entry.stats);
    const canAI = Suggestions.available();
    box.innerHTML =
      `<div class="ai-intro">Lumen inspected this frame and recommends ${list.length} adjustment${list.length !== 1 ? 's' : ''}. Apply only what you like.</div>` +
      list.map((s, i) =>
        `<div class="sug" data-i="${i}">
           <div class="sug-ic ${s.rec ? 'rec' : ''}">${icon(s.icon)}</div>
           <div class="sug-main">
             <div class="sug-top"><span class="sug-tag">${s.tag}</span>${s.rec ? '<span class="sug-rec">Recommended</span>' : s.advisory ? '<span class="sug-adv">Tip</span>' : ''}</div>
             <div class="sug-title">${s.title}</div>
             <div class="sug-detail">${s.detail}</div>
             <button class="sug-apply">${s.action.type === 'preset' ? 'Apply preset' : 'Apply suggestion'}</button>
           </div>
         </div>`).join('') +
      (canAI
        ? `<button class="ai-ask" id="aiAsk">${icon('wand')} Ask Lumen AI for an art-direction note</button><div class="ai-note" id="aiNote" style="display:none"></div>`
        : `<div class="ai-note-hint">Connect Lumen AI for natural-language art direction.</div>`);

    box.querySelectorAll('.sug').forEach(card => {
      const s = list[+card.dataset.i];
      card.querySelector('.sug-apply').onclick = () => {
        const e = Lumen.getCurrentEntry(); if (!e) return;
        if (s.action.type === 'preset') {
          intensity = s.action.intensity != null ? s.action.intensity : intensity;
          const params = Presets.build(s.action.presetId, e.stats, intensity);
          Lumen.applyParamsTo(e, params, { preset: { id: s.action.presetId, intensity } });
          Lumen.toast(`Applied “${Presets.byId(s.action.presetId).name}”`);
        } else {
          Lumen.mergeParamsTo(e, s.action.delta);
          Lumen.toast('Suggestion applied');
        }
        card.classList.add('applied');
        card.querySelector('.sug-apply').textContent = 'Applied ✓';
      };
    });
    if (canAI) $('#aiAsk').onclick = askAI;
  }
  async function askAI() {
    const e = Lumen.getCurrentEntry(); if (!e) return;
    const btn = $('#aiAsk'), note = $('#aiNote');
    btn.disabled = true; btn.textContent = 'Lumen AI is looking…';
    const text = await Suggestions.aiNote(e.stats);
    btn.disabled = false; btn.innerHTML = icon('wand') + ' Ask Lumen AI for an art-direction note';
    note.style.display = 'block';
    note.textContent = text || 'Lumen AI is unavailable right now — the suggestions above are generated locally from full pixel analysis.';
  }

  /* ---- Public hooks -----------------------------------------------------*/
  window.Panels = {
    init() { buildPresets(); buildSuggestHeader(); },
    onSelect(entry) { highlightPreset(entry); renderSuggestions(entry); },
    onParamsChanged(entry) { highlightPreset(entry); }
  };
})();
