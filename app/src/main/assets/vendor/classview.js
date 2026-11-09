/* Cyber Hub Manager — Java .class (JVM bytecode) parser + MT-style disassembler.
 * Reads the class-file structure only (never executes or decompiles code), so a
 * .class inside a JAR / DEX-derived archive can be inspected offline. Follows
 * the JVMS class-file format. Works in the WebView and in Node for the tests.
 *
 * r10: parse() now also keeps the Code attribute bytes, and disassemble() turns
 * them into an editable, syntax-highlightable bytecode listing (package / class
 * header, fields, method headers with max_stack + max_locals, one instruction
 * per line with jump labels and constant-pool reference notes) — the same kind
 * of text editor view MT Manager shows for .class files. It does NOT emit Java
 * source and does NOT write back into the .class file. */
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
  function i32(v) { return v | 0; }
  function f32(raw) { var dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, raw >>> 0); return dv.getFloat32(0); }
  function f64(hi, lo) { var dv = new DataView(new ArrayBuffer(8)); dv.setUint32(0, hi >>> 0); dv.setUint32(4, lo >>> 0); return dv.getFloat64(0); }
  function i64(hi, lo) { var v = (hi >>> 0) * 4294967296 + (lo >>> 0); return i32(hi) < 0 ? v - 18446744073709551616 : v; }

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

  /* r13: 修饰符词表对齐 MT2.26.11 的 assets/syntax/jasm.mtsx「keyword」词表：
   *   public private protected static final super interface abstract synthetic
   *   annotation enum native synchronized bridge varargs strict volatile transient
   *   open transitive mandated deprecated identity value
   * 关键差异：MT 用 strict（非 strictfp）；bridge/volatile 与 varargs/transient 在
   * 字段/方法上分别取义，不写 'bridge/volatile' 这类合并词。 */
  var CLASS_ACC = [
    [0x0001, 'public'], [0x0010, 'final'], [0x0020, 'super'], [0x0200, 'interface'],
    [0x0400, 'abstract'], [0x1000, 'synthetic'], [0x2000, 'annotation'], [0x4000, 'enum'], [0x8000, 'module']
  ];
  /* 字段专用：0x0040=volatile, 0x0080=transient（JVMS 4.5）。 */
  var FIELD_ACC = [
    [0x0001, 'public'], [0x0002, 'private'], [0x0004, 'protected'], [0x0008, 'static'],
    [0x0010, 'final'], [0x0040, 'volatile'], [0x0080, 'transient'], [0x1000, 'synthetic']
  ];
  /* 方法专用：0x0040=bridge, 0x0080=varargs, 0x0800=strict（JVMS 4.6）。 */
  var METHOD_ACC = [
    [0x0001, 'public'], [0x0002, 'private'], [0x0004, 'protected'], [0x0008, 'static'],
    [0x0010, 'final'], [0x0020, 'synchronized'], [0x0040, 'bridge'], [0x0080, 'varargs'],
    [0x0100, 'native'], [0x0400, 'abstract'], [0x0800, 'strict'], [0x1000, 'synthetic']
  ];
  var MEMBER_ACC = METHOD_ACC;   /* 兼容旧引用（方法上下文） */
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

  /* ---- Constant-pool resolver (shared by parse and disassemble) ---- */
  function cpUtf8(cp, idx) { var e = cp[idx]; return e && e.tag === 1 ? e.value : ''; }
  function cpRawClass(cp, idx) { var e = cp[idx]; return e && e.tag === 7 ? cpUtf8(cp, e.index) : ''; }
  function cpClassName(cp, idx) { return cpRawClass(cp, idx).replace(/\//g, '.'); }
  function quoteMember(n) { return /^[A-Za-z_$][\w$]*$/.test(n) ? n : '"' + String(n).replace(/"/g, '\\"') + '"'; }
  function cpValue(cp, idx) {
    var e = cp[idx];
    if (!e) return '#' + idx;
    switch (e.tag) {
      case 1: return '"' + e.value + '"';
      case 3: return String(i32(e.raw));
      case 4: return String(f32(e.raw)) + 'f';
      case 5: return String(i64(e.rawHi, e.rawLo)) + 'L';
      case 6: return String(f64(e.rawHi, e.rawLo)) + 'd';
      case 7: return 'Class ' + cpRawClass(cp, idx);
      case 8: return '"' + cpUtf8(cp, e.index) + '"';
      case 15: return 'MethodHandle kind=' + e.kind + ' #' + e.index;
      case 16: return 'MethodType ' + cpUtf8(cp, e.index);
      case 19: case 20: return cpUtf8(cp, e.index);
      default: return '#' + idx;
    }
  }
  /* MT-style reference note shown to the right of an instruction. */
  function cpRef(cp, idx) {
    var e = cp[idx];
    if (!e) return '#' + idx;
    if (e.tag === 9 || e.tag === 10 || e.tag === 11) {
      var owner = cpRawClass(cp, e.a) || cpClassName(cp, e.a);
      var nt = cp[e.c] || {}, n = cpUtf8(cp, nt.a) || '?', d = cpUtf8(cp, nt.c) || '?';
      return (e.tag === 9 ? 'Field ' : (e.tag === 11 ? 'InterfaceMethod ' : 'Method ')) +
        owner + '.' + quoteMember(n) + ':"' + d + '";';
    }
    if (e.tag === 17 || e.tag === 18) {
      var n2 = cp[e.c] || {};
      return 'Dynamic #' + e.a + ' ' + quoteMember(cpUtf8(cp, n2.a)) + ':"' + cpUtf8(cp, n2.c) + '"';
    }
    if (e.tag === 12) return 'NameAndType ' + cpUtf8(cp, e.a) + ':"' + cpUtf8(cp, e.c) + '"';
    return cpValue(cp, idx);
  }
  function makeResolver(cp) {
    return {
      cp: cp,
      utf8: function (i) { return cpUtf8(cp, i); },
      className: function (i) { return cpClassName(cp, i); },
      rawClass: function (i) { return cpRawClass(cp, i); },
      ref: function (i) { return cpRef(cp, i); },
      value: function (i) { return cpValue(cp, i); }
    };
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
      var r = makeResolver(cp), utf8 = r.utf8, className = r.className;
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
          /* r13: 字段与方法分别取义（volatile/transient vs bridge/varargs）。 */
          var accTable = isMethod ? METHOD_ACC : FIELD_ACC;
          var codeLen = 0, item = { access: acc, accessFlags: flags(acc, accTable), name: name, descriptor: desc };
          for (var a = 0; a < ac; a++) {
            var an = utf8(u2(b, pos)), al = u4(b, pos + 2), data = pos + 6; pos = data + al;
            /* Code attribute: max_stack(2) + max_locals(2) + code_length(4) + code[]. */
            if (an === 'Code' && al >= 8) {
              codeLen = u4(b, data + 4);
              item.code = { maxStack: u2(b, data), maxLocals: u2(b, data + 2), start: data + 8, length: codeLen };
            }
            if (an === 'Exceptions' && al >= 2) {
              var ec = u2(b, data), ex = [];
              for (var ei = 0; ei < ec; ei++) ex.push(className(u2(b, data + 2 + ei * 2)));
              item.exceptions = ex;
            }
            if (an === 'ConstantValue' && al >= 2) item.constantValue = r.value(u2(b, data));
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
        /* r12: 记录属性数据起始偏移，供 disassemble() 渲染 MT 风格类属性块。 */
        out.attributes.push({ name: name2, length: len2, offset: pos });
        pos += len2;
      }
      /* Non-enumerable internals for disassemble(); kept off JSON.stringify. */
      Object.defineProperty(out, '_cp', { value: cp, enumerable: false });
      Object.defineProperty(out, '_bytes', { value: b, enumerable: false });
      Object.defineProperty(out, '_resolve', { value: r, enumerable: false });
      out.valid = true;
    } catch (err) { out.error = '解析中断：' + (err && err.message ? err.message : String(err)); }
    return out;
  }

  /* ---- JVM opcode table (JVMS 4.10) ----
   * r13: 助记符严格对齐 MT2.26.11 反编译出的 Jasmin opcode 表（classes*.dex 内
   * "00 - nop;01 - aconst_null;…;2a 0 aload_0;…"）与官方语法定义
   * assets/syntax/jasm.mtsx 的 opcode 词表 —— 全部是标准小写 aconst_null /
   * aload_0 / istore_1。r10–r12 使用的 camelCase aLoad_0 / aConst_null 是
   * 自创拼写，MT 全库零命中，本轮据反编译证据纠正。kind 描述操作数字节。 */
  var ATYPE = { 4: 'boolean', 5: 'char', 6: 'float', 7: 'double', 8: 'byte', 9: 'short', 10: 'int', 11: 'long' };
  var OPS = (function () {
    var t = new Array(256);
    function set(op, name, kind) { t[op] = [name, kind || '']; }
    set(0x00, 'nop'); set(0x01, 'aconst_null'); set(0x02, 'iconst_m1');
    for (var i = 0; i <= 5; i++) set(0x03 + i, 'iconst_' + i);
    set(0x09, 'lconst_0'); set(0x0a, 'lconst_1');
    set(0x0b, 'fconst_0'); set(0x0c, 'fconst_1'); set(0x0d, 'fconst_2');
    set(0x0e, 'dconst_0'); set(0x0f, 'dconst_1');
    set(0x10, 'bipush', 's1'); set(0x11, 'sipush', 's2');
    set(0x12, 'ldc', 'cp1'); set(0x13, 'ldc_w', 'cp2'); set(0x14, 'ldc2_w', 'cp2');
    [['i', 'iload'], ['l', 'lload'], ['f', 'fload'], ['d', 'dload'], ['a', 'aload']].forEach(function (p, k) {
      set(0x15 + k, p[1], 'u1');
      for (var n = 0; n <= 3; n++) set(0x1a + k * 4 + n, p[1] + '_' + n);
    });
    ['iaload', 'laload', 'faload', 'daload', 'aaload', 'baload', 'caload', 'saload'].forEach(function (n, k) { set(0x2e + k, n); });
    [['i', 'istore'], ['l', 'lstore'], ['f', 'fstore'], ['d', 'dstore'], ['a', 'astore']].forEach(function (p, k) {
      set(0x36 + k, p[1], 'u1');
      for (var n = 0; n <= 3; n++) set(0x3b + k * 4 + n, p[1] + '_' + n);
    });
    ['iastore', 'lastore', 'fastore', 'dastore', 'aastore', 'bastore', 'castore', 'sastore'].forEach(function (n, k) { set(0x4f + k, n); });
    ['pop', 'pop2', 'dup', 'dup_x1', 'dup_x2', 'dup2', 'dup2_x1', 'dup2_x2', 'swap'].forEach(function (n, k) { set(0x57 + k, n); });
    ['iadd', 'ladd', 'fadd', 'dadd', 'isub', 'lsub', 'fsub', 'dsub', 'imul', 'lmul', 'fmul', 'dmul',
      'idiv', 'ldiv', 'fdiv', 'ddiv', 'irem', 'lrem', 'frem', 'drem', 'ineg', 'lneg', 'fneg', 'dneg',
      'ishl', 'lshl', 'ishr', 'lshr', 'iushr', 'lushr', 'iand', 'land', 'ior', 'lor', 'ixor', 'lxor'].forEach(function (n, k) { set(0x60 + k, n); });
    set(0x84, 'iinc', 'iinc');
    ['i2l', 'i2f', 'i2d', 'l2i', 'l2f', 'l2d', 'f2i', 'f2l', 'f2d', 'd2i', 'd2l', 'd2f', 'i2b', 'i2c', 'i2s',
      'lcmp', 'fcmpl', 'fcmpg', 'dcmpl', 'dcmpg'].forEach(function (n, k) { set(0x85 + k, n); });
    ['ifeq', 'ifne', 'iflt', 'ifge', 'ifgt', 'ifle', 'if_icmpeq', 'if_icmpne', 'if_icmplt', 'if_icmpge',
      'if_icmpgt', 'if_icmple', 'if_acmpeq', 'if_acmpne', 'goto', 'jsr'].forEach(function (n, k) { set(0x99 + k, n, 'branch2'); });
    set(0xa9, 'ret', 'u1');
    set(0xaa, 'tableswitch', 'tableswitch'); set(0xab, 'lookupswitch', 'lookupswitch');
    ['ireturn', 'lreturn', 'freturn', 'dreturn', 'areturn', 'return'].forEach(function (n, k) { set(0xac + k, n); });
    set(0xb2, 'getstatic', 'cp2'); set(0xb3, 'putstatic', 'cp2');
    set(0xb4, 'getfield', 'cp2'); set(0xb5, 'putfield', 'cp2');
    set(0xb6, 'invokevirtual', 'cp2'); set(0xb7, 'invokespecial', 'cp2'); set(0xb8, 'invokestatic', 'cp2');
    set(0xb9, 'invokeinterface', 'cp2u1u1'); set(0xba, 'invokedynamic', 'cp2u2');
    set(0xbb, 'new', 'cp2'); set(0xbc, 'newarray', 'newarray'); set(0xbd, 'anewarray', 'cp2');
    set(0xbe, 'arraylength'); set(0xbf, 'athrow');
    set(0xc0, 'checkcast', 'cp2'); set(0xc1, 'instanceof', 'cp2');
    set(0xc2, 'monitorenter'); set(0xc3, 'monitorexit');
    set(0xc4, 'wide', 'wide'); set(0xc5, 'multianewarray', 'cp2u1');
    set(0xc6, 'ifnull', 'branch2'); set(0xc7, 'ifnonnull', 'branch2');
    set(0xc8, 'goto_w', 'branch4'); set(0xc9, 'jsr_w', 'branch4');
    set(0xca, 'breakpoint'); set(0xfe, 'impdep1'); set(0xff, 'impdep2');
    return t;
  })();

  /* Decode one instruction at code offset pc. b is the whole class file,
   * start is the absolute offset of code[0]. Returns size / mnemonic / operand
   * / note / targets (code-relative jump destinations). */
  function decodeInstr(b, start, len, pc, r) {
    var op = b[start + pc];
    if (op === undefined) return { size: 1, mnemonic: '.byte', operand: '0', note: '', targets: [] };
    var spec = OPS[op], m = spec ? spec[0] : 'unknown_' + op.toString(16), kind = spec ? spec[1] : '';
    var q = pc + 1, operand = '', note = '', targets = [];
    function byte() { return (b[start + q++] & 255); }
    function sbyte() { var v = byte(); return v > 127 ? v - 256 : v; }
    function s2() { var v = ((byte() << 8) | byte()); return v > 32767 ? v - 65536 : v; }
    function u2v() { return ((byte() << 8) | byte()); }
    function s4() { return (((byte() << 24) | (byte() << 16) | (byte() << 8) | byte()) | 0); }
    function cp2() { return u2v(); }
    function label(t) { targets.push(t); return 'L' + t.toString(16); }
    var idx, t, off, i, n;
    switch (kind) {
      case 's1': operand = String(sbyte()); break;
      case 's2': operand = String(s2()); break;
      case 'u1': operand = String(byte()); break;
      case 'cp1': idx = byte(); note = r.ref(idx); break;
      case 'cp2': idx = cp2(); note = r.ref(idx); break;
      case 'cp2u1': idx = cp2(); operand = String(byte()); note = r.ref(idx); break;
      case 'cp2u1u1': idx = cp2(); byte(); byte(); note = r.ref(idx); break;
      case 'cp2u2': idx = cp2(); byte(); byte(); note = r.ref(idx); break;
      case 'branch2': off = s2(); t = pc + off; operand = label(t); break;
      case 'branch4': off = s4(); t = pc + off; operand = label(t); break;
      case 'iinc': operand = byte() + ' ' + sbyte(); break;
      case 'newarray': operand = ATYPE[byte()] || '?'; break;
      case 'wide': {
        var op2 = b[start + q++], sp2 = OPS[op2];
        var sub = sp2 ? sp2[0] : 'op_' + (op2 || 0).toString(16);
        idx = u2v();
        if (op2 === 0x84) { operand = idx + ' ' + s2(); m = 'wide iinc'; }
        else { operand = String(idx); m = 'wide ' + sub; }
        break;
      }
      case 'tableswitch': {
        q += (4 - (q % 4)) % 4;                 /* 4-byte alignment relative to code[0] */
        var def = s4(), low = s4(), high = s4(), cnt = Math.max(0, high - low + 1), cases = [];
        label(def + pc);
        for (i = 0; i < cnt && i < 4096; i++) { off = s4(); t = pc + off; cases.push(label(t)); }
        operand = 'default L' + (pc + def).toString(16) + '  ' + low + '..' + high;
        note = 'cases ' + cnt + (cases.length ? ': ' + cases.slice(0, 3).join(', ') + (cases.length > 3 ? '…' : '') : '');
        break;
      }
      case 'lookupswitch': {
        q += (4 - (q % 4)) % 4;
        var d2 = s4(), np = s4(), keys = [];
        label(d2 + pc);
        for (i = 0; i < np && i < 4096; i++) { var match = s4(); off = s4(); t = pc + off; keys.push(match + '→' + label(t)); }
        operand = 'default L' + (pc + d2).toString(16) + '  pairs ' + np;
        note = keys.length ? keys.slice(0, 3).join(', ') + (keys.length > 3 ? '…' : '') : '';
        break;
      }
      default: break;
    }
    if (q - pc > len + 16) q = pc + 1;          /* defensive: never run past code[] */
    return { size: Math.max(1, q - pc), mnemonic: m, operand: operand, note: note, targets: targets };
  }

  function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
  function returnCode(d) {
    while (d.charAt(0) === '[') d = d.slice(1);
    if (d.charAt(0) === 'L') { var e = d.indexOf(';'), n = d.slice(1, e < 0 ? d.length : e); return n.split('/').pop(); }
    return ({ B: 'B', C: 'C', D: 'D', F: 'F', I: 'I', J: 'J', S: 'S', Z: 'Z', V: 'V' })[d.charAt(0)] || 'V';
  }
  function methodLabel(m) {
    if (/^</.test(m.name)) return '"' + m.name + '"';
    var d = m.descriptor || '()V', close = d.lastIndexOf(')');
    return m.name + '_' + returnCode(close >= 0 ? d.slice(close + 1) : 'V');
  }

  /* r13: 依据 MT2.26.11 反编译出的 ATT_* 属性全集，解出「能确定表示为文本」的
   * 类属性值。返回 null 表示该属性不渲染（结构型属性不臆造内容）。
   * 证据：classes4.dex 的 ATT_SourceFile / ATT_Signature / ATT_Deprecated /
   * ATT_Synthetic / ATT_EnclosingMethod / ATT_NestHost / ATT_NestMembers /
   * ATT_PermittedSubclasses / ATT_Record / ATT_InnerClasses / ATT_BootstrapMethods
   * 等常量；属性名与 jasm.mtsx declaration 词表一致。 */
  function classAttrValue(a, b, r, cp) {
    var o = a.offset, L = a.length;
    if (o === undefined || o + L > b.length) return null;
    var cl = function (idx) { return r.rawClass(idx) || ('#' + idx); };
    var utf = function (idx) { return r.utf8(idx); };
    switch (a.name) {
      case 'SourceFile':
      case 'Signature':
        return L >= 2 ? '"' + utf(u2(b, o)) + '"' : null;
      case 'Deprecated':
      case 'Synthetic':
        return 'true';
      case 'NestHost':                       /* u2: host class index */
        return L >= 2 ? '"' + cl(u2(b, o)) + '"' : null;
      case 'EnclosingMethod': {             /* u2 class + u2 NameAndType */
        if (L < 4) return null;
        var owner = cl(u2(b, o)), nt = cp[u2(b, o + 2)] || {};
        var nm = nt.a !== undefined ? utf(nt.a) : '', ds = nt.c !== undefined ? utf(nt.c) : '';
        return '"' + owner + (nm ? '.' + nm + ':"' + ds + '"' : '') + '"';
      }
      case 'NestMembers':
      case 'PermittedSubclasses': {         /* u2 count + u2[] class indexes */
        if (L < 2) return null;
        var n = u2(b, o), names = [];
        for (var i = 0; i < n && 2 + i * 2 + 1 < L; i++) names.push(cl(u2(b, o + 2 + i * 2)));
        return names.length ? '"' + names.join('", "') + '"' : null;
      }
      case 'SourceDebugExtension': {       /* raw UTF-8 bytes (JVMS 4.7.11) */
        var s = '', lim = Math.min(L, 4096);
        for (var j = 0; j < lim; j++) s += String.fromCharCode(b[o + j]);
        try { s = decodeURIComponent(escape(s)); } catch (e) { /* keep raw */ }
        return '"' + s.replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"';
      }
      /* InnerClasses / BootstrapMethods / Record / Module* / *Annotations /
       * StackMapTable / LineNumberTable / LocalVariable*Table / ConstantValue /
       * MethodParameters / AnnotationDefault 等为结构型属性；MT 会展开成多行
       * 子结构，此处不臆造，返回 null（保持 r12 的克制，避免输出无意义偏差）。 */
      default:
        return null;
    }
  }

  /* Turn a class file into the MT-style bytecode listing. */
  function disassemble(bytes) {
    var info = parse(bytes);
    var result = {
      valid: false, error: info.error, text: '', lines: 0, methodCount: 0,
      instructionCount: 0, labelCount: 0, magic: info.magic, major: info.major,
      className: info.thisClass, jdk: info.jdk
    };
    if (!info.valid || !info._bytes || !info._resolve) return result;
    var b = info._bytes, r = info._resolve, out = [];
    /* r12: 类头对齐 MT 管理器语法。用户实测样本（package-info.class）：
     *   package org/apache/commons/net/bsd;
     *
     *   synthetic interface package-info version 52:0
     *   {
     *     SourceFile               "package-info.java";
     *   } // end Class org/apache/commons/net/bsd/package-info
     * 差异点：包名保留 JVM 内部名的 '/'；修饰符前置 + 类型关键字 + 简单类名；
     * 版本写 major:minor；interface 隐含 abstract 不重复输出；{ } 包裹类体并列属性。 */
    var clsRaw = (info.thisClass || 'Unknown').replace(/\./g, '/');
    var sl = clsRaw.lastIndexOf('/'), pkg = sl > 0 ? clsRaw.slice(0, sl) : '';
    var simple = sl >= 0 ? clsRaw.slice(sl + 1) : clsRaw;
    if (pkg) { out.push('package ' + pkg + ';'); out.push(''); }
    var acc = info.access || 0, isIface = (acc & 0x0200) !== 0;
    var kind = (acc & 0x8000) ? 'module' : (acc & 0x4000) ? 'enum'
      : (isIface || (acc & 0x2000)) ? 'interface' : 'class';
    var skip = { 'interface': 1, 'annotation': 1, 'enum': 1, 'module': 1 };
    if (isIface) skip['abstract'] = 1;   /* interface 隐含 abstract，MT 不重复输出 */
    var mods = info.accessFlags.filter(function (f) { return !skip[f]; });
    out.push((mods.length ? mods.join(' ') + ' ' : '') + kind + ' ' + simple +
      ' version ' + info.major + ':' + info.minor);
    if (info.superClass && info.superClass !== 'java.lang.Object' && info.superClass.indexOf('（') < 0)
      out.push('extends ' + String(info.superClass).replace(/\./g, '/'));
    if (info.interfaces.length) out.push('implements ' + info.interfaces.join(', ').replace(/\./g, '/'));
    out.push('{');

    /* r13: 类属性块对齐 MT2.26.11 反编译出的 ATT_* 属性全集（classes4.dex 内
     * 36 个 ATT_* 常量 + assets/syntax/jasm.mtsx 的 declaration 词表）。
     * MT JASM printer 为类属性逐条输出一行：<属性名左对齐 24> <值>;
     * 只渲染能从原始字节确定解出的属性值；结构型属性（InnerClasses /
     * BootstrapMethods / Record / 注解表等）不臆造展开文本，保持 r12 的克制。 */
    var attrLines = [];
    (info.attributes || []).forEach(function (a) {
      var val = classAttrValue(a, b, r, info._cp);
      if (val !== null) attrLines.push('  ' + pad(a.name, 24) + ' ' + val + ';');
    });
    attrLines.forEach(function (l) { out.push(l); });
    if (attrLines.length) out.push('');

    for (var fi = 0; fi < info.fields.length; fi++) {
      var f = info.fields[fi];
      out.push((f.accessFlags.length ? f.accessFlags.join(' ') + ' ' : '') +
        'Field ' + f.name + ':"' + f.descriptor + '"' +
        (f.constantValue !== undefined ? ' = ' + f.constantValue : ''));
    }
    if (info.fields.length) out.push('');

    var totalInstr = 0, totalLabels = 0;
    for (var mi = 0; mi < info.methods.length; mi++) {
      var m = info.methods[mi];
      out.push((m.accessFlags.length ? m.accessFlags.join(' ') + ' ' : '') +
        'Method ' + methodLabel(m) + ':"' + m.descriptor + '"');
      if (m.exceptions && m.exceptions.length) out.push(' throws ' + m.exceptions.join(', '));
      if (m.code && m.code.length) {
        out.push(' stack ' + m.code.maxStack + ' locals ' + m.code.maxLocals);
        out.push('');
        var start = m.code.start, len = Math.min(m.code.length, b.length - start), decoded = [], pc = 0, targets = {};
        if (len > 0) {
          while (pc < len) {
            var d = decodeInstr(b, start, len, pc, r);
            decoded.push({ pc: pc, d: d });
            for (var ti = 0; ti < d.targets.length; ti++) targets[d.targets[ti]] = true;
            pc += d.size;
            if (decoded.length > 20000) break;   /* hard cap: stay responsive */
          }
        }
        for (var di = 0; di < decoded.length; di++) {
          var it = decoded[di], lab = targets[it.pc] ? pad('L' + it.pc.toString(16) + ':', 9) : '         ';
          /* MT-style columns: mnemonic | operand | constant-pool reference note */
          var body = pad(it.d.mnemonic, 24);
          if (it.d.operand) body += pad(it.d.operand, 12) + (it.d.note ? '  ' + it.d.note : '');
          else if (it.d.note) body += '  ' + it.d.note;
          out.push(lab + body.replace(/\s+$/, ''));
          totalInstr++;
        }
        totalLabels += Object.keys(targets).length;
        if (!decoded.length) out.push('         (no bytecode: abstract / native method)');
      }
      out.push('');
      out.push('');
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    /* r13: MT dumper 明文区分两种收尾（classes5.dex）：
     * "} // end Class " 普通类 / "} // end of module " module-info。
     * 证据：混淆类 l/᩶ܿۜ.smali 的 const-string 常量 :344 / :2658。 */
    var isModule = (info.access & 0x8000) !== 0;
    out.push((isModule ? '} // end of module ' : '} // end Class ') + clsRaw);
    result.methodCount = info.methods.length;
    result.instructionCount = totalInstr;
    result.labelCount = totalLabels;
    result.text = out.join('\n');
    result.lines = out.length;
    result.valid = true;
    result.error = '';
    return result;
  }

  return {
    parseBytes: parse,
    parseBase64: function (b64) { return parse(bytesFromBase64(b64)); },
    disassemble: disassemble,
    disassembleBytes: disassemble,
    disassembleBase64: function (b64) { return disassemble(bytesFromBase64(b64)); },
    fieldType: fieldType,
    methodSignature: methodSignature,
    jdkVersion: jdkVersion,
    opcodeCount: OPS.filter(function (x) { return !!x; }).length
  };
});
