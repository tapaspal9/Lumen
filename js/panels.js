/* ============================================================================
 * Lumen — Rail Panels  (js/panels.js)
 * Smart Enhance confirm flow + categorized preset browser + suggestions.
 * ============================================================================ */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  let intensity = 0.8;
  let aiEnabled = true;
  let presetLayerMode = false;

  const ICONS = {
    sun:      '<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/><circle cx="12" cy="12" r="4"/>',
    contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"/>',
    drop:     '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
    palette:  '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.5 1-2 2-2h1a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16" cy="11" r="1"/>',
    crop:     '<path d="M6 2v16h16M2 6h16v16"/>',
    wand:     '<path d="M5 3v4M3 5h4M6 17v3M4.5 18.5h3M14 4l6 6L9 21l-6-6L14 4Z"/>',
    bw:       '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none"/>',
    portrait: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>',
    warn:     '<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  };
  const icon = (n, extra) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${ICONS[n] || ICONS.wand}</svg>`;

  /* ---- Smart Enhance confirm flow --------------------------------------- */
  let _autoBlockHTML = '';   // saved so we can restore after cancel

  function onAutoClick() {
    const e = Lumen.getCurrentEntry();
    if (!e || !e.stats) { Lumen.runAuto(); return; }
    const scene = e.stats.scene;
    if (!scene) { Lumen.runAuto(); return; }   // no scene data → instant enhance
    _showConfirm(e, scene);
  }

  function _showConfirm(entry, scene) {
    const block = $('.auto-block');
    if (!block) { Lumen.runAuto(); return; }
    _autoBlockHTML = block.innerHTML;

    const recs   = Presets.recommendFor(scene.type);
    const topRec = Presets.byId(recs[0]);
    const conf   = Math.round(scene.confidence * 100);
    const isPort = scene.isPortrait;
    const changes = _buildChangeList(entry, scene, topRec);

    block.innerHTML = `
      <div class="smart-confirm" id="smartConfirm">
        <div class="sc-scene">
          ${icon('wand', 'class="sc-wand"')}
          <span class="sc-type">${scene.type}</span>
          <span class="sc-conf">${conf}%</span>
        </div>
        ${isPort ? `
          <div class="sc-portrait-warn">
            ${icon('warn')}
            Portrait detected — skin-safe editing mode will be used.
          </div>` : ''}
        <div class="sc-changes">
          ${changes.map(c => `<div class="sc-change">${c}</div>`).join('')}
        </div>
        <button class="auto-btn sc-apply" id="scApply">
          Apply ${scene.type} style
        </button>
        <button class="sc-cancel" id="scCancel">Cancel</button>
      </div>`;

    block.querySelector('#scApply').onclick  = _confirmEnhance;
    block.querySelector('#scCancel').onclick = _cancelConfirm;
  }

  function _buildChangeList(entry, scene, topRec) {
    const s    = entry.stats;
    const m    = s ? s.meanL / 255 : 0.5;
    const rows = [];
    if (topRec) rows.push(`Preset: ${topRec.name}`);
    const expAdj = Math.round((0.47 - m) * 130);
    if (Math.abs(expAdj) > 4) rows.push(`Exposure: ${expAdj > 0 ? '+' : ''}${expAdj}`);
    if (scene.isPortrait)  rows.push('Clarity reduced — skin texture protected');
    if (scene.isNight)     rows.push('Shadow lift + noise reduction for night scene');
    if (scene.isLowLight)  rows.push('Gentle shadow recovery + noise reduction');
    const cast = window.Analysis && Analysis.colorCast(s);
    if (cast && cast.label) rows.push(`White balance: correct ${cast.label.toLowerCase()}`);
    if (!rows.length) rows.push('Micro-corrections only — image is well balanced');
    return rows;
  }

  function _confirmEnhance() {
    _restoreAutoBlock();
    Lumen.runAuto();
  }

  function _cancelConfirm() {
    _restoreAutoBlock();
  }

  function _restoreAutoBlock() {
    const block = $('.auto-block');
    if (block && _autoBlockHTML) {
      block.innerHTML = _autoBlockHTML;
      _rewireStrengthSeg(block);
    }
  }

  function _rewireStrengthSeg(block) {
    block.querySelectorAll('#strengthSeg button').forEach(b => {
      b.onclick = () => {
        window.Lumen && Lumen.getCurrentEntry && (function () {
          // Dispatch strength change back to app.js via the existing seg buttons
          const realSeg = document.getElementById('strengthSeg');
          if (realSeg) {
            const match = [...realSeg.querySelectorAll('button')].find(rb => rb.dataset.k === b.dataset.k);
            if (match) match.click();
          }
        })();
      };
    });
  }

  /* ---- Categorized preset browser --------------------------------------- */
  function buildPresets() {
    const box   = $('#presetsBody');
    const entry = Lumen.getCurrentEntry();
    const recIds = entry && entry.stats && entry.stats.scene
      ? Presets.recommendFor(entry.stats.scene.type)
      : [];

    box.innerHTML =
      '<div class="preset-cats" id="presetCats"></div>' +
      `<div class="intensity" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line-2)">
         <div class="row"><span class="name">Intensity</span><span class="num" id="intVal">${Math.round(intensity * 100)}%</span></div>
         <input type="range" id="intRange" min="0" max="100" step="1" value="${Math.round(intensity * 100)}">
       </div>`;

    const cats = document.getElementById('presetCats');
    const scene = entry && entry.stats && entry.stats.scene;

    Presets.CATEGORIES.forEach(cat => {
      const presets = Presets.byCategory(cat.id);
      if (!presets.length) return;
      const recs = presets.filter(p => recIds.includes(p.id));
      const isRecCat = recs.length > 0;

      const catEl = document.createElement('div');
      catEl.className = 'preset-cat' + (isRecCat ? ' rec-cat' : '');
      catEl.innerHTML =
        `<div class="preset-cat-head" data-cat="${cat.id}">
           <span class="preset-cat-name">${cat.label}</span>
           <span class="preset-cat-right">
             ${isRecCat ? `<span class="preset-cat-recs">${recs.length} suggested</span>` : ''}
             <span class="preset-cat-count">${presets.length}</span>
           </span>
         </div>
         <div class="preset-cat-grid ${isRecCat ? '' : 'collapsed'}" data-grid="${cat.id}">
           ${presets.map(p => {
             const isRec = recIds.includes(p.id);
             return `<button class="preset-card" data-id="${p.id}">
               <span class="preset-swatch">${p.swatch.map(c => `<i style="background:${c}"></i>`).join('')}</span>
               <span class="preset-name">${p.name}${isRec ? '<span class="preset-rec-badge">Suggested</span>' : ''}</span>
               <span class="preset-desc">${p.desc}</span>
             </button>`;
           }).join('')}
         </div>`;

      catEl.querySelector('.preset-cat-head').onclick = function () {
        const grid = catEl.querySelector('.preset-cat-grid');
        grid.classList.toggle('collapsed');
      };
      catEl.querySelectorAll('.preset-card').forEach(c =>
        c.onclick = () => applyPreset(c.dataset.id));

      cats.appendChild(catEl);
    });

    const range = $('#intRange');
    range.oninput = () => {
      intensity = +range.value / 100;
      $('#intVal').textContent = range.value + '%';
      const e = Lumen.getCurrentEntry();
      if (e && e.preset) applyPreset(e.preset.id);
    };

    highlightPreset(entry);
  }

  function applyPreset(id) {
    const e = Lumen.getCurrentEntry(); if (!e) return;
    const scene  = e.stats && e.stats.scene;
    if (presetLayerMode) {
      // Layer mode: add preset creative delta directly on top of current params
      const preset = Presets.byId(id);
      if (!preset) return;
      const delta = {};
      for (const k in (preset.creative || {})) {
        delta[k] = Math.round((preset.creative[k] || 0) * intensity);
      }
      Lumen.mergeParamsTo(e, delta);
      Lumen.toast(`Layered: ${preset.name} · ${Math.round(intensity * 100)}%`);
    } else {
      const params = Presets.build(id, e.stats, intensity, scene);
      Lumen.applyParamsTo(e, params, { preset: { id, intensity } });
      const p = Presets.byId(id);
      Lumen.toast(`${p ? p.name : id} · ${Math.round(intensity * 100)}%`);
    }
  }

  function highlightPreset(e) {
    const id = e && e.preset ? e.preset.id : null;
    document.querySelectorAll('.preset-card').forEach(c => c.classList.toggle('on', c.dataset.id === id));
    if (e && e.preset) {
      intensity = e.preset.intensity;
      const r = $('#intRange');
      if (r) { r.value = Math.round(intensity * 100); $('#intVal').textContent = r.value + '%'; }
    }
  }

  /* ---- Suggestions panel ------------------------------------------------ */
  function buildSuggestHeader() {
    const head = $('#suggestHead');
    head.innerHTML =
      `<span>AI suggestions</span>
       <label class="switch"><input type="checkbox" id="aiToggle" ${aiEnabled ? 'checked' : ''}><span class="track"></span></label>`;
    $('#aiToggle').onchange = e => { aiEnabled = e.target.checked; renderSuggestions(Lumen.getCurrentEntry()); };
  }

  const SCENE_TYPES = [
    'Landscape','Nature','Beach & Water','Sunset / Golden Hour',
    'City & Architecture','Portrait','Food','Indoor','Night','Low Light'
  ];

  function renderSuggestions(entry) {
    const box = $('#suggestBody');
    if (!entry) { box.innerHTML = ''; return; }
    if (!aiEnabled) {
      box.innerHTML = `<div class="ai-off">AI recommendations are off. Toggle on to let Lumen analyze this photo and suggest edits.</div>`;
      return;
    }
    const list = Suggestions.build(entry.stats);
    const canAI = Suggestions.available();
    const scene = entry.stats && entry.stats.scene;

    // Scene feedback row — lets the user correct a misdetection inline
    const sceneFbHtml = scene ? `
      <div class="scene-fb">
        <button class="scene-fb-toggle" id="sceneFbToggle">
          ${icon('wand')} <b>${scene.type}</b>
          <span class="scene-fb-conf">${Math.round(scene.confidence * 100)}%</span>
          <span class="scene-fb-hint">Wrong?</span>
        </button>
        <div class="sp-grid" id="scenePicker" style="display:none">
          ${SCENE_TYPES.map(t =>
            `<button class="sp-btn${t === scene.type ? ' on' : ''}" data-t="${t}">${t}</button>`
          ).join('')}
        </div>
      </div>` : '';

    box.innerHTML =
      sceneFbHtml +
      `<div class="ai-intro">Lumen inspected this frame and recommends ${list.length} adjustment${list.length !== 1 ? 's' : ''}. Apply only what you like.</div>` +
      list.map((s, i) =>
        `<div class="sug" data-i="${i}">
           <div class="sug-ic ${s.rec ? 'rec' : ''}">${icon(s.icon)}</div>
           <div class="sug-main">
             <div class="sug-top"><span class="sug-tag">${s.tag}</span>${s.rec ? '<span class="sug-rec">Recommended</span>' : s.advisory ? '<span class="sug-adv">Tip</span>' : ''}</div>
             <div class="sug-title">${s.title}</div>
             <div class="sug-detail">${s.detail}</div>
             <button class="sug-apply">${s.action.type === 'preset' ? 'Apply preset' : 'Apply'}</button>
           </div>
         </div>`).join('') +
      (canAI
        ? `<button class="ai-ask" id="aiAsk">${icon('wand')} Ask Lumen AI for art direction</button><div class="ai-note" id="aiNote" style="display:none"></div>`
        : `<div class="ai-note-hint">Connect Lumen AI for natural-language art direction.</div>`);

    // Wire scene correction picker
    const toggle = $('#sceneFbToggle'), picker = $('#scenePicker');
    if (toggle && picker) {
      toggle.onclick = () => {
        picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
      };
      picker.querySelectorAll('.sp-btn').forEach(btn => {
        btn.onclick = () => {
          const e = Lumen.getCurrentEntry(); if (!e || !e.stats) return;
          const orig = e.stats.scene || {};
          e.stats.scene = Object.assign({}, orig, {
            type: btn.dataset.t, confidence: 0.95,
            isPortrait: btn.dataset.t === 'Portrait',
            isNight:    btn.dataset.t === 'Night',
            isLowLight: btn.dataset.t === 'Low Light',
            preset: (window.Presets && Presets.recommendFor(btn.dataset.t)[0]) || orig.preset
          });
          picker.style.display = 'none';
          Lumen.toast(`Scene \u2192 ${btn.dataset.t}`);
          renderSuggestions(e);
          buildPresets();
        };
      });
    }

    box.querySelectorAll('.sug').forEach(card => {
      const s = list[+card.dataset.i];
      card.querySelector('.sug-apply').onclick = () => {
        const e = Lumen.getCurrentEntry(); if (!e) return;
        if (s.action.type === 'preset') {
          intensity = s.action.intensity != null ? s.action.intensity : intensity;
          const params = Presets.build(s.action.presetId, e.stats, intensity, e.stats.scene);
          Lumen.applyParamsTo(e, params, { preset: { id: s.action.presetId, intensity } });
          const p = Presets.byId(s.action.presetId);
          Lumen.toast(`Applied "${p ? p.name : s.action.presetId}"`);
        } else {
          Lumen.mergeParamsTo(e, s.action.delta);
          Lumen.toast('Suggestion applied');
        }
        card.classList.add('applied');
        card.querySelector('.sug-apply').textContent = 'Applied';
      };
    });
    if (canAI && $('#aiAsk')) $('#aiAsk').onclick = askAI;
  }

  async function askAI() {
    const e = Lumen.getCurrentEntry(); if (!e) return;
    const btn = $('#aiAsk'), note = $('#aiNote');
    btn.disabled = true; btn.textContent = 'Lumen AI is thinking…';
    const text = await Suggestions.aiNote(e.stats);
    btn.disabled = false; btn.innerHTML = icon('wand') + ' Ask Lumen AI for art direction';
    note.style.display = 'block';
    note.textContent = text || 'Lumen AI unavailable — suggestions above are generated from full pixel analysis.';
  }

  /* ---- Public API ------------------------------------------------------- */
  window.Panels = {
    init()              { buildPresets(); buildSuggestHeader(); },
    onSelect(entry)     { highlightPreset(entry); renderSuggestions(entry); buildPresets(); },
    onParamsChanged(e)  { highlightPreset(e); },
    onAutoClick,
    setLayerMode(v)     { presetLayerMode = !!v; },
  };
})();
