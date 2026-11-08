/* Cyber Hub Manager — external language packs (MT-style lang-*.mtl equivalent).
 * Loaded synchronously as a plain script so the CSP stays script-src 'self'.
 * zh-CN values are byte-for-byte identical to the original on-screen strings;
 * t(key, fallback) always falls back to the original text when a pack/key is
 * missing, so an English pack can never break the default UI. */
(function (root) {
  'use strict';
  var zh = {
    'common.close': '关闭', 'common.cancel': '取消', 'common.ok': '确定',
    'common.save': '保存', 'common.delete': '删除', 'common.rename': '重命名',
    'common.copy': '复制', 'common.move': '移动', 'common.share': '分享',
    'common.refresh': '刷新', 'common.search': '搜索', 'common.properties': '属性',
    'common.openWith': '打开方式…', 'common.tools': '工具', 'common.settings': '设置',
    'common.about': '关于', 'common.language': '语言', 'common.preview': '预览',
    'common.back': '返回', 'common.help': '帮助', 'common.confirm': '确认',
    'common.all': '全部', 'common.none': '无', 'common.unknown': '未知',
    'common.left': '左侧', 'common.right': '右侧', 'common.same': '未变化',
    'common.added': '新增', 'common.removed': '已删除', 'common.changed': '已修改',
    'common.size': '大小', 'common.path': '路径', 'common.name': '名称',
    'common.status': '状态', 'common.closeTool': '关闭工具页',
    'common.readFailed': '读取失败', 'common.notAvailable': '不可用',

    'settings.title': '设置', 'settings.other': '其它', 'settings.appearance': '外观',
    'settings.language': '语言', 'settings.languageDesc': '界面语言，切换后立即生效',
    'settings.desktopIcon': '桌面图标', 'settings.desktopIconDesc': '切换应用图标，可能需要重新启动桌面',
    'settings.signatureCheck': '签名指纹自检', 'settings.signatureCheckDesc': '查看本应用与所选 APK 的证书指纹',
    'settings.iconDefault': '默认', 'settings.iconBlue': '极光蓝', 'settings.iconGreen': '矩阵绿',
    'settings.iconSwitched': '已切换应用图标；部分桌面需重新添加快捷方式',
    'settings.languageSwitched': '语言已切换；部分静态界面需重新打开',

    'preview.markdown': 'Markdown 预览', 'preview.markdownBuiltin': '预览 Markdown',
    'preview.font': '字体预览', 'preview.ninePatch': '九宫格信息',
    'preview.svgSource': '查看 SVG 源码', 'preview.outline': '大纲',
    'preview.loading': '正在加载预览…', 'preview.empty': '文件为空',
    'preview.math': '数学公式', 'preview.mathFallback': '未加载公式渲染组件',
    'preview.fontSample': '字体样张', 'preview.fontAlphabet': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789',
    'preview.fontCJK': '赛博中枢管家 · 文件管理器 · 中文字形预览',
    'preview.fontPunctuation': '，。！？：；「」『』（）【】《》—…·',
    'preview.fontSize': '字号', 'preview.fontInfo': '字体文件',
    'preview.fontUnsupported': '无法识别此字体格式',
    'preview.svgUnsafe': 'SVG 通过 <img> 隔离渲染，不执行脚本',
    'preview.ninePatchTitle': '.9.png 九宫格', 'preview.ninePatchNoChunk': '未找到 npTc 九宫格数据块（可能是未编译的源图或普通 PNG）',
    'preview.ninePatchStretchX': '水平拉伸区', 'preview.ninePatchStretchY': '垂直拉伸区',
    'preview.ninePatchPadding': '内容边距', 'preview.ninePatchOptical': '光学边界',
    'preview.ninePatchChunks': 'PNG 数据块', 'preview.ninePatchSize': '图片尺寸',
    'preview.ninePatchRaw': '源图含 1px 黑色边框时，需先由 aapt 编译为 npTc 数据块',

    'compare.folders': '对比文件夹', 'compare.panes': '对比两个窗格',
    'compare.folderTitle': '文件夹对比', 'compare.withHash': '比较内容（SHA-256）',
    'compare.onlyLeft': '仅左侧', 'compare.onlyRight': '仅右侧',
    'compare.different': '内容不同', 'compare.same': '相同',
    'compare.leftPath': '左文件夹', 'compare.rightPath': '右文件夹',
    'compare.needTwo': '请选择两个本地文件夹',
    'compare.limit': '结果已截断到前 2,000 项',
    'compare.bytes': '字节', 'compare.empty': '两个文件夹内容完全一致',
    'compare.hashOff': '仅按名称与大小比较', 'compare.hashOn': '按内容哈希比较',

    'sign.title': '签名指纹自检', 'sign.self': '本应用签名', 'sign.file': '所选 APK',
    'sign.sha256': 'SHA-256', 'sign.sha1': 'SHA-1', 'sign.md5': 'MD5',
    'sign.schemes': '签名方案', 'sign.verified': '校验通过', 'sign.notVerified': '校验未通过',
    'sign.noFile': '请先选择一个 APK 文件', 'sign.notSigned': '未签名或无法读取签名',
    'sign.issuer': '证书主题', 'sign.serial': '序列号',

    'media.probe': '媒体信息', 'media.title': '媒体信息探测',
    'media.duration': '时长', 'media.resolution': '分辨率', 'media.mime': 'MIME 类型',
    'media.bitrate': '码率', 'media.rotation': '旋转', 'media.tracks': '轨道数',
    'media.format': 'MIDI 格式', 'media.division': '时基 / 每拍 tick',
    'media.tempo': '速度', 'media.ffmpeg': '本地 ffmpeg',
    'media.ffmpegAvailable': '可用', 'media.ffmpegMissing': '未检测到（可安装 Termux ffmpeg）',
    'media.ffmpegVersion': '版本', 'media.ffmpegProbe': 'ffprobe 输出',
    'media.noProbe': '无法读取此文件的媒体信息',
    'media.external': '外部媒体信息',

    'editor.findReplace': '查找替换', 'editor.find': '查找',
    'toast.copied': '已复制', 'toast.done': '完成'
  };

  var en = {
    'common.close': 'Close', 'common.cancel': 'Cancel', 'common.ok': 'OK',
    'common.save': 'Save', 'common.delete': 'Delete', 'common.rename': 'Rename',
    'common.copy': 'Copy', 'common.move': 'Move', 'common.share': 'Share',
    'common.refresh': 'Refresh', 'common.search': 'Search', 'common.properties': 'Properties',
    'common.openWith': 'Open with…', 'common.tools': 'Tools', 'common.settings': 'Settings',
    'common.about': 'About', 'common.language': 'Language', 'common.preview': 'Preview',
    'common.back': 'Back', 'common.help': 'Help', 'common.confirm': 'Confirm',
    'common.all': 'All', 'common.none': 'None', 'common.unknown': 'Unknown',
    'common.left': 'Left', 'common.right': 'Right', 'common.same': 'Unchanged',
    'common.added': 'Added', 'common.removed': 'Removed', 'common.changed': 'Modified',
    'common.size': 'Size', 'common.path': 'Path', 'common.name': 'Name',
    'common.status': 'Status', 'common.closeTool': 'Close tool page',
    'common.readFailed': 'Read failed', 'common.notAvailable': 'Unavailable',

    'settings.title': 'Settings', 'settings.other': 'Other', 'settings.appearance': 'Appearance',
    'settings.language': 'Language', 'settings.languageDesc': 'UI language, applied immediately',
    'settings.desktopIcon': 'App icon', 'settings.desktopIconDesc': 'Switch launcher icon; some launchers need the shortcut re-added',
    'settings.signatureCheck': 'Signature check', 'settings.signatureCheckDesc': 'Certificate fingerprints of this app and a chosen APK',
    'settings.iconDefault': 'Default', 'settings.iconBlue': 'Aurora Blue', 'settings.iconGreen': 'Matrix Green',
    'settings.iconSwitched': 'App icon switched; some launchers need the shortcut re-added',
    'settings.languageSwitched': 'Language switched; reopen static screens to refresh them',

    'preview.markdown': 'Markdown preview', 'preview.markdownBuiltin': 'Preview Markdown',
    'preview.font': 'Font preview', 'preview.ninePatch': 'Nine-patch info',
    'preview.svgSource': 'View SVG source', 'preview.outline': 'Outline',
    'preview.loading': 'Loading preview…', 'preview.empty': 'File is empty',
    'preview.math': 'Math', 'preview.mathFallback': 'Math renderer not loaded',
    'preview.fontSample': 'Specimen', 'preview.fontAlphabet': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789',
    'preview.fontCJK': 'Cyber Hub Manager · File manager · CJK specimen',
    'preview.fontPunctuation': ', . ! ? : ; " " ( ) [ ] < > — … ·',
    'preview.fontSize': 'Font size', 'preview.fontInfo': 'Font file',
    'preview.fontUnsupported': 'Unrecognised font format',
    'preview.svgUnsafe': 'SVG is rendered through <img>; scripts are never executed',
    'preview.ninePatchTitle': '.9.png nine-patch', 'preview.ninePatchNoChunk': 'No npTc chunk found (uncompiled source or plain PNG)',
    'preview.ninePatchStretchX': 'Horizontal stretch', 'preview.ninePatchStretchY': 'Vertical stretch',
    'preview.ninePatchPadding': 'Content padding', 'preview.ninePatchOptical': 'Optical bounds',
    'preview.ninePatchChunks': 'PNG chunks', 'preview.ninePatchSize': 'Image size',
    'preview.ninePatchRaw': 'A source image with a 1px black border must be compiled by aapt into an npTc chunk',

    'compare.folders': 'Compare folders', 'compare.panes': 'Compare both panes',
    'compare.folderTitle': 'Folder comparison', 'compare.withHash': 'Compare content (SHA-256)',
    'compare.onlyLeft': 'Left only', 'compare.onlyRight': 'Right only',
    'compare.different': 'Different', 'compare.same': 'Same',
    'compare.leftPath': 'Left folder', 'compare.rightPath': 'Right folder',
    'compare.needTwo': 'Select two local folders',
    'compare.limit': 'Results truncated to the first 2,000 entries',
    'compare.bytes': 'bytes', 'compare.empty': 'Both folders are identical',
    'compare.hashOff': 'Names and sizes only', 'compare.hashOn': 'Content hashes',

    'sign.title': 'Signature fingerprints', 'sign.self': 'This app', 'sign.file': 'Selected APK',
    'sign.sha256': 'SHA-256', 'sign.sha1': 'SHA-1', 'sign.md5': 'MD5',
    'sign.schemes': 'Signature schemes', 'sign.verified': 'Verified', 'sign.notVerified': 'Not verified',
    'sign.noFile': 'Select an APK file first', 'sign.notSigned': 'Unsigned or signature unreadable',
    'sign.issuer': 'Subject', 'sign.serial': 'Serial',

    'media.probe': 'Media info', 'media.title': 'Media probe',
    'media.duration': 'Duration', 'media.resolution': 'Resolution', 'media.mime': 'MIME type',
    'media.bitrate': 'Bitrate', 'media.rotation': 'Rotation', 'media.tracks': 'Tracks',
    'media.format': 'MIDI format', 'media.division': 'Division (ticks per beat)',
    'media.tempo': 'Tempo', 'media.ffmpeg': 'Local ffmpeg',
    'media.ffmpegAvailable': 'Available', 'media.ffmpegMissing': 'Not found (install Termux ffmpeg)',
    'media.ffmpegVersion': 'Version', 'media.ffmpegProbe': 'ffprobe output',
    'media.noProbe': 'No media information available for this file',
    'media.external': 'External media info',

    'editor.findReplace': 'Find & replace', 'editor.find': 'Find',
    'toast.copied': 'Copied', 'toast.done': 'Done'
  };

  root.CYBER_LANGS = { 'zh-CN': zh, 'en': en, 'zh': zh };
})(typeof globalThis !== 'undefined' ? globalThis : this);
