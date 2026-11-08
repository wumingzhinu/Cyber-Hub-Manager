/* Cyber Hub Manager — .9.png (nine-patch) metadata parser.
 * Reads PNG chunks only (never decodes pixels), so an APK resource can be
 * inspected offline. Works in the WebView and in Node for the smoke tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.CyberNinePatch = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  function u32(b, o) { return (((b[o] & 255) << 24) | ((b[o + 1] & 255) << 16) | ((b[o + 2] & 255) << 8) | (b[o + 3] & 255)) >>> 0; }
  function i32(b, o) { var v = u32(b, o); return v > 0x7fffffff ? v - 0x100000000 : v; }
 /* npTc / npOl / npLb payloads are little-endian int32 (PNG lengths are big-endian). */
 function i32le(b, o) { return ((b[o] & 255) | ((b[o + 1] & 255) << 8) | ((b[o + 2] & 255) << 16) | ((b[o + 3] & 255) << 24)) | 0; }
 function u32le(b, o) { return i32le(b, o) >>> 0; }
  function str(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }
  function bytesFromBase64(b64) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(String(b64), 'base64'));
    var bin = root.atob(String(b64)), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
    return out;
  }
  function bounds(b, o, len) {
    if (o + 16 > len) return null;
    return { left: i32le(b, o), top: i32le(b, o + 4), right: i32le(b, o + 8), bottom: i32le(b, o + 12) };
  }
  function parse(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var out = {
      valid: false, width: 0, height: 0, bitDepth: 0, colorType: 0,
      chunks: [], hasNinePatch: false, stretchX: [], stretchY: [], colors: [],
      padding: null, optical: null, layoutBounds: null, error: ''
    };
    if (b.length < 8) { out.error = '文件过短，不是有效的 PNG'; return out; }
    for (var i = 0; i < 8; i++) if (b[i] !== SIG[i]) { out.error = 'PNG 签名不匹配'; return out; }
    out.valid = true;
    var pos = 8, chunk = {};
    while (pos + 12 <= b.length) {
      var len = u32(b, pos), type = str(b, pos + 4);
      if (len < 0 || pos + 12 + len > b.length) { out.error = 'PNG 数据块被截断'; break; }
      var start = pos + 8;
      chunk[type] = { start: start, size: len };
      out.chunks.push({ type: type, size: len });
      if (type === 'IHDR' && len >= 13) {
        out.width = u32(b, start); out.height = u32(b, start + 4);
        out.bitDepth = b[start + 8]; out.colorType = b[start + 9];
      }
      pos += 12 + len;
      if (type === 'IEND') break;
    }
    var np = chunk.npTc;
    if (np && np.size >= 28) {
      out.hasNinePatch = true;
      var o = np.start, nx = b[o + 1] & 255, ny = b[o + 2] & 255, nc = b[o + 3] & 255;
      out.padding = { left: i32le(b, o + 12), right: i32le(b, o + 16), top: i32le(b, o + 20), bottom: i32le(b, o + 24) };
      var p = o + 28, need = (nx + ny + nc) * 4;
      if (p + need <= o + np.size) {
        for (var x = 0; x < nx; x++) out.stretchX.push(i32le(b, p + x * 4));
        p += nx * 4;
        for (var y = 0; y < ny; y++) out.stretchY.push(i32le(b, p + y * 4));
        p += ny * 4;
        for (var c = 0; c < nc; c++) out.colors.push(u32le(b, p + c * 4));
      } else {
        out.error = 'npTc 数据块长度不足，拉伸区可能不完整';
      }
    }
    if (chunk.npOl) out.optical = bounds(b, chunk.npOl.start, chunk.npOl.start + chunk.npOl.size);
    if (chunk.npOr) out.optical = out.optical || bounds(b, chunk.npOr.start, chunk.npOr.start + chunk.npOr.size);
    if (chunk.npLb) out.layoutBounds = bounds(b, chunk.npLb.start, chunk.npLb.start + chunk.npLb.size);
    if (chunk.npRb) out.layoutBounds = out.layoutBounds || bounds(b, chunk.npRb.start, chunk.npRb.start + chunk.npRb.size);
    return out;
  }
 function parseBase64(b64) { return parse(bytesFromBase64(b64)); }
 var CRC_TABLE = null;
 function crc32(b, start, len) {
  if (!CRC_TABLE) {
   CRC_TABLE = new Uint32Array(256);
   for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRC_TABLE[n] = c >>> 0; }
  }
  var v = 0xFFFFFFFF;
  for (var i = start; i < start + len; i++) v = CRC_TABLE[(v ^ b[i]) & 255] ^ (v >>> 8);
  return (v ^ 0xFFFFFFFF) >>> 0;
 }
 function w32(b, o, v) { b[o] = (v >>> 24) & 255; b[o + 1] = (v >>> 16) & 255; b[o + 2] = (v >>> 8) & 255; b[o + 3] = v & 255; }
 function buildChunk(xs, ys, pad) {
  var b = new Uint8Array(28 + (xs.length + ys.length) * 4), dv = new DataView(b.buffer);
  b[0] = 1; b[1] = xs.length & 255; b[2] = ys.length & 255; b[3] = 0;
  dv.setInt32(12, pad ? pad.left : 0, true); dv.setInt32(16, pad ? pad.right : 0, true);
  dv.setInt32(20, pad ? pad.top : 0, true); dv.setInt32(24, pad ? pad.bottom : 0, true);
  var p = 28;
  for (var i = 0; i < xs.length; i++) { dv.setInt32(p, Math.round(xs[i]), true); p += 4; }
  for (var j = 0; j < ys.length; j++) { dv.setInt32(p, Math.round(ys[j]), true); p += 4; }
  return b;
 }
 /* Replace (or insert) the npTc chunk with new stretch regions and recompute CRCs. */
 function editChunk(input, stretchX, stretchY, padding) {
  var b = typeof input === 'string' ? bytesFromBase64(input) : new Uint8Array(input);
  var xs = (stretchX || []).slice(), ys = (stretchY || []).slice();
  var pos = 8, chunks = [], insertAt = 1;
  while (pos + 12 <= b.length) {
   var len = u32(b, pos), type = str(b, pos + 4);
   if (len < 0 || pos + 12 + len > b.length) break;
   chunks.push({ type: type, data: b.slice(pos + 8, pos + 8 + len) });
   if (type === 'IHDR') insertAt = chunks.length;
   pos += 12 + len;
   if (type === 'IEND') break;
  }
  var np = buildChunk(xs, ys, padding || null), replaced = false;
  for (var i = 0; i < chunks.length; i++) if (chunks[i].type === 'npTc') { chunks[i].data = np; replaced = true; }
  if (!replaced) chunks.splice(insertAt, 0, { type: 'npTc', data: np });
  var total = 8;
  for (var i = 0; i < chunks.length; i++) total += 12 + chunks[i].data.length;
  var out = new Uint8Array(total); out.set(b.slice(0, 8), 0);
  var o = 8;
  for (var i = 0; i < chunks.length; i++) {
   var c = chunks[i], d = c.data;
   w32(out, o, d.length); o += 4;
   var head = new Uint8Array(4 + d.length);
   for (var j = 0; j < 4; j++) { out[o + j] = c.type.charCodeAt(j) & 255; head[j] = c.type.charCodeAt(j) & 255; }
   o += 4; out.set(d, o); head.set(d, 4); o += d.length;
   w32(out, o, crc32(head, 0, head.length)); o += 4;
  }
  return out;
 }
 function toBase64(b) {
  if (typeof Buffer !== 'undefined') return Buffer.from(b).toString('base64');
  var s = '';
  for (var i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
  return root.btoa(s);
 }
 return { parse: parse, parseBase64: parseBase64, editChunk: editChunk, toBase64: toBase64, crc32: crc32, u32: u32, i32: i32, i32le: i32le, u32le: u32le };
});
