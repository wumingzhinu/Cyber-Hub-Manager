# Cyber Hub Manager — 0.1.11 development build

Android file manager and APK/DEX editor using a local WebView interface and native Java tools. Core tools work offline. Android 8.0 / API 26 or newer is required.

Install `Cyber-Hub-Manager-0.1.11.apk` as an **Update** over the existing app. Package `com.cyberhub.manager`, development signer and local asset origin are unchanged; versionCode is 12. Do not uninstall if you want to keep the private Workspace.

## WebDAV fix

Remote-storage WebDAV now uses OkHttp for HTTP requests. Android's `HttpURLConnection` rejects non-standard methods such as `PROPFIND`, `MKCOL` and `MOVE`, which previously broke directory listing, folder creation and rename. Connection, listing, upload, download, rename, delete and cleanup were verified against Koofr WebDAV.

## APKS → APK conversion

Tap a `.apks` file → **Convert to APK**, or long press it and choose **Convert to APK**. Select a variant if the archive contains multiple alternatives, choose the destination/name, then tap **Convert**. The result dialog offers **Open folder** and **Install**. The source APKS is never changed and existing output files are never overwritten.

- SAI-style bundles: validate and merge base, configuration resources, feature manifests, assets, native libraries and DEX files. Base identification uses the manifest, not filenames or a launcher-activity heuristic.
- Bundletool: read `toc.pb` and keep variants separate. Split and standalone outputs are separate choices. A verified standalone APK is copied byte-for-byte with its original signature; unsigned standalone and merged outputs are signed with the bundled development key.
- ARSCLib 1.4.0 merges binary resource tables; split-only manifest flags and delivery metadata are removed after checking required split dependencies/types. APK contents are aligned, signed and verified before publication.
- Native-worker progress shows the actual stage. Duplicate conversion and accidental Back dismissal are blocked while work runs. Keep the app open until it finishes.
- Mixed packages/versions (including versionCodeMajor), missing bases/features, duplicate split IDs/classes, conflicting file paths, unsafe paths and damaged entries fail without publishing an APK. Failed signing leaves the original unchanged.

Limits: 256 MB per embedded APK, 1 GB selected/expanded content, 1,024 APKs, 64 MB resource tables and 128 MB individual DEX files. Complex Play Asset Delivery, OBB, instant/system/APEX/archived apps, SDK-runtime and conditional/device-targeted delivery not safely handled by this converter are rejected. One variant is not necessarily universal across all devices. Apps depending on Play delivery services, original signatures, licensing or server checks may not work after merging/re-signing. Successful structural/signature verification does not prove every third-party app will install or run on every phone. Large bundles still require device memory/disk testing.

Merged APKs cannot update an installed app signed with a different developer key. Conversion does not automatically uninstall or replace an installed app.

## Retained editing and performance improvements

- Pinch previews use a compositor transform. The editor lays out the final font once on release, with the code position as its scroll anchor. Java, Smali, XML and text retain separate 4–32 px sizes.
- Typing uses CodeMirror history generations for dirty tracking. It no longer reads/scans the whole buffer on each keystroke. Method highlighting uses the visible-line tokenizer; highlighting gets a smaller work budget.
- Closing menus/dialogs reuses isolated animation surfaces and moves existing nodes instead of cloning whole subtrees and reparsing styles each time. Offscreen file rows can skip rendering on supporting WebViews.
- APK thumbnails have a separate native executor and shared request cache. They do not hold up foreground operations or flash the progress indicator. Disk capacity is read once per folder listing.
- **Java is editable.** Save compiles valid Java with ECJ, converts emitted bytecode to DEX, validates it, and merges only the edited class family into the selected DEX files. Android API and project signature stubs are compile-only; stub implementations never enter the edited APK.
- Java toolbar has undo, redo, save and line tools. **Find and replace** edits the live buffer and is undoable. Smali register tools are hidden in Java; comments use the correct language syntax.
- Failed Java compilation keeps the buffer open and shows diagnostics with a jump-to-line action. Concurrent saves compile once. Buffer changes during an asynchronous save are not falsely marked clean.
- **Save and sign APK** rewrites, signs and verifies V1/V2/V3 before committing to the source with an exact backup. Failed signing leaves the source unchanged. Exporting a copy no longer clears the unsaved-project flag. Opening another DEX asks how to handle unsaved work.
- Tapping a DEX file opens the DEX tool menu: **Dex 编辑器 Plus**, repair, DEX properties, Smali export, JAR export, translation mode and string replacement. Repair, DEX properties, Smali export, JAR export and string replacement run directly on the tapped `classes*.dex` without opening the DEX editor; only **Dex 编辑器 Plus** (and translation mode, which needs the string tab) opens a project. Direct repair and string replacement write back with a `.bak` backup and re-sign the containing APK; Smali/JAR export leave the source untouched. Repair and string edits preserve the original DEX version/API level.
- Merging `classes*.dex` moved out of the single-file menu: select two or more DEX files, long-press to open the file action sheet, and pick **合并 DEX** next to **分享**. The entry only appears when every selected file is a DEX, and only the selected files are merged.

