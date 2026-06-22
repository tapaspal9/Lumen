/* ============================================================================
 * Lumen — Mobile Adjust Panel  (Phase 3)
 * Shows photo + controls on the same screen on phones (≤640px).
 * Uses window.Lumen API — no direct module imports (Rule 2 compliant).
 * ========================================================================= */
(function () {
  'use strict';

  const CTRLS = [
    { key: 'exposure',    label: 'Exposure',   grp: 'Light',  min: -100, max: 100 },
    { key: 'contrast',    label: 'Contrast',   grp: 'Light',  min: -100, max: 100 },
    { key: 'highlights',  label: 'Highlights', grp: 'Light',  min: -100, max: 100 },
    { key: 'shadows',     label: 'Shadows',    grp: 'Light',  min: -100, max: 100 },
    { key: 'whites',      label: 'Whites',     grp: 'Light',  min: -100, max: 100 },
    { key: 'blacks',      label: 'Blacks',     grp: 'Light',  min: -100, max: 100 },
    { key: 'temperature', label: 'Temp',       grp: 'Color',  min: -100, max: 100 },
    { key: 'tint',        label: 'Tint',       grp: 'Color',  min: -100, max: 100 },
    { key: 'saturation',  label: 'Saturation', grp: 'Color',  min: -100, max: 100 },
    { key: 'vibrance',    label: 'Vibrance',   grp: 'Color',  min: -100, max: 100 },
    { key: 'clarity',     label: 'Clarity',    grp: 'Detail', min: -100, max: 100 },
    { key: 'sharpness',   label: 'Sharpen',    grp: 'Detail', min: 0,    max: 100 },
    { key: 'noise',       label: 'Denoise',    grp: 'Detail', min: 0,    max: 100 },
    { key: 'vignette',    label: 'Vignette',   grp: 'FX',     min: -100, max: 100 },
  ];

  /* ---- DOM refs --------------------------------------------------------- */
  const panel     = document.getElementById('mobAdjustPanel');
  const autoRow   = document.getElementById('mobAutoRow');
  const grid      = document.getElementById('mobCtrlScroll');
  const sliderRow = document.getElementById('mobSliderRow');
  const sLabel    = document.getElementById('mobSliderLabel');
  const sVal      = document.getElementById('mobSliderVal');
  const sInput    = document.getElementById('mobSliderInput');
  const applyBtn  = document.getElementById('mobApply');
  const cancelBtn = document.getElementById('mobCancel');
  const autoBtn   = document.getElementById('mobAutoEnhance');

  if (!panel || !grid || !sliderRow) return; // safety

  let activeKey  = null;
  let savedValue = 0;

  /* ---- Build control chip grid ----------------------------------------- */
  function buildGrid() {
    grid.innerHTML = '';
    let lastGrp = '';
    CTRLS.forEach(c => {
      if (c.grp !== lastGrp) {
        lastGrp = c.grp;
        const sep = document.createElement('div');
        sep.className = 'mob-grp-label';
        sep.textContent = c.grp;
        grid.appendChild(sep);
      }
      const btn = document.createElement('button');
      btn.className = 'mob-chip';
      btn.dataset.key = c.key;
      btn.innerHTML =
        '<span class="mob-chip-name">' + c.label + '</span>' +
        '<span class="mob-chip-val" id="mval-' + c.key + '">0</span>';
      btn.onclick = () => openSlider(c);
      grid.appendChild(btn);
    });
  }

  /* ---- Sync chip values from current entry ------------------------------ */
  function updateChipValues() {
    var L = window.Lumen; if (!L) return;
    var e = L.getCurrentEntry(); if (!e) return;
    CTRLS.forEach(function (c) {
      var el = document.getElementById('mval-' + c.key);
      if (!el) return;
      var v = e.params[c.key] || 0;
      el.textContent = v > 0 ? '+' + v : '' + v;
      el.closest('.mob-chip').classList.toggle('mob-chip-changed', v !== 0);
    });
  }

  /* ---- Open a single slider --------------------------------------------- */
  function openSlider(ctrl) {
    var L = window.Lumen; if (!L) return;
    var e = L.getCurrentEntry(); if (!e) return;

    activeKey  = ctrl.key;
    savedValue = e.params[ctrl.key] != null ? e.params[ctrl.key] : 0;

    sLabel.textContent = ctrl.label;
    sInput.min   = ctrl.min;
    sInput.max   = ctrl.max;
    sInput.value = savedValue;
    fmtVal(savedValue);

    autoRow.style.display  = 'none';
    grid.style.display     = 'none';
    sliderRow.style.display = 'flex';
    sInput.focus();
  }

  function fmtVal(v) {
    sVal.textContent = v > 0 ? '+' + v : '' + v;
  }

  /* ---- Close slider (back to grid) -------------------------------------- */
  function closeSlider() {
    activeKey = null;
    sliderRow.style.display = 'none';
    autoRow.style.display   = 'flex';
    grid.style.display      = 'grid';
    updateChipValues();
  }

  /* ---- Live preview while dragging -------------------------------------- */
  sInput.addEventListener('input', function () {
    var L = window.Lumen; if (!L || !activeKey) return;
    var e = L.getCurrentEntry(); if (!e) return;
    var v = parseInt(sInput.value, 10);
    e.params[activeKey] = v;
    fmtVal(v);
    if (L.markEdited)      L.markEdited();
    if (L.scheduleRender)  L.scheduleRender();
  });

  /* ---- Apply — commit the edit ------------------------------------------ */
  applyBtn.onclick = function () {
    var L = window.Lumen;
    if (L) {
      if (L.pushHistory)  L.pushHistory();
      if (L.commitEdit)   L.commitEdit();
      if (L.syncSliders)  L.syncSliders();
    }
    var lbl = sLabel.textContent;
    closeSlider();
    if (L && L.toast) L.toast(lbl + ' applied');
  };

  /* ---- Cancel — revert to saved value ----------------------------------- */
  cancelBtn.onclick = function () {
    var L = window.Lumen;
    if (L && activeKey) {
      var e = L.getCurrentEntry();
      if (e) {
        e.params[activeKey] = savedValue;
        if (L.scheduleRender) L.scheduleRender();
      }
    }
    closeSlider();
  };

  /* ---- Auto-Enhance button ---------------------------------------------- */
  autoBtn.onclick = function () {
    var L = window.Lumen;
    if (L && L.runAuto) {
      L.runAuto();
      setTimeout(updateChipValues, 350);
    }
  };

  /* ---- Init ------------------------------------------------------------- */
  buildGrid();

  /* Listen for photo selection changes via the rail body (MutationObserver).
     This avoids coupling to internal select events — Rule 2 safe. */
  var railBody = document.getElementById('railBody');
  if (railBody) {
    new MutationObserver(function () { setTimeout(updateChipValues, 80); })
      .observe(railBody, { childList: true, subtree: true, attributes: true });
  }

  /* Patch switchMobileTab so we refresh chip values on tab enter */
  var _origSwitch = window.switchMobileTab;
  if (_origSwitch) {
    window.switchMobileTab = function (tab) {
      _origSwitch(tab);
      if (tab === 'adjust') {
        if (sliderRow.style.display !== 'none') closeSlider();
        setTimeout(updateChipValues, 50);
      }
    };
  }

  window.MobileAdjust = { updateChipValues: updateChipValues, closeSlider: closeSlider };
})();
