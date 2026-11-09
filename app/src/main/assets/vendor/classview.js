/* Cyber Hub Manager — Java .class (JVM bytecode) metadata parser.
 * Reads the class-file structure only (never executes or decompiles code), so a
 * .class inside a JAR / DEX-derived archive can be inspected offline. Follows
 * the JVMS class-file format. Works in the WebView and in Node for the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.CyberClassView = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function bytesFromBase64(b64) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(String(b64), 'base64'));
    var bin = root.atob(String(b64)), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
    return out;
  }
  function u1(b, o) { return b[o] & 255; }
  function u2(b, o) { return ((b[o] & 255) << 8) | (b[o + 1] & 255); }
  function u4(b, o) { return (((b[o] & 255) << 24) | ((b[o + 1] & 255) << 16) | ((b[o + 2] & 255) << 8) | (b[o + 3] & 255)) >>> 0; }

  /* Modified UTF-8: 1/2/3-byte sequences; surrogate pairs for supplementary
   * characters are merged so CJK/emoji in string constants stay readable. */
  function decodeMutf8(b, o, len) {
    var out = '', end = o + len, c;
    while (o < end) {
      var x = b[o++];
      if (x < 0x80) { c = x; }
      else if ((x & 0xe0) === 0xc0) { c = ((x & 0x1f) << 6) | (b[o++] & 0x3f); }
      else if ((x & 0xf0) === 0xe0) { c = ((x & 0x0f) << 12) | ((b[o++] & 0x3f) << 6) | (b[o++] & 0x3f); }
      else { c = 0xfffd; }
      if (c >= 0xd800 && c <= 0xdbff && o + 2 < end && (b[o] & 0xf0) === 0xe0) {
        var lo = ((b[o] & 0x0f) << 12) | ((b[o + 1] & 0x3f) << 6) | (b[o + 2] & 0x3f);
        if (lo >= 0xdc00 && lo <= 0xdfff) { o += 3; c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00); }
      }
      out += c > 0xffff ? String.fromCharCode(0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff)) : String.fromCharCode(c);
    }
    return out;
  }

  var CLASS_ACC = [
    [0x0001, 'public'], [0x0010, 'final'], [0x0020, 'super'], [0x0200, 'interface'],
    [0x0400, 'abstract'], [0x1000, 'synthetic'], [0x2000, 'annotation'], [0x4000, 'enum'], [0x8000, 'module']
  ];
  var MEMBER_ACC = [
    [0x0001, 'public'], [0x0002, 'private'], [0x0004, 'protected'], [0x0008, 'static'],
    [0x0010, 'final'], [0x0020, 'synchronized'], [0x0040, 'bridge/volatile'], [0x0080, 'varargs/transient'],
    [0x0100, 'native'], [0x0400, 'abstract'], [0x0800, 'strictfp'], [0x1000, 'synthetic']
  ];
  function flags(v, table) { var r = []; for (var i = 0; i < table.length; i++) if (v & table[i][0]) r.push(table[i][1]); return r; }

  /* major version -> JDK (45=1.1 .. 49=5, then major-44). */
  function jdkVersion(major) {
    if (major < 45) return '未知（major ' + major + '）';
    if (major <= 48) return 'JDK 1.' + (major - 44);
    return 'Java ' + (major - 44) + '（major ' + major + '）';
  }

  /* Field/method descriptor -> readable. Returns {text, params, ret}. */
  function descriptorType(d, p) {
    var arr = 0;
    while (d[p] === '[') { arr++; p++; }
    var base, np;
    switch (d[p]) {
      case 'B': base = 'byte'; np = p + 1; break;
      case 'C': base = 'char'; np = p + 1; break;
      case 'D': base = 'double'; np = p + 1; break;
      case 'F': base = 'float'; np = p + 1; break;
      case 'I': base = 'int'; np = p + 1; break;
      case 'J': base = 'long'; np = p + 1; break;
      case 'S': base = 'short'; np = p + 1; break;
      case 'Z': base = 'boolean'; np = p + 1; break;
      case 'V': base = 'void'; np = p + 1; break;
      case 'L': {
        var e = d.indexOf(';', p);
        if (e < 0) { base = d.slice(p + 1); np = d.length; }
        else { base = d.slice(p + 1, e).replace(/\//g, '.'); np = e + 1; }
        break;
      }
      default: base = d[p] || '?'; np = p + 1;
    }
    for (var i = 0; i < arr; i++) base += '[]';
    return { text: base, next: np };
  }
  function fieldType(desc) { return descriptorType(desc, 0).text; }
  function methodSignature(desc) {
    var p = 0, params = [];
    if (desc[0] === '(') {
      p = 1;
      while (p < desc.length && desc[p] !== ')') { var r = descriptorType(desc, p); params.push(r.text); p = r.next; }
      if (desc[p] === ')') p++;
    }
    var ret = p < desc.length ? descriptorType(desc, p).text : 'void';
    return { params: params, ret: ret, text: '(' + params.join(', ') + ') → ' + ret };
  }

  function parse(bytes) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var out = {
      valid: false, error: '', size: b.length, magic: '', minor: 0, major: 0, jdk: '',
      constantPoolCount: 0, access: 0, accessFlags: [], thisClass: '', superClass: '',
      interfaces: [], fields: [], methods: [], sourceFile: '', attributes: [], utf8: []
    };
    if (b.length < 10) { out.error = '文件过短，不是有效的 .class 文件'; return out; }
    out.magic = u4(b, 0).toString(16).toUpperCase().padStart(8, '0');
    if (u4(b, 0) !== 0xCAFEBABE) { out.error = '不是有效的 .class 文件（魔数应为 CAFEBABE，实为 ' + out.magic + '）'; return out; }
    try {
      out.minor = u2(b, 4); out.major = u2(b, 6); out.jdk = jdkVersion(out.major);
      var cpCount = u2(b, 8); out.constantPoolCount = cpCount;
      /* cp[i] = {tag, ...}; Long/Double occupy two slots. */
      var cp = new Array(cpCount), pos = 10;
      for (var i = 1; i < cpCount; i++) {
        var tag = u1(b, pos++), e = { tag: tag };
        switch (tag) {
          case 1: { var len = u2(b, pos); pos += 2; e.value = decodeMutf8(b, pos, len); pos += len; out.utf8.push(e.value); break; }
          case 7: case 8: case 16: case 19: case 20: e.index = u2(b, pos); pos += 2; break;
          case 15: e.kind = u1(b, pos); e.index = u2(b, pos + 1); pos += 3; break;
          case 3: case 4: e.raw = u4(b, pos); pos += 4; break;
          case 5: case 6: e.rawHi = u4(b, pos); e.rawLo = u4(b, pos + 4); pos += 8; i++; break;
          case 9: case 10: case 11: case 12: case 17: case 18: e.a = u2(b, pos); e.c = u2(b, pos + 2); pos += 4; break;
          default: throw new Error('未知常量池标签 ' + tag + '（偏移 ' + (pos - 1) + '）');
        }
        cp[i] = e;
      }
      function utf8(idx) { var e = cp[idx]; return e && e.tag === 1 ? e.value : ''; }
      function className(idx) { var e = cp[idx]; if (!e || e.tag !== 7) return ''; var n = utf8(e.index); return n.replace(/\//g, '.'); }
      out.access = u2(b, pos); pos += 2; out.accessFlags = flags(out.access, CLASS_ACC);
      var thisIdx = u2(b, pos); pos += 2;
      var superIdx = u2(b, pos); pos += 2;
      out.thisClass = className(thisIdx) || utf8(thisIdx);
      out.superClass = superIdx ? (className(superIdx) || utf8(superIdx)) : '（无，java.lang.Object 或无父类）';
      var ic = u2(b, pos); pos += 2;
      for (var k = 0; k < ic; k++) { out.interfaces.push(className(u2(b, pos)) || utf8(u2(b, pos))); pos += 2; }

      function readMembers(isMethod) {
        var count = u2(b, pos); pos += 2;
        var list = [];
        for (var m = 0; m < count; m++) {
          var acc = u2(b, pos), name = utf8(u2(b, pos + 2)), desc = utf8(u2(b, pos + 4));
          var ac = u2(b, pos + 6); pos += 8;
          var codeLen = 0, item = { access: acc, accessFlags: flags(acc, MEMBER_ACC), name: name, descriptor: desc };
          for (var a = 0; a < ac; a++) {
            var an = utf8(u2(b, pos)), al = u4(b, pos + 2), data = pos + 6; pos = data + al;
            /* Code attribute: max_stack(2) + max_locals(2) + code_length(4). */
            if (an === 'Code' && al >= 8) codeLen = u4(b, data + 4);
          }
          if (isMethod) item.signature = methodSignature(desc);
          else item.type = fieldType(desc);
          if (codeLen) item.codeLength = codeLen;
          list.push(item);
        }
        return list;
      }
      out.fields = readMembers(false);
      out.methods = readMembers(true);

      var attrCount = u2(b, pos); pos += 2;
      for (var x = 0; x < attrCount; x++) {
        var name2 = utf8(u2(b, pos)), len2 = u4(b, pos + 2); pos += 6;
        if (name2 === 'SourceFile' && len2 >= 2) out.sourceFile = utf8(u2(b, pos));
        out.attributes.push({ name: name2, length: len2 });
        pos += len2;
      }
      out.valid = true;
    } catch (err) { out.error = '解析中断：' + (err && err.message ? err.message : String(err)); }
    return out;
  }

  return {
    parseBytes: parse,
    parseBase64: function (b64) { return parse(bytesFromBase64(b64)); },
    fieldType: fieldType,
    methodSignature: methodSignature,
    jdkVersion: jdkVersion
  };
});
