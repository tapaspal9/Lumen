/* ============================================================================
 * Lumen — IStorageProvider  (js/core/storage-provider.js)
 *
 * The contract every storage backend must satisfy.
 *
 *   LocalProvider  → IndexedDB on this device (Phase 0)
 *   CloudProvider  → Supabase Postgres + Storage (Phase 4, future)
 *
 * RULE: the imaging engine and all UI controllers NEVER call IndexedDB
 *       directly. Every read/write flows through this interface.
 *       Swapping backends requires changing exactly one line of code
 *       (the provider constructor in app.js).
 *
 * All methods are async and must return a resolved Promise.
 * Methods that have no meaningful return value resolve with undefined.
 * ============================================================================ */

(function (global) {
  'use strict';

  class IStorageProvider {

    /* ── Photos ──────────────────────────────────────────────────────────── */

    /** Upsert a photo metadata record. Returns the saved record (with id set). */
    async savePhoto(photo)  { this._ni('savePhoto'); }

    /** Return a single photo record by id, or null if not found. */
    async getPhoto(id)      { this._ni('getPhoto'); }

    /** Return all non-deleted photo records, newest first. */
    async listPhotos()      { this._ni('listPhotos'); }

    /**
     * Soft-delete a photo: sets deleted=true, updatedAt=now.
     * Also removes the original blob from this device.
     * The record is kept as a sync tombstone — hard delete happens server-side.
     */
    async deletePhoto(id)   { this._ni('deletePhoto'); }

    /* ── Edits (non-destructive) ─────────────────────────────────────────── */

    /**
     * Upsert an edit record for a photo.
     * @param {string} photoId
     * @param {{ params, crop, preset, strength }} record
     */
    async saveEdit(photoId, record)  { this._ni('saveEdit'); }

    /** Return the edit record for a photo, or null if the photo is unedited. */
    async getEdit(photoId)           { this._ni('getEdit'); }

    /* ── Albums ──────────────────────────────────────────────────────────── */

    /** Upsert an album. Returns the saved record. */
    async saveAlbum(album)                               { this._ni('saveAlbum'); }

    /** Return all albums. */
    async listAlbums()                                   { this._ni('listAlbums'); }

    /** Delete an album (and its album_photos entries). */
    async deleteAlbum(id)                                { this._ni('deleteAlbum'); }

    /** Add a photo to an album at the given sort position. */
    async addPhotoToAlbum(albumId, photoId, position)    { this._ni('addPhotoToAlbum'); }

    /** Remove a photo from an album. */
    async removePhotoFromAlbum(albumId, photoId)         { this._ni('removePhotoFromAlbum'); }

    /** Return all photo membership rows for an album, sorted by position. */
    async getAlbumPhotos(albumId)                        { this._ni('getAlbumPhotos'); }

    /* ── Presets ─────────────────────────────────────────────────────────── */

    /** Upsert a preset. Returns the saved record. */
    async savePreset(preset)  { this._ni('savePreset'); }

    /** Return all user presets. Built-in presets stay in presets.js. */
    async listPresets()       { this._ni('listPresets'); }

    /** Delete a user preset by id. */
    async deletePreset(id)    { this._ni('deletePreset'); }

    /* ── App settings ────────────────────────────────────────────────────── */

    /** Persist any app setting under a string key. Value is JSON-serialisable. */
    async saveSetting(key, value)          { this._ni('saveSetting'); }

    /** Load a setting by key. Returns fallback if the key doesn't exist. */
    async loadSetting(key, fallback)       { this._ni('loadSetting'); }

    /* ── Original blobs — LOCAL DEVICE ONLY ─────────────────────────────── */
    //
    // These four methods are intentionally excluded from any sync logic.
    // Original photo bytes live only on the device that imported them.
    // A CloudProvider that also implements this class must still route
    // these calls to local IndexedDB, not to the cloud.
    //
    // To optionally back up originals, a separate explicit opt-in flow is
    // used — never an automatic sync.

    /** Store the original File/Blob on this device only. */
    async storeOriginal(photoId, blob)  { this._ni('storeOriginal'); }

    /** Return the original blob, or null if this device doesn't have it. */
    async loadOriginal(photoId)         { this._ni('loadOriginal'); }

    /** Return true if this device has the original. */
    async hasOriginal(photoId)          { this._ni('hasOriginal'); }

    /** Remove the original from this device. Does not affect other devices. */
    async deleteOriginal(photoId)       { this._ni('deleteOriginal'); }

    /* ── Sync metadata — no-op on LocalProvider ─────────────────────────── */

    /**
     * Returns the cursor (timestamp) of the last successful sync,
     * or null if this device has never synced.
     */
    async getLastSyncCursor()           { return null; }

    /** Persist the sync cursor after a successful sync. */
    async setLastSyncCursor(cursor)     { /* no-op on local */ }

    /**
     * Returns locally-modified records not yet pushed to the cloud.
     * Used by the background sync engine (Phase 4).
     */
    async getPendingChanges()           { return []; }

    /* ── Internal ────────────────────────────────────────────────────────── */

    _ni(method) {
      throw new Error(
        `IStorageProvider.${method}: not implemented by ${this.constructor.name}`
      );
    }
  }

  global.IStorageProvider = IStorageProvider;

})(window);