## Machine translation

**Drawer → Tools → Translation service** picks the provider, target language and credentials. Requests go out from the device; keys are kept in the app's private storage and never leave it except to the chosen provider.

| Provider | Credentials | Notes |
| --- | --- | --- |
| Tencent Cloud TMT | SecretId, SecretKey, project ID, optional region | TC3-HMAC-SHA256 signed `TextTranslate` call against `tmt.tencentcloudapi.com`. |
| Baidu Translate | AppID, App Key | `api/trans/vip/translate` with the salted MD5 signature. |
| Microsoft Translator | subscription key, optional resource region | `api.cognitive.microsofttranslator.com/translate` (API 3.0). |
| AI model | base URL, API key, model, custom prompt | OpenAI-compatible `/chat/completions`. The prompt may use `{lang}` (target language) and `{text}` (source). |

- **Translate** appears in the DEX string dialog and in the ARSC translation dialog; it fills the target field so the result can be edited before it is applied.
- **Translate all** in the DEX *Strings* tab and in the ARSC translation mode translates the visible strings, writes them into the project or the target language configuration, and keeps the normal save flow (DEX: save project; ARSC: save resource table).
- The source language is detected automatically. The target language follows the settings page, or the ARSC configuration qualifier (`en-rUS` → English).
- Each provider uses its own language codes; the shared list covers 19 languages including Simplified and Traditional Chinese.

Translation quality depends on the provider. Machine output still needs review, especially for product names, placeholders (`%1$s`) and format specifiers.

## Edit → save → sign

1. Grant file access, tap an APK, choose **View**, then open `classes.dex` and select the DEX files needed by the project.
2. Open a class. Edit Smali directly or use **Editor menu → View Java**. Java opens the enclosing class when you select a nested class.
3. Edit the source and tap Save. Returning from a dirty DEX editor also attempts to compile; an error keeps you in the editor. Save changes the temporary project, not the original APK yet.
4. Use **Editor/DEX menu → Save and sign APK**. This writes the verified signed result to the source path and keeps its previous contents as a backup. The result dialog offers Install.
5. Alternatively, **Save project / Save and exit** writes unsigned changes with a backup; **Export DEX / APK** creates a separate copy. Use APK **Function → Sign a copy** when signing an exported APK. Repeat sign-copy uses a unique output name.
6. A `.bak` file can be restored from its Rename dialog. Existing backups are retained with unique suffixes.

Java compilation requires valid, compilable source. Decompiled Java is not guaranteed to reconstruct the original source or behavior. Obfuscated names, unresolved dependencies, incomplete JADX output or unsupported language constructs can require manual correction or Smali editing. Incomplete-method placeholders are rejected. Package/class renaming is rejected. The compiler targets Java 8 syntax and Android API 34 signatures; lambdas/method references needing desugaring are rejected rather than emitting unsafe bytecode. New APIs still need the appropriate runtime Android version. These limits do not make the Java editor read-only.

## Available tools

