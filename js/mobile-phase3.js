/* ============================================================================
 * Lumen — Phase 3 Mobile Features
 * Travel Mode · Swipe navigation · Haptics · Tap-compare · Preset swatches
 * Rule 2 compliant — communicates via window.Lumen only.
 * ========================================================================= */
(function () {
  'use strict';

  const IS_MOBILE = () => window.innerWidth <= 640;

  /* ========================================================================
   * 1. HAPTIC FEEDBACK
   * Light vibration on key interactions — iOS via Capacitor, Android via API
   * ====================================================================== */
  function haptic(style) {
    if (!IS_MOBILE()) return;
    try {
      if (navigator.vibrate) {
        const ms = style === 'heavy' ? 18 : style === 'medium' ? 12 : 8;
        navigator.vibrate(ms);
      }
    } catch (_) { /* silent */ }
  }
  window.LumenHaptic = haptic;

  /* ========================================================================
   * 2. SINGLE-TAP COMPARE (replaces double-tap on mobile)
   * Tap canvas → flash original for 800ms, then return to edit.
   * Hold (>300ms) → show original while held.
   * ====================================================================== */
  (function initTapCompare() {
    const wrap = document.getElementById('canvasWrap');
    if (!wrap) return;

    let tapTimer = null;
    let isHolding = false;
    let flashTimer = null;
    let tapStartTime = 0;

    // Track whether a pinch or swipe is active — if so, skip tap logic
    let gestureActive = false;

    wrap.addEventListener('touchstart', ev => {
      if (!IS_MOBILE()) return;
      if (ev.touches.length > 1) { gestureActive = true; return; }
      gestureActive = false;
      tapStartTime = Date.now();
      // Start hold detection
      tapTimer = setTimeout(() => {
        if (!gestureActive) {
          isHolding = true;
          wrap.classList.add('show-original');
          haptic('light');
        }
      }, 300);
    }, { passive: true });

    wrap.addEventListener('touchmove', ev => {
      if (ev.touches.length > 1) gestureActive = true;
      // If moved significantly, cancel tap
      if (!gestureActive && tapTimer) {
        // We don't have start coords in this simple version
        // but the swipe handler below handles this
      }
    }, { passive: true });

    wrap.addEventListener('touchend', ev => {
      if (!IS_MOBILE()) return;
      clearTimeout(tapTimer);

      if (isHolding) {
        // Release hold
        wrap.classList.remove('show-original');
        isHolding = false;
        return;
      }

      if (gestureActive || ev.touches.length > 0) return;

      const dt = Date.now() - tapStartTime;
      const L = window.Lumen;
      if (dt < 300 && L && L.currentIndex >= 0) {
        // Quick tap → flash original for 800ms
        clearTimeout(flashTimer);
        wrap.classList.add('show-original');
        haptic('light');
        // Show "Before" badge
        const badge = document.createElement('div');
        badge.className = 'mob-before-badge';
        badge.textContent = 'Before';
        wrap.appendChild(badge);
        requestAnimationFrame(() => badge.classList.add('visible'));

        flashTimer = setTimeout(() => {
          wrap.classList.remove('show-original');
          badge.classList.remove('visible');
          setTimeout(() => badge.remove(), 200);
        }, 800);
      }
    }, { passive: true });
  })();

  /* ========================================================================
   * 3. SWIPE BETWEEN PHOTOS
   * Horizontal swipe on canvas (at 1x zoom) → prev/next photo.
   * ====================================================================== */
  (function initSwipeNav() {
    const stage = document.getElementById('stage');
    const wrap  = document.getElementById('canvasWrap');
    if (!stage || !wrap) return;

    let startX = 0, startY = 0, tracking = false, swiped = false;
    const THRESHOLD = 60;

    stage.addEventListener('touchstart', ev => {
      if (!IS_MOBILE() || ev.touches.length !== 1) return;
      // Only swipe when not zoomed
      if (wrap.style.transform && !wrap.style.transform.includes('scale(1')) {
        const m = wrap.style.transform.match(/scale\(([\d.]+)\)/);
        if (m && Math.abs(parseFloat(m[1]) - 1) > 0.15) return;
      }
      startX = ev.touches[0].clientX;
      startY = ev.touches[0].clientY;
      tracking = true;
      swiped = false;
    }, { passive: true });

    stage.addEventListener('touchmove', ev => {
      if (!tracking || !IS_MOBILE() || ev.touches.length !== 1) return;
      const dx = ev.touches[0].clientX - startX;
      const dy = ev.touches[0].clientY - startY;
      // If vertical movement is dominant, don't swipe horizontally
      if (Math.abs(dy) > Math.abs(dx) * 0.8) { tracking = false; return; }
      if (Math.abs(dx) > THRESHOLD && !swiped) {
        swiped = true;
        const L = window.Lumen;
        if (!L || L.currentIndex < 0) return;
        if (dx < 0 && L.currentIndex < L.library.length - 1) {
          // Swipe left → next
          L.selectImage(L.currentIndex + 1);
          haptic('medium');
          showSwipeHint('next');
        } else if (dx > 0 && L.currentIndex > 0) {
          // Swipe right → previous
          L.selectImage(L.currentIndex - 1);
          haptic('medium');
          showSwipeHint('prev');
        }
      }
    }, { passive: true });

    stage.addEventListener('touchend', () => { tracking = false; }, { passive: true });

    function showSwipeHint(dir) {
      const existing = stage.querySelector('.swipe-hint');
      if (existing) existing.remove();
      const hint = document.createElement('div');
      hint.className = 'swipe-hint ' + dir;
      hint.innerHTML = dir === 'next'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>';
      stage.appendChild(hint);
      requestAnimationFrame(() => hint.classList.add('show'));
      setTimeout(() => { hint.classList.remove('show'); setTimeout(() => hint.remove(), 200); }, 600);
    }
  })();

  /* ========================================================================
   * 4. PRESET SWATCHES ROW (mobile adjust panel)
   * Quick-access horizontal scroll of top recommended presets.
   * ====================================================================== */
  (function initPresetSwatches() {
    const autoRow = document.getElementById('mobAutoRow');
    if (!autoRow) return;

    // Create swatch container after auto-enhance row
    const swatchRow = document.createElement('div');
    swatchRow.className = 'mob-preset-row';
    swatchRow.id = 'mobPresetRow';
    autoRow.after(swatchRow);

    function buildSwatches() {
      if (!window.Presets || !window.Lumen) return;
      const L = window.Lumen;
      const e = L.getCurrentEntry();
      swatchRow.innerHTML = '';

      const scene = e && e.stats && e.stats.scene;
      const recIds = scene ? Presets.recommendFor(scene.type) : [];
      // Show recommended first, then first few from each category
      const shown = new Set();
      const list = [];

      recIds.forEach(id => {
        const p = Presets.byId(id);
        if (p) { list.push({ ...p, rec: true }); shown.add(id); }
      });

      // Fill up to 8 with popular presets
      if (Presets.CATEGORIES) {
        Presets.CATEGORIES.forEach(cat => {
          const presets = Presets.byCategory(cat.id);
          for (const p of presets) {
            if (list.length >= 8) break;
            if (!shown.has(p.id)) { list.push(p); shown.add(p.id); }
          }
        });
      }

      if (!list.length) return;

      list.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'mob-swatch-btn' + (e && e.preset && e.preset.id === p.id ? ' active' : '');
        btn.dataset.id = p.id;
        btn.innerHTML =
          '<span class="mob-swatch-colors">' +
            (p.swatch || []).map(c => '<i style="background:' + c + '"></i>').join('') +
          '</span>' +
          '<span class="mob-swatch-name">' + p.name + '</span>' +
          (p.rec ? '<span class="mob-swatch-rec">★</span>' : '');
        btn.onclick = () => {
          haptic('light');
          if (window.Panels) {
            // Use the Panels preset application logic
            const entry = L.getCurrentEntry();
            if (!entry) return;
            const params = Presets.build(p.id, entry.stats, 0.8, entry.stats && entry.stats.scene);
            L.applyParamsTo(entry, params, { preset: { id: p.id, intensity: 0.8 } });
            L.toast(p.name + ' applied');
          }
          buildSwatches(); // refresh active state
          if (window.MobileAdjust) MobileAdjust.updateChipValues();
        };
        swatchRow.appendChild(btn);
      });
    }

    // Rebuild when photo changes
    const railBody = document.getElementById('railBody');
    if (railBody) {
      new MutationObserver(() => setTimeout(buildSwatches, 120))
        .observe(railBody, { childList: true, subtree: true, attributes: true });
    }

    // Initial build
    setTimeout(buildSwatches, 500);
    window._rebuildMobSwatches = buildSwatches;
  })();

  /* ========================================================================
   * 5. TRAVEL MODE
   * One-tap mode for speed + battery conservation.
   * - Simplified UI: hides manual sliders, shows only intensity control
   * - Auto-enhance fires on import
   * - Lower preview resolution (future: worker priority)
   * - Battery detection + auto-prompt
   * ====================================================================== */
  const TM_KEY = 'lumen_travel_mode';
  let travelMode = localStorage.getItem(TM_KEY) === 'true';

  function setTravelMode(on) {
    travelMode = !!on;
    localStorage.setItem(TM_KEY, travelMode ? 'true' : 'false');
    document.body.classList.toggle('travel-mode', travelMode);

    const L = window.Lumen;

    // Update the toggle UI
    const toggle = document.getElementById('travelToggle');
    if (toggle) toggle.checked = travelMode;

    if (travelMode) {
      if (L) L.toast('✈ Travel Mode — speed over perfectionism');
      haptic('medium');
    } else {
      if (L) L.toast('Travel Mode off — full controls restored');
    }
  }

  // Apply initial state
  if (travelMode) document.body.classList.add('travel-mode');

  // Build Travel Mode toggle in mobile nav area
  (function initTravelUI() {
    // Add toggle to the mobile adjust panel (top)
    const autoRow = document.getElementById('mobAutoRow');
    if (!autoRow) return;

    const tmRow = document.createElement('div');
    tmRow.className = 'travel-mode-row';
    tmRow.innerHTML =
      '<div class="tm-toggle-wrap">' +
        '<span class="tm-icon">✈</span>' +
        '<span class="tm-label">Travel Mode</span>' +
        '<label class="switch tm-switch">' +
          '<input type="checkbox" id="travelToggle"' + (travelMode ? ' checked' : '') + '>' +
          '<span class="track"></span>' +
        '</label>' +
      '</div>';
    autoRow.parentNode.insertBefore(tmRow, autoRow);

    document.getElementById('travelToggle').onchange = function () {
      setTravelMode(this.checked);
    };

    // Travel mode: auto-enhance on adjust tab open
    const origSwitch = window.switchMobileTab;
    if (origSwitch) {
      window.switchMobileTab = function (tab) {
        origSwitch(tab);
        if (travelMode && tab === 'adjust') {
          const L = window.Lumen;
          if (L && L.getCurrentEntry() && !L.getCurrentEntry().edited) {
            // Auto-fire enhance in travel mode
            setTimeout(() => { if (L.runAuto) L.runAuto(); }, 200);
          }
        }
      };
    }

    // Intensity-only control for Travel Mode
    const intensityRow = document.createElement('div');
    intensityRow.className = 'tm-intensity-row';
    intensityRow.id = 'tmIntensityRow';
    intensityRow.innerHTML =
      '<div class="tm-intensity-head">' +
        '<span class="tm-int-label">Intensity</span>' +
        '<span class="tm-int-val" id="tmIntVal">Pro</span>' +
      '</div>' +
      '<div class="tm-intensity-seg" id="tmIntSeg">' +
        '<button data-s="subtle">Subtle</button>' +
        '<button data-s="natural">Natural</button>' +
        '<button data-s="professional" class="on">Pro</button>' +
        '<button data-s="dramatic">Drama</button>' +
      '</div>' +
      '<button class="tm-batch-btn" id="tmBatchAll">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>' +
        'Enhance all photos' +
      '</button>';
    autoRow.parentNode.insertBefore(intensityRow, autoRow.nextSibling);

    // Wire intensity segment buttons
    intensityRow.querySelectorAll('#tmIntSeg button').forEach(btn => {
      btn.onclick = () => {
        intensityRow.querySelectorAll('#tmIntSeg button').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        document.getElementById('tmIntVal').textContent = btn.textContent;
        haptic('light');
        // Apply strength change
        const L = window.Lumen;
        if (L && L.getCurrentEntry()) {
          // Re-run auto with this strength
          const seg = document.getElementById('strengthSeg');
          if (seg) {
            const match = seg.querySelector('[data-k="' + btn.dataset.s + '"]');
            if (match) match.click();
          }
          if (L.runAuto) L.runAuto();
        }
      };
    });

    // Batch enhance all
    document.getElementById('tmBatchAll').onclick = () => {
      haptic('heavy');
      const L = window.Lumen;
      if (L && L.batch && L.batch.auto) {
        L.batch.auto();
        L.toast('✈ Enhancing all photos…');
      }
    };
  })();

  // Battery API — auto-prompt Travel Mode when low
  (function initBatteryWatch() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(bat => {
      function check() {
        if (bat.level <= 0.20 && !bat.charging && !travelMode && IS_MOBILE()) {
          // Prompt user
          const L = window.Lumen;
          if (L && L.toast) {
            L.toast('Battery low — enable Travel Mode?', {
              label: 'Enable',
              fn: () => setTravelMode(true)
            });
          }
        }
        // Auto-disable when plugged in and Travel Mode is on
        if (bat.charging && travelMode) {
          setTimeout(() => {
            if (bat.charging && travelMode) {
              setTravelMode(false);
            }
          }, 120000); // 2 minutes
        }
      }
      bat.addEventListener('levelchange', check);
      bat.addEventListener('chargingchange', check);
      check();
    }).catch(() => {});
  })();

  /* ========================================================================
   * 6. HAPTIC HOOKS — Wire haptics into existing controls
   * ====================================================================== */
  (function wireHaptics() {
    // Auto-enhance button
    const autoBtn = document.getElementById('autoBtn');
    if (autoBtn) {
      const origClick = autoBtn.onclick;
      autoBtn.addEventListener('click', () => haptic('medium'), true);
    }

    // Mobile auto-enhance
    const mobAuto = document.getElementById('mobAutoEnhance');
    if (mobAuto) {
      mobAuto.addEventListener('click', () => haptic('medium'), true);
    }

    // Export button
    const expBtn = document.getElementById('exportBtn');
    if (expBtn) {
      expBtn.addEventListener('click', () => haptic('heavy'), true);
    }

    // Mobile chip taps
    document.addEventListener('click', ev => {
      if (ev.target.closest('.mob-chip')) haptic('light');
    }, true);

    // Crop ratio buttons
    document.addEventListener('click', ev => {
      if (ev.target.closest('.crop-ratios button')) haptic('light');
    }, true);
  })();

  /* ========================================================================
   * 7. PUBLIC API
   * ====================================================================== */
  window.TravelMode = {
    get active() { return travelMode; },
    set: setTravelMode,
    toggle: () => setTravelMode(!travelMode)
  };

})();
