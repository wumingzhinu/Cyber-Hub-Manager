/* Cyber Hub Manager — offline Markdown renderer + outline + KaTeX bridge.
 * Zero dependencies at parse time. KaTeX is loaded on demand and is optional:
 * when it is absent, math is shown as escaped code instead of failing.
 * Every piece of user text is HTML-escaped and every URL is allow-listed, so a
 * hostile .md file cannot inject script into the WebView. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.CyberMarkdown = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ENT[c]; }); }

  function safeUrl(u) {
    var s = String(u || '').trim();
    if (/^(https?:\/\/|mailto:|#|\/|\.\/|\.\.\/)/i.test(s)) return s;
    if (/^(data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,)/i.test(s)) return s;
    return '';
  }

  function mathHtml(tex, display) {
    var k = root && root.katex;
    if (k && typeof k.renderToString === 'function') {
      try { return k.renderToString(String(tex), { displayMode: !!display, throwOnError: false, trust: false, strict: 'ignore' }); }
      catch (e) { /* fall through to the escaped placeholder */ }
    }
    return '<code class="math' + (display ? ' math-block' : '') + '">' + esc(tex) + '</code>';
  }

  function inline(text) {
    var tokens = [];
    function stash(html) { tokens.push(html); return '\u0000' + (tokens.length - 1) + '\u0000'; }
    var s = esc(text);
    s = s.replace(/`([^`]+)`/g, function (m, c) { return stash('<code class="mdCode">' + c + '</code>'); });
    s = s.replace(/\$([^$\n]+)\$/g, function (m, tex) { return stash(mathHtml(tex, false)); });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (m, alt, url) {
      var u = safeUrl(url);
      if (!u) return stash('<span class="mdImage">[' + esc(alt) + ']</span>');
      return stash('<img class="mdImage" src="' + esc(u) + '" alt="' + alt + '">');
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, function (m, label, url) {
      var u = safeUrl(url);
      return u ? stash('<a href="' + esc(u) + '" rel="noopener noreferrer">' + label + '</a>') : stash(label);
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    s = s.replace(/\u0000(\d+)\u0000/g, function (m, i) { return tokens[Number(i)]; });
    return s;
  }

  function isFence(l) { return /^\s*```/.test(l); }
  function isTableSep(l) { return /^\s*\|?[\s:\-|]+\|?\s*$/.test(l) && /-/.test(l) && /\|/.test(l); }
  function splitRow(l) {
    var s = l.trim().replace(/^\|/, '').replace(/\|$/, '');
    return s.split('|').map(function (x) { return x.trim(); });
  }
  function alignOf(cell) {
    if (/^:-+:$/.test(cell)) return 'center';
    if (/^-+:$/.test(cell)) return 'right';
    if (/^:-+$/.test(cell)) return 'left';
    return '';
  }

  function outline(src) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n'), rows = [], head = 0, fence = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (isFence(l)) { fence = !fence; continue; }
      if (fence) continue;
      var m = /^(#{1,6})\s+(.*)$/.exec(l);
      if (m) rows.push({ level: m[1].length, text: m[2].replace(/\s+#+\s*$/, '').trim(), id: 'h-' + (++head), line: i });
    }
    return rows;
  }

  function render(src, options) {
    var opts = options || {}, lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [], head = 0, i = 0;
    function blockStart(l) {
      return isFence(l) || /^(#{1,6})\s+/.test(l) || /^\s*>/.test(l) ||
        /^\s*([-*+]|\d+\.)\s+/.test(l) || /^\s*\$\$/.test(l) ||
        /^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(l) || isTableSep(l);
    }
    while (i < lines.length) {
      var l = lines[i];
      if (!l.trim()) { i++; continue; }
      if (isFence(l)) {
        var lang = l.trim().slice(3).trim().replace(/[^\w+-]/g, ''), code = [];
        i++;
        while (i < lines.length && !isFence(lines[i])) { code.push(lines[i]); i++; }
        if (i < lines.length) i++;
        out.push('<pre class="mdPre"><code' + (lang ? ' class="lang-' + esc(lang) + '"' : '') + '>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }
      var hm = /^(#{1,6})\s+(.*)$/.exec(l);
      if (hm) {
        var level = hm[1].length, text = hm[2].replace(/\s+#+\s*$/, '').trim();
        out.push('<h' + level + ' class="mdH" id="h-' + (++head) + '">' + inline(text) + '</h' + level + '>');
        i++; continue;
      }
      if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(l)) { out.push('<hr class="mdHr">'); i++; continue; }
      if (/^\s*\$\$/.test(l)) {
        var tex = [l.replace(/^\s*\$\$/, '')];
        if (/\$\$\s*$/.test(l)) tex = [l.replace(/^\s*\$\$/, '').replace(/\$\$\s*$/, '')];
        else { i++; while (i < lines.length && !/\$\$\s*$/.test(lines[i])) { tex.push(lines[i]); i++; } if (i < lines.length) tex.push(lines[i].replace(/\$\$\s*$/, '')); }
        out.push('<div class="mdMath">' + mathHtml(tex.join('\n').replace(/^\$\$|\$\$$/g, '').trim(), true) + '</div>');
        i++; continue;
      }
      if (/^\s*>/.test(l)) {
        var quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out.push('<blockquote class="mdQuote">' + render(quote.join('\n'), opts) + '</blockquote>');
        continue;
      }
      if (/\|/.test(l) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        var headers = splitRow(l), aligns = splitRow(lines[i + 1]).map(alignOf);
        i += 2; var body = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { body.push(splitRow(lines[i])); i++; }
        var th = headers.map(function (c, n) { return '<th' + (aligns[n] ? ' style="text-align:' + aligns[n] + '"' : '') + '>' + inline(c) + '</th>'; }).join('');
        var tr = body.map(function (r) {
          return '<tr>' + headers.map(function (c, n) { return '<td' + (aligns[n] ? ' style="text-align:' + aligns[n] + '"' : '') + '>' + inline(r[n] == null ? '' : r[n]) + '</td>'; }).join('') + '</tr>';
        }).join('');
        out.push('<table class="mdTable"><thead><tr>' + th + '</tr></thead><tbody>' + tr + '</tbody></table>');
        continue;
      }
      if (/^\s*([-*+]|\d+\.)\s+/.test(l)) {
        var ordered = /^\s*\d+\./.test(l), items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          var m = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
          var content = m ? m[1] : '', task = /^\[([ xX])\]\s*/.exec(content);
          var prefix = task ? '<input type="checkbox" disabled' + (task[1].toLowerCase() === 'x' ? ' checked' : '') + '> ' : '';
          if (task) content = content.slice(task[0].length);
          items.push('<li class="mdLi">' + prefix + inline(content) + '</li>');
          i++;
        }
        out.push('<' + (ordered ? 'ol' : 'ul') + ' class="mdList">' + items.join('') + '</' + (ordered ? 'ol' : 'ul') + '>');
        continue;
      }
      var para = [l]; i++;
      while (i < lines.length && lines[i].trim() && !blockStart(lines[i])) { para.push(lines[i]); i++; }
      out.push('<p class="mdP">' + inline(para.join('\n')).replace(/\n/g, '<br>') + '</p>');
    }
    return out.join('\n');
  }

  return { render: render, outline: outline, esc: esc, inline: inline, mathHtml: mathHtml, safeUrl: safeUrl };
});
