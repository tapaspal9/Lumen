/* ============================================================================
 * Lumen — LumenStore  (js/core/store.js)
 *
 * Central state manager. Wraps an IStorageProvider and holds the in-memory
 * working library that the UI and imaging engine operate on.
 *
 * Responsibilities:
 *   - Load all photos + edits from storage on boot
 *   - Expose the library array to UI modules
 *   - Persist edits, imports, deletions through the provider
 *   - Emit events so panels re-render when state changes
 *   - Keep the entry shape compatible with the existing engine API
 *
 * The imaging engine (Imaging, Analysis, Crop, Export) is completely unaware
 * of this module. It receives ImageData buffers; it has no storage knowledge.
 *
 * INITIALISATION (in js/ui/app.js, on DOMContentLoaded):
 *
 *   const provider = new LocalProvider();        // Phase 0–3
 *   window.Store   = new LumenStore(provider);
 *   await window.Store.init();
 *   // Store.library now contains all persisted entries
 *
 * ============================================================================ */

(function (global) {
  'use strict';

  class LumenStore {

    constructor(provider) {
      if (!(provider instanceof IStorageProvider)) {
        throw new TypeError('LumenStore: provider must extend IStorageProvider');
      }
      this._provider  = provider;
      this._library   = [];     // in-memory working entries (matches existing entry shape)
      this._current   = -1;     // index of selected photo
      this._listeners = {};     // event → callback[]
    }

    /* ── Lifecycle ───────────────────────────────────────────────────────── */

    /**
     * Load all stored photos + their edits into memory.
     * Call once on app boot, before rendering the filmstrip.
     * @returns {Promise<object[]>} The populated library array.
     */
    async init() {
      const photos = await this._provider.listPhotos();

      const entries = await Promise.all(
        photos.map(async photo => {
          const edit = await this._provider.getEdit(photo.id) || {};
          return this._hydrate(photo, edit);
        })
      );

      // Sort newest captured first; fall back to importedAt if capturedAt is absent
      entries.sort((a, b) => {
        const da = a.capturedAt || a.importedAt || '';
        const db = b.capturedAt || b.importedAt || '';
        return db.localeCompare(da);
      });

      this._library = entries;
      this._emit('photosChanged', this._library);
      return this._library;
    }

    /* ── Accessors ───────────────────────────────────────────────────────── */

    /** The full in-memory library. Do not mutate directly. */
    get library()      { return this._library; }

    /** Index of the currently selected entry, or -1 if none. */
    get currentIndex() { return this._current; }

    /** The currently selected entry, or null. */
    get current()      { return this._current >= 0 ? this._library[this._current] : null; }

    /** Find an entry by id. Returns null if not found. */
    findById(id) {
      return this._library.find(e => e.id === id) || null;
    }

    /* ── Import ──────────────────────────────────────────────────────────── */

    /**
     * Import a new photo from a File object.
     *
     * Saves photo metadata + original blob to storage, builds the in-memory
     * entry, prepends it to the library, and emits 'photosChanged'.
     *
     * @param {File}   file      Original image file
     * @param {Image}  img       Loaded HTMLImageElement (for dimensions)
     * @param {object} exifData  Parsed EXIF result from Exif.parse(), or null
     * @returns {Promise<object>} The new library entry
     */
    async addPhoto(file, img, exifData) {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

      const photoRecord = {
        id,
        filename:   file.name,
        capturedAt: exifData?.fields?.DateTimeOriginal || new Date().toISOString(),
        importedAt: new Date().toISOString(),
        width:      img.naturalWidth  || img.width,
        height:     img.naturalHeight || img.height,
        fileSize:   file.size,
        mimeType:   file.type,
        exif:       exifData?.fields   || null,
        exifApp1:   exifData?.app1     || null,
        exifGpsOff: exifData?.gpsOff   ?? -1,
        hasGPS:     exifData?.hasGPS   || false,
        rating:     0,
        flag:       null,
      };

      // Persist metadata first so the record exists if anything else fails
      await this._provider.savePhoto(photoRecord);

      // Store original blob locally — NEVER uploaded automatically
      await this._provider.storeOriginal(id, file);

      // Build the in-memory entry the engine works with
      const entry   = this._hydrate(photoRecord, {});
      entry.img     = img;
      entry.url     = URL.createObjectURL(file);   // revoked on delete

      this._library.unshift(entry);   // newest first
      this._emit('photosChanged', this._library);
      return entry;
    }

    /* ── Editing ─────────────────────────────────────────────────────────── */

    /**
     * Persist the current edit state for an entry.
     * Call this after every committed edit (slider change, crop, preset apply).
     * @param {object} entry  A library entry
     */
    async saveEdit(entry) {
      if (!entry) return;
      await this._provider.saveEdit(entry.id, {
        params:   entry.params,
        crop:     entry.crop,
        preset:   entry.preset   || null,
        strength: entry.strength || 'professional',
      });
      this._emit('editSaved', entry);
    }

    /* ── Settings ────────────────────────────────────────────────────────── */

    async saveSetting(key, value)  { return this._provider.saveSetting(key, value); }
    async loadSetting(key, fb)     { return this._provider.loadSetting(key, fb); }

    /* ── Albums ──────────────────────────────────────────────────────────── */

    async saveAlbum(album)                        { return this._provider.saveAlbum(album); }
    async listAlbums()                            { return this._provider.listAlbums(); }
    async deleteAlbum(id)                         { return this._provider.deleteAlbum(id); }
    async addPhotoToAlbum(albumId, photoId, pos)  { return this._provider.addPhotoToAlbum(albumId, photoId, pos); }
    async removePhotoFromAlbum(albumId, photoId)  { return this._provider.removePhotoFromAlbum(albumId, photoId); }
    async getAlbumPhotos(albumId)                 { return this._provider.getAlbumPhotos(albumId); }

    /* ── Presets ─────────────────────────────────────────────────────────── */

    async savePreset(preset)   { return this._provider.savePreset(preset); }
    async listPresets()        { return this._provider.listPresets(); }
    async deletePreset(id)     { return this._provider.deletePreset(id); }

    /* ── Originals ───────────────────────────────────────────────────────── */

    async loadOriginal(photoId)  { return this._provider.loadOriginal(photoId); }
    async hasOriginal(photoId)   { return this._provider.hasOriginal(photoId); }

    /* ── Selection ───────────────────────────────────────────────────────── */

    /**
     * Select a photo by library index or by id string.
     * Emits 'selectionChanged' with the selected entry (or null).
     */
    select(indexOrId) {
      if (typeof indexOrId === 'string') {
        indexOrId = this._library.findIndex(e => e.id === indexOrId);
      }
      this._current = indexOrId;
      this._emit('selectionChanged', this.current);
    }

    /* ── Deletion ────────────────────────────────────────────────────────── */

    /**
     * Soft-delete a photo by library index or id.
     * Revokes its object URL, removes it from memory, persists the tombstone.
     * Returns the deleted entry so the caller can offer undo.
     * @param {number|string} indexOrId
     * @returns {Promise<object>} The deleted entry
     */
    async deletePhoto(indexOrId) {
      const idx = typeof indexOrId === 'string'
        ? this._library.findIndex(e => e.id === indexOrId)
        : indexOrId;

      const entry = this._library[idx];
      if (!entry) return null;

      // Free object URL memory
      if (entry.url) URL.revokeObjectURL(entry.url);

      // Persist tombstone + remove blob
      await this._provider.deletePhoto(entry.id);

      // Remove from memory
      this._library.splice(idx, 1);

      // Adjust current selection
      if (this._current >= this._library.length) {
        this._current = Math.max(0, this._library.length - 1);
      }
      if (this._library.length === 0) this._current = -1;

      this._emit('photosChanged', this._library);
      this._emit('selectionChanged', this.current);

      return entry;   // caller can offer undo by re-adding with addPhoto()
    }

    /* ── Events ──────────────────────────────────────────────────────────── */

    /**
     * Subscribe to a store event.
     *
     * Events:
     *   'photosChanged'    — library array changed (import/delete/init)
     *   'selectionChanged' — current photo changed
     *   'editSaved'        — an edit was persisted (useful for sync debounce)
     *
     * @param {string}   event
     * @param {Function} fn      Called with the event payload
     * @returns {Function}       Call to unsubscribe
     */
    on(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
      return () => {
        this._listeners[event] = (this._listeners[event] || []).filter(f => f !== fn);
      };
    }

    _emit(event, data) {
      (this._listeners[event] || []).forEach(fn => {
        try { fn(data); } catch (err) { console.error('[LumenStore] event error:', err); }
      });
    }

    /* ── Hydrate: DB record → working entry ──────────────────────────────── */
    //
    // The shape produced here MUST match the entry object shape that
    // app.js, imaging.js, crop.js and export.js already expect, so the
    // existing editor code continues to work without modification.

    _hydrate(photo, edit) {
      return {
        // ── Identity + metadata (from 'photos' store) ──────────────────────
        id:         photo.id,
        name:       photo.filename,
        w:          photo.width,
        h:          photo.height,
        exif:       photo.exif       || null,
        exifApp1:   photo.exifApp1   || null,
        exifGpsOff: photo.exifGpsOff ?? -1,
        hasGPS:     photo.hasGPS     || false,
        capturedAt: photo.capturedAt || null,
        importedAt: photo.importedAt || null,
        rating:     photo.rating     || 0,
        flag:       photo.flag       || null,

        // ── Edit state (from 'edits' store, or defaults) ───────────────────
        // window.Imaging may not be loaded yet when hydrate runs on boot —
        // app.js merges DEFAULTS in after the engine loads.
        params:   Object.assign(
                    {},
                    (window.Imaging && window.Imaging.DEFAULTS) || {},
                    edit.params || {}
                  ),
        crop:     edit.crop || { x: 0, y: 0, w: 1, h: 1, angle: 0 },
        preset:   edit.preset   || null,
        strength: edit.strength || 'professional',
        edited:   !!(edit.params || (edit.crop && edit.crop.w !== 1)),
        history:  [],    // undo stack — in-memory only, not persisted

        // ── Runtime (populated by app.js after the blob is loaded) ─────────
        img:   null,   // HTMLImageElement — set when entry is opened
        url:   null,   // Object URL       — set when blob is loaded from IndexedDB
        stats: null,   // Imaging.analyze() result — set after img loads
      };
    }
  }

  global.LumenStore = LumenStore;

})(window);
