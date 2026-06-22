/* ============================================================================
 * Lumen — Imaging Web Worker
 * Runs Imaging.process() off the main thread so the UI stays smooth
 * during slider drags, batch operations, and heavy pixel workloads.
 *
 * Protocol:
 *   Main → Worker:  { srcBuf: ArrayBuffer, outBuf: ArrayBuffer,
 *                     width, height, params, id }  [srcBuf, outBuf transferred]
 *   Worker → Main:  { outBuf: ArrayBuffer, id }    [outBuf transferred back]
 * ==========================================================================*/
importScripts('../imaging.js');

self.onmessage = function (e) {
  const { srcBuf, outBuf, width, height, params, id } = e.data;
  try {
    // Reconstruct ImageData-like objects from transferred ArrayBuffers
    const src = new ImageData(new Uint8ClampedArray(srcBuf), width, height);
    const out = { data: new Uint8ClampedArray(outBuf), width, height };
    Imaging.process(src, params, out);
    // Transfer outBuf back — main thread takes ownership, zero-copy
    self.postMessage({ outBuf: out.data.buffer, id }, [out.data.buffer]);
  } catch (err) {
    // Send error signal so main thread can fall back to synchronous render
    self.postMessage({ error: err.message, id });
  }
};