| Area | Working implementation |
| --- | --- |
| Files | Two side-by-side panes on phones and tablets. Folder/history navigation, selection, copy/move, batch rename, bookmarks, recycle/restore, backup restore, create, filter, properties/SHA-256, share. The recycle bin opens only in the pane that was active last and leaves the other pane untouched; entries are grouped by date (today, yesterday, 7 days, 30 days, older), the header shows folder/file counts plus total size, and the pane keeps the file manager’s bottom shortcut bar. Swipe rows for multi-select, then restore or permanently delete the selected entries in one action. |
| Archives | ZIP, 7z, TAR, TAR.GZ/XZ/ZST/BZ2/LZ4, GZIP; format-appropriate compression, ZIP/7z AES passwords, split archives, extraction. Entries inside an archive can be renamed: the archive is rewritten as an `-edited` copy with the new name, the original package is left untouched, and stale JAR signatures are dropped so the copy can be signed again. |
| APK | Metadata/icon, signature verification, browse/extract, edited archive output, signing, Android install intent. Protection is not assessed. |
| APKS | Convert base/config/feature split sets; select bundletool variants; preserve signed standalone APKs; sign and verify merged APKs; install output. |
| Binary XML | Decode/edit/encode; preserve existing typed values and resource IDs. New symbolic resources need a separate resource compiler. |
| DEX | MultiDex tree/history/search, string occurrences, member navigation, usages/subclasses/overrides, Smali/Java editing, compile/save/export/sign. |
| Editors | Syntax colors, line tools, search/replace, go to line, wrap, undo/redo, export, text zoom. Smali register analysis/increase. |
| Resources | resources.arsc opens a four-way chooser: ArscEditor, ArscEditor++ (Browse/Recent/Search/Constants workspace), translation mode with per-language comparison and new-language cloning, and a resource query tool for `@`/`?` names, IDs, colors and base conversions. Editors support package/type/config/entry browsing, scalar and complex values, rename/add/delete, per-config import/delete, string-pool replace, and save with APK re-sign support. AXML string-pool viewing remains available separately. The Arsc编辑器++ browse tab is a drill-down tree like the DEX editor — package → type → resource — with the default configuration inlined under its type and other configurations shown as locale rows instead of a "default" folder; a selected resource opens in place instead of jumping to the type list, and the tree cache is dropped after every edit. Tapping a resource opens it in the text editor as XML (`<string name="app_name" id="0x7f030000" package="…" type="string">value</string>`); editing that value and saving writes it back into the resource table. Complex (style/array) values open as XML collection items and save per index. The Arsc编辑器++ browse tab carries a name filter and the same shortcut symbol bar (`→ / + - * = <`) as the code editor, so symbols can be typed without a keyboard. |
| Installed apps | List/filter and extract base APKs. Tapping an app opens extraction mode with **Extract APK / View / Install**; APK signing and other editing functions are hidden. Extraction reads the base APK and lets you choose folder and filename; use an APKS bundle for split conversion. |
| Tools | Local profile/preferences, activity record, file comparisons, an embedded Termux terminal (`terminal-emulator` + `terminal-view`) with a real PTY running `/system/bin/sh`, own-format `.sh` plugins, and an offline searchable Smali/Dalvik instruction reference with formats, descriptions and examples. |
| Network | Saved remote storage entries (WebDAV, FTP, FTPS, SFTP, SMB and S3-compatible object storage) listed in the sidebar; opening one replaces only the active file pane with remote browsing, leaving the other pane local. Supports list/download/upload/mkdir/rename/delete; token-protected read-only local HTTP sharing; local MCP `list_files`/`read_text`. |

### File multi-select gestures

Selecting several files/folders in the two-pane file view supports three continuous gestures, without opening the context menu:

1. **Anchor (Rule 1)** — press and hold a row, then slide left/right. That row becomes the selection anchor `a` and multi-select mode starts (a status banner and a highlighted anchor appear).
2. **Range select (Rule 2)** — while still holding (without lifting the finger), keep sliding vertically over the rows. The continuous range from anchor `a` to the row under the finger (`b`, the active end) is selected live; sliding back shrinks the range, with `a` fixed as the anchor.
3. **Append / range endpoint (Rule 3)** — after the anchor gesture is released (anchor `a` stays highlighted), slide left/right on another row `c`. The continuous range from anchor `a` to `c` is selected (giving `{a..c}`); sliding on more rows moves the endpoint, so multiple files/folders work the same way. Tapping a row while in append mode toggles that single entry in/out of the selection.

A plain long-press without sliding still opens the file action menu as before; a tap with no active selection still opens the file/folder as before.

