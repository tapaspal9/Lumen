/* ============================================================================
 * Lumen — EXIF reader + privacy / re-injection
 * Parses the APP1/TIFF block of a JPEG for camera info, can null the GPS
 * pointer, and can re-inject the original metadata into a canvas-exported JPEG
 * (canvas re-encoding otherwise strips all metadata).
 * ==========================================================================*/
(function (global) {
  'use strict';

  function parse(buffer) {
    try {
      const dv = new DataView(buffer);
      if (dv.getUint16(0) !== 0xFFD8) return null;          // not a JPEG
      let off = 2, app1Start = -1, app1Len = 0;
      while (off < dv.byteLength - 2) {
        const marker = dv.getUint16(off);
        if ((marker & 0xFF00) !== 0xFF00) break;
        if (marker === 0xFFDA) break;                        // start of scan
        const size = dv.getUint16(off + 2);
        if (marker === 0xFFE1 && dv.getUint32(off + 4) === 0x45786966) { // "Exif"
          app1Start = off; app1Len = size + 2; break;
        }
        off += 2 + size;
      }
      if (app1Start < 0) return null;
      const app1 = new Uint8Array(buffer.slice(app1Start, app1Start + app1Len));

      const tiff = app1Start + 10;
      const little = dv.getUint16(tiff) === 0x4949;
      const g16 = o => dv.getUint16(o, little);
      const g32 = o => dv.getUint32(o, little);
      const readVal = (type, count, valOff) => {
        if (type === 2) { const o = count > 4 ? tiff + g32(valOff) : valOff; let s = ''; for (let i = 0; i < count - 1; i++) { const c = dv.getUint8(o + i); if (!c) break; s += String.fromCharCode(c); } return s.trim(); }
        if (type === 3) return g16(count > 2 ? tiff + g32(valOff) : valOff);
        if (type === 4) return g32(count > 1 ? tiff + g32(valOff) : valOff);
        if (type === 5) { const o = tiff + g32(valOff); const d = g32(o + 4) || 1; return g32(o) / d; }
        if (type === 10) { const o = tiff + g32(valOff); const d = dv.getInt32(o + 4, little) || 1; return dv.getInt32(o, little) / d; }
        return null;
      };
      const t0 = {}, te = {};
      let exifIFD = 0, gpsOff = -1;
      function ifd(base, into) {
        const n = g16(base);
        for (let i = 0; i < n; i++) {
          const e = base + 2 + i * 12, tag = g16(e), type = g16(e + 2), count = g32(e + 4), valOff = e + 8;
          into[tag] = readVal(type, count, valOff);
          if (tag === 0x8769) exifIFD = tiff + g32(valOff);
          if (tag === 0x8825) gpsOff = valOff - app1Start;     // offset of GPS pointer within app1
        }
      }
      ifd(tiff + g32(tiff + 4), t0);
      if (exifIFD) ifd(exifIFD, te);

      const fields = {
        Make: t0[0x010F], Model: t0[0x0110], LensModel: te[0xA434],
        ISO: te[0x8827], ExposureTime: te[0x829A], FNumber: te[0x829D],
        FocalLength: te[0x920A], DateTime: te[0x9003] || t0[0x0132]
      };
      return { fields, app1, hasGPS: gpsOff >= 0, gpsOff };
    } catch (e) { return null; }
  }

  // zero the GPS IFD pointer so viewers find no location data
  function stripGPS(app1, gpsOff) {
    const a = app1.slice();
    if (gpsOff >= 0) { a[gpsOff] = a[gpsOff + 1] = a[gpsOff + 2] = a[gpsOff + 3] = 0; }
    return a;
  }

  // insert an APP1 (FFE1…) segment right after SOI of a JPEG blob
  async function inject(blob, app1) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return blob;
    const out = new Uint8Array(2 + app1.length + (buf.length - 2));
    out.set([0xFF, 0xD8], 0);
    out.set(app1, 2);
    out.set(buf.subarray(2), 2 + app1.length);
    return new Blob([out], { type: 'image/jpeg' });
  }

  // human-readable formatting helpers
  function fmtExposure(t) {
    if (t == null) return null;
    if (t >= 1) return t.toFixed(1) + 's';
    return '1/' + Math.round(1 / t) + 's';
  }
  function fmtAperture(f) { return f == null ? null : 'ƒ/' + (Math.round(f * 10) / 10); }

  global.Exif = { parse, stripGPS, inject, fmtExposure, fmtAperture };
})(window);
