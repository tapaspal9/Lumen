/* ============================================================================
 * Lumen — IndexedDB Schema & Helpers  (js/core/db.js)
 *
 * Opens the 'lumen' database at the current schema version and exposes
 * thin promise wrappers around the raw IDBObjectStore API.
 *
 * HOW TO ADD A NEW STORE OR INDEX:
 *   1. Bump DB_VERSION.
 *   2. Add a new `if (prev < N) { … }` block in onupgradeneeded.
 *   3. Never modify existing `if (prev < 1)` blocks — migrations are additive.
 *
 * Never call indexedDB directly from outside this module.
 * Use LumenDB.put / get / getAll / del / getByIndex.
 * ============================================================================ */

(function (global) {
  'use strict';

  const DB_NAME = 'lumen';
  const DB_VER  = 1;

  /* ── Open / upgrade ──────────────────────────────────────────────────────── */

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);

      req.onupgradeneeded = function (ev) {
        const db   = ev.target.result;
        const prev = ev.oldVersion;   // 0 = first install

        if (prev < 1) {
          /* photos — one row per imported photo, metadata only ─────────────── */
          const photos = db.createObjectStore('photos', { keyPath: 'id' });
          photos.createIndex('capturedAt', 'capturedAt', { unique: false });
          photos.createIndex('importedAt', 'importedAt', { unique: false });
          photos.createIndex('updatedAt',  'updatedAt',  { unique: false });
          photos.createIndex('deleted',    'deleted',    { unique: false });

          /* edits — one row per edited photo, keyed by photoId ─────────────── */
          db.createObjectStore('edits', { keyPath: 'photoId' });

          /* albums ─────────────────────────────────────────────────────────── */
          db.createObjectStore('albums', { keyPath: 'id' });

          /* album_photos — many-to-many, composite primary key ─────────────── */
          const ap = db.createObjectStore('album_photos', {
            keyPath: ['albumId', 'photoId'],
          });
          ap.createIndex('byAlbum', 'albumId', { unique: false });
          ap.createIndex('byPhoto', 'photoId', { unique: false });

          /* presets — user-saved and built-in ─────────────────────────────── */
          db.createObjectStore('presets', { keyPath: 'id' });

          /* settings — arbitrary key/value pairs ──────────────────────────── */
          db.createObjectStore('settings', { keyPath: 'key' });

          /* blobs — original photo files, LOCAL ONLY, never synced ─────────── */
          db.createObjectStore('blobs', { keyPath: 'photoId' });
        }

        // Future migrations — add `if (prev < 2) { … }` blocks here.
        // Never touch the `if (prev < 1)` block above.
      };

      req.onsuccess = ev => resolve(ev.target.result);
      req.onerror   = ev => reject(ev.target.error);
      req.onblocked = ()  => reject(
        new Error('LumenDB: database blocked — close other Lumen tabs and retry')
      );
    });
  }

  /* ── Generic helpers ─────────────────────────────────────────────────────── */

  /** Insert or update a record. Returns the record's key. */
  function put(db, storeName, value) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  /** Return a record by primary key, or null if not found. */
  function get(db, storeName, key) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror   = () => reject(req.error);
    });
  }

  /** Return all records in a store. */
  function getAll(db, storeName) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  /** Delete a record by primary key (or composite key array). */
  function del(db, storeName, key) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  /** Return all records matching an index value. */
  function getByIndex(db, storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const idx = tx.objectStore(storeName).index(indexName);
      const req = idx.getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  global.LumenDB = { openDB, put, get, getAll, del, getByIndex };

})(window);
