/* ============================================================================
 * Lumen — LocalProvider  (js/core/local-provider.js)
 *
 * IStorageProvider implementation backed by IndexedDB (via LumenDB helpers).
 *
 * All data stays on this device:
 *   - Photo metadata + edits + albums + presets → seven IndexedDB object stores
 *   - Original photo blobs → 'blobs' store, excluded from every sync pathway
 *
 * TO ADD CLOUD SYNC (Phase 4):
 *   Create CloudProvider in js/core/cloud-provider.js extending IStorageProvider.
 *   In app.js, replace `new LocalProvider()` with `new CloudProvider(supabase)`.
 *   Nothing else changes.
 * ============================================================================ */

(function (global) {
  'use strict';

  /* ── Utilities ─────────────────────────────────────────────────────────── */

  function uid()  { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function now()  { return new Date().toISOString(); }

  /* ── LocalProvider ─────────────────────────────────────────────────────── */

  class LocalProvider extends IStorageProvider {

    constructor() {
      super();
      this._db    = null;
      // All public methods await this before using this._db
      this._ready = LumenDB.openDB().then(db => { this._db = db; });
    }

    /** Wait for DB to be ready, then return it. */
    async _db_() {
      await this._ready;
      return this._db;
    }

    /* ── Photos ────────────────────────────────────────────────────────── */

    async savePhoto(photo) {
      const db  = await this._db_();
      const rec = {
        ...photo,
        id:        photo.id || uid(),
        updatedAt: now(),
        deleted:   false,
      };
      await LumenDB.put(db, 'photos', rec);
      return rec;
    }

    async getPhoto(id) {
      return LumenDB.get(await this._db_(), 'photos', id);
    }

    async listPhotos() {
      const all = await LumenDB.getAll(await this._db_(), 'photos');
      return all.filter(p => !p.deleted);
    }

    async deletePhoto(id) {
      const db  = await this._db_();
      const rec = await LumenDB.get(db, 'photos', id);
      if (!rec) return;
      // Soft delete — tombstone for sync. Original blob is intentionally kept
      // so that an in-session undo (restorePhoto) can fully recover the entry.
      // Call deleteOriginal() explicitly only when permanently purging storage.
      await LumenDB.put(db, 'photos', { ...rec, deleted: true, updatedAt: now() });
    }

    /* ── Edits ─────────────────────────────────────────────────────────── */

    async saveEdit(photoId, record) {
      const db = await this._db_();
      await LumenDB.put(db, 'edits', {
        ...record,
        photoId,
        updatedAt: now(),
      });
    }

    async getEdit(photoId) {
      return LumenDB.get(await this._db_(), 'edits', photoId);
    }

    /* ── Albums ────────────────────────────────────────────────────────── */

    async saveAlbum(album) {
      const db  = await this._db_();
      const rec = {
        ...album,
        id:        album.id || uid(),
        updatedAt: now(),
      };
      await LumenDB.put(db, 'albums', rec);
      return rec;
    }

    async listAlbums() {
      return LumenDB.getAll(await this._db_(), 'albums');
    }

    async deleteAlbum(id) {
      await LumenDB.del(await this._db_(), 'albums', id);
    }

    async addPhotoToAlbum(albumId, photoId, position = 0) {
      await LumenDB.put(await this._db_(), 'album_photos', {
        albumId, photoId, position,
      });
    }

    async removePhotoFromAlbum(albumId, photoId) {
      await LumenDB.del(await this._db_(), 'album_photos', [albumId, photoId]);
    }

    async getAlbumPhotos(albumId) {
      const rows = await LumenDB.getByIndex(
        await this._db_(), 'album_photos', 'byAlbum', albumId
      );
      return rows.sort((a, b) => a.position - b.position);
    }

    /* ── Presets ───────────────────────────────────────────────────────── */

    async savePreset(preset) {
      const db  = await this._db_();
      const rec = {
        ...preset,
        id:        preset.id || uid(),
        updatedAt: now(),
      };
      await LumenDB.put(db, 'presets', rec);
      return rec;
    }

    async listPresets() {
      return LumenDB.getAll(await this._db_(), 'presets');
    }

    async deletePreset(id) {
      await LumenDB.del(await this._db_(), 'presets', id);
    }

    /* ── Settings ──────────────────────────────────────────────────────── */

    async saveSetting(key, value) {
      await LumenDB.put(await this._db_(), 'settings', { key, value });
    }

    async loadSetting(key, fallback = null) {
      const rec = await LumenDB.get(await this._db_(), 'settings', key);
      return rec !== null ? rec.value : fallback;
    }

    /* ── Original blobs (local device only) ────────────────────────────── */
    //
    // These methods are only called from LumenStore.
    // The 'blobs' store is excluded from sync pathways.
    // Originals are never transmitted anywhere by this code.

    async storeOriginal(photoId, blob) {
      await LumenDB.put(await this._db_(), 'blobs', {
        photoId,
        blob,
        storedAt: now(),
      });
    }

    async loadOriginal(photoId) {
      const rec = await LumenDB.get(await this._db_(), 'blobs', photoId);
      return rec ? rec.blob : null;
    }

    async hasOriginal(photoId) {
      const rec = await LumenDB.get(await this._db_(), 'blobs', photoId);
      return rec !== null;
    }

    async deleteOriginal(photoId) {
      await LumenDB.del(await this._db_(), 'blobs', photoId);
    }
  }

  global.LocalProvider = LocalProvider;

})(window);