Remote/network tools run only while the app process lives and respect Android permissions. The embedded Termux terminal is interactive and has no fixed command timeout; the separate `.sh` plugin runner still uses the 20-second batch limit. DEX searches are capped; usage search covers selected DEX instructions/type declarations, not reflection. Register analysis is a usage/count view, not liveness analysis. Root escalation, cloud subscriptions, remote desktop control and proprietary plugins are not provided. ARSC editing handles compiled resource tables; building new resource IDs still requires a resource compiler.

## Validation and limits

See `VALIDATION.txt`, `tests/results/` and `tests/performance-profile.cjs` for the actual checks. Native code runs in JVM tests with real ZIP/DEX/AXML/signatures; UI tests use a mocked bridge and Happy DOM. The profile counts expensive operations on a 15,003-line buffer. It is **not a device FPS measurement**.

No physical Android device/emulator was available. Installation, actual WebView frame pacing, pinch/keyboard rendering, device memory pressure, live WebDAV/FTP/FTPS/SFTP/SMB/S3 endpoints and Android JNI execution still require device testing. The local browser runtime was unavailable and cloud local-preview access was denied; that restriction was respected. This is a development build, not a promise of pixel-perfect or universally lag-free behavior.

The signing certificate is a **public development key** bundled to make local signing work. It cannot update an app signed by a different developer; use your own key for a production identity. APK size includes the offline Java compiler, compile-only Android API library and resource-aware APKS merge engine. The API library is copied to cache only on the first Java compilation.

## Build

JDK 17, Android SDK 34 and build-tools 35.0.0:

```sh
bash gradlew assembleDebug
```

All runtime JARs, four Zstandard Android ABIs and local UI assets are included. Gradle needs network access for its build plugin on first run. The delivered APK uses the fallback builder:

```sh
python tools/build.py --sdk /absolute/path/to/android-sdk
```

Its default build-tools selection is 34.0.0; pass `--tools` for another installed build-tools directory. Output: `dist/Cyber-Hub-Manager-0.1.11.apk`. It compiles with desktop ECJ, converts with D8, aligns, signs, verifies signatures and checks packaged assets before publishing.

`python tools/dependencies.py` recreates pinned runtime JARs. `python tools/compiler-api.py /path/to/platforms/android-34/android.jar` recreates the compile-only classpath asset. Dependency/source/license information is in `THIRD-PARTY-NOTICES.txt`, `DEPENDENCIES.json` and `licenses/`.

## Terminal component

The embedded terminal uses the Termux `terminal-emulator` and `terminal-view` libraries (GPLv3), resolved from JitPack. Native PTY support is provided by `libtermux.so`, packaged for arm64-v8a, armeabi-v7a, x86 and x86_64. The session runs the device's `/system/bin/sh`; no Termux bootstrap or package repository is bundled. The screen is a black full-screen terminal with a two-row key bar (`Esc`/`Tab`/`PgUp`/`Home`/arrows/`End` and `Ctrl`/`Alt`/`PgDn`/arrows/keyboard toggle); the `⋮` menu provides paste, clear and close, and the system Back button also closes the terminal.

## Source and tests

- `app/src/main/assets/`: HTML/CSS/JS interface, CodeMirror and compile-only API asset.
- `MainActivity.java` / `DataEngine.java`: WebView bridge, OS actions, native dispatch and documents.
- `DexEngine.java` / `JavaEditCompiler.java`: decompile, compile, transactional DEX merge, commit/export.
- `ApkSigning.java`: temporary signing, mandatory verification, atomic publication.
- `FileOps.java`, `Axml.java`, `ArchiveTools.java`, `BatchFiles.java`, `CompareTools.java`: file/format engines.
- `LocalService.java`, `FtpTools.java`, `NetworkStorage.java`: explicitly started network tools and saved network storage.

```sh
python tests/run-core.py
# Install Happy DOM 15.11.7 separately and set HAPPY_DOM_PATH to its lib/index.js.
node tests/startup-smoke.cjs
node tests/dom-smoke.cjs
node tests/layout-smoke.cjs
node tests/video-ui-smoke.cjs
node tests/motion-zoom-smoke.cjs
node tests/java-edit-ui-smoke.cjs
node tests/performance-profile.cjs
```

`tests/ui-smoke.cjs` is an optional Playwright visual harness and has not run successfully in this environment. Reference screenshots/videos are not redistributed in this package.
