# AI PROJECT STATE

## Project Overview

- **Project Name:** LoadLight
- **Type:** Web media encoder / optimizer (browser-based)
- **Tech Stack:** **Vite 5** + **React 18** + **JSX** (no TypeScript in app code), **Zustand** for global state, **CSS Modules** per component, **@ffmpeg/ffmpeg** + **@ffmpeg/util** (WASM path; COOP/COEP headers in Vite), **mp4-muxer**, **webm-muxer**, **jszip**
- **Main Goal:** Batch media files, preview before/after, encode/export with quality and format controls

## Core Architecture Rules

1. **File processing:** Ingestion, preview, and export logic live under [`src/lib/`](../src/lib/) (e.g. `exportEngine.js`, `previewEncoder.js`, `videoPreviewEncoder.js`, `ffmpegLoader.js`, `presets.js`) — not a fictional top-level `lib/media` tree.
2. **State:** Primary app state is [`src/store/useStore.js`](../src/store/useStore.js) (`files`, `activeIdx`, quality, export, encoding mode). Components read/write through this store.
3. **JS / JSX discipline:** No `.ts`/`.tsx` unless explicitly requested. Prefer JSDoc on complex functions; PropTypes optional. Do not assume strict TypeScript tooling.
4. **Supported input formats:** Central rules in [`src/lib/mediaIngest.js`](../src/lib/mediaIngest.js) (`validateIngestFile`, `isVideoLike`, `MEDIA_INPUT_ACCEPT`). UI badges and file picker in [`LeftPanel.jsx`](../src/components/LeftPanel.jsx). Ingestion includes **TIFF/TIF**, **MOV**, **AVI** (with generic MIME where needed); export output formats unchanged.
5. **Performance:** Large files — prefer streaming/chunking where already used; FFmpeg runs in worker context per existing patterns; Vite dev server uses COOP/COEP for SharedArrayBuffer where needed.

## UI Layout (verified `src/`)

| Area | File | Role (high level) |
|------|------|-------------------|
| Shell | [`src/App.jsx`](../src/App.jsx) | Layout: TopBar, main row (Left / Center / Right), BottomBar |
| Top | [`src/components/TopBar.jsx`](../src/components/TopBar.jsx) | App chrome, **batch name** (`projectName` → ZIP filename), presets |
| File list & add | [`src/components/LeftPanel.jsx`](../src/components/LeftPanel.jsx) | Queue, thumbnails, file add/remove, grouping |
| Preview & timeline | [`src/components/CenterPanel.jsx`](../src/components/CenterPanel.jsx) | Video/static preview, scrubber, before/after, much preview logic |
| Settings / options | [`src/components/RightPanel.jsx`](../src/components/RightPanel.jsx) | Quality, format, presets, etc. |
| Export / batch footer | [`src/components/BottomBar.jsx`](../src/components/BottomBar.jsx) | Queue summary, progress, export, logs |
| Misc | [`src/components/Toggle.jsx`](../src/components/Toggle.jsx), [`ReleaseNotes.jsx`](../src/components/ReleaseNotes.jsx) | Shared UI / release content |

## Module map (Foreman: keep updated after each milestone)

Use this checklist to ground Task Capsules in real paths (search `src/` if unsure):

- [x] **Ingestion / accepted formats:** [`src/lib/mediaIngest.js`](../src/lib/mediaIngest.js) + `addFiles` in [`useStore.js`](../src/store/useStore.js); **Files** imports assets independently, while **Smart Import** detects image sequences and asks the user to resolve ambiguous numbered groups; ingest errors → `ingestNotice` in [`LeftPanel.jsx`](../src/components/LeftPanel.jsx)
- [x] **Canvas viewport math:** [`src/lib/canvasViewport.js`](../src/lib/canvasViewport.js) — fit contain scale, pan bounds, zoom steps, native-pixel cap
- [x] **Canvas / static image preview:** [`CenterPanel.jsx`](../src/components/CenterPanel.jsx) — `VideoPreview` / `StaticPreview` inside `ZoomStage` (fit-based 100%, zoom >100%, wheel + toolbar, pan on overflow, Fit to canvas)
- [x] **Timeline / scrubber:** [`CenterPanel.jsx`](../src/components/CenterPanel.jsx) local state + `VideoPreview`; `prevScrub` synced while `playing` to avoid pause/jump glitches
- [x] **Batch naming:** [`TopBar.jsx`](../src/components/TopBar.jsx) labeled field → `projectName` in [`useStore.js`](../src/store/useStore.js) (ZIP basename via [`exportEngine.js`](../src/lib/exportEngine.js))
- [x] **Export pipeline:** Entry points in `useStore` → `src/lib/exportEngine.js` and related encoders

## Current System Map

### Done (baseline)

- [x] Vite app shell and panel layout
- [x] File queue, active file, thumbnails (`LeftPanel` + `useStore`)
- [x] Preview (video + static) and scrubber (`CenterPanel`)
- [x] Export / batch progress UI (`BottomBar` + `runExport` in store)
- [x] Zustand store wired to `src/lib` encoders and preview schedulers

### Planned / in progress (product brief)

- [x] .TIFF / .TIF ingestion (decode via `createImageBitmap` where supported; queue + preview raster)
- [x] .MOV / .AVI ingestion (extension + `isVideoLike`; thumbnails via `<video>`)
- [x] Batch name field visibility / UX (TopBar label, larger control, placeholder)
- [x] Canvas / preview zoom (`ZoomStage` + `canvasViewport.js`: fit-to-canvas at 100%, zoom above 100% to native pixels, +/−/Fit toolbar, wheel, pan on overflow)
- [x] Timeline scrubber playback (`VideoPreview`: keep `prevScrub` in sync while playing)

## Milestone 1 — Inspector and accurate posters (2026-09-10)

- Added Mediabunny 1.56.1 for read-only media inspection and frame extraction. Existing video/image/sequence encoders and routing are unchanged.
- `src/lib/mediaInspector.js`: lazy BlobSource reads, container/track metadata, sampled frame rate, per-track browser decode checks, and timestamp-based JPEG extraction via CanvasSink (display rotation applied). Readers are disposed after success, failure, cancellation, or a 30-second timeout.
- `src/components/MediaInspector.jsx`: selected-file inspector, per-file source timestamp, frame preview with actual presentation timestamp, and direct JPEG download. Preview URLs are revoked on changes/unmount.
- `src/store/useStore.js`: per-file `posterTime` via `setPosterTime`; source timeline “Set poster” button in `CenterPanel.jsx`. Hidden in After view because that timeline belongs to the shortened encoded preview.
- `src/lib/exportEngine.js`: batch posters use saved source times (default 0), including selected image-sequence frames. Unsupported poster extraction is logged without discarding successful encoded outputs. Times beyond the end select the final frame.
- Validation: production build and Chromium UI checks pass; MP4/WebM/rotated MOV fixture pixels and presentation times checked at start, mid-frame, boundaries, and EOF; direct JPEG download and two-file ZIP posters verified. Repeated 1080p poster reads from a 20 MB input, abort handling, and unavailable-decoder handling pass. Safari/Firefox and multi-gigabyte batches have not been verified.
- Scope limitation: Mediabunny does not inspect every accepted input container (notably GIF/AVI). Unsupported containers/codecs show a clear inspector message; batch posters are skipped with a warning. Still images/sequences show basic ingestion metadata. Decode support does not guarantee encoder support.

## Milestone 2 — Advanced media workflow (2026-09-12)

- `src/lib/contactSheet.js` and `src/components/ContactSheet.jsx`: 12-frame contact sheets with actual source timestamps, aspect-preserving thumbnails (including rotation), JPEG preview/download, progress, cancellation, and per-file inclusion in individual/ZIP export. Decoding is sequential with one 320 × 180 canvas in the sink pool and a bounded 1008 × 892 output; readers share the inspector’s validation, cancellation, and 30-second timeout. Preview URLs are revoked on replacement/unmount.
- `src/components/MediaInspector.jsx` and `src/lib/mediaInspector.js`: export audio selector identifies audio tracks by ordinal, language/name, codec, and channels. The store saves Automatic, Remove audio, or a specific zero-based audio ordinal per file. These settings apply independently of global quality settings.
- `src/lib/exportEngine.js`, `src/lib/videoEncoder.js`, and `src/lib/webCodecsEncoder.js`: propagate audio choice to export. Mute omits audio on both encoder paths. Specific tracks use explicit FFmpeg stream mapping and software encoding (single-threaded for WebM to avoid a verified multi-threaded stall); missing tracks fail visibly rather than silently substituting audio. Automatic preserves existing encoder behavior. Failed FFmpeg runs discard partial output.
- Validation: production build; Chromium contact sheets for MP4, WebM, and rotated MOV; JPEG download; two-track language metadata; MP4 exports of each selected track with independently verified 440/880 Hz tones; WebM selected-track export, muted exports on software and WebCodecs paths, and missing-track failure; two-file ZIP with a contact sheet only for the opted-in file; settings retained across file selection; repeated contact sheets from a 20 MB 1080p clip; mid-operation cancellation; invalid media and unavailable decoder errors. Post-GC JS heap was about 9 MB after the resource test (not a measurement of total decoder/WASM memory).
- Limitations: contact sheets currently cover decodable video files, not still-image collections or image sequences; fixed 12-frame UI layout; short clips can repeat frames. Specific audio tracks require Chrome/Edge software encoding and may be slower or memory-heavy for large files. GIF exports and visual previews remain silent. Safari/Firefox and multi-gigabyte batches are unverified. No new dependencies or deployment setup are required.
- Existing issue observed during verification: automatically detected fractional frame rates can make the MP4 WebCodecs muxer reject a job; Chromium successfully falls back to FFmpeg. This milestone leaves that separate encoder issue unchanged.

## Known Issues

1. **TIFF:** Native `createImageBitmap` often fails in Chrome; [`tiffDecode.js`](../src/lib/tiffDecode.js) falls back to ffmpeg (first frame → PNG). Very large or exotic TIFFs may still fail or load slowly on first ffmpeg init.
2. **AVI / MOV:** Some codecs fail in-browser decode or FFmpeg — user sees thumbnail/preview errors or export failure; errors surface in UI log / preview panel.

## Media Processing Architecture (as implemented)

- **Input:** User adds files → `useStore.addFiles` → thumbnails / metadata → preview pipeline (`previewEncoder` / `videoPreviewEncoder` as applicable).
- **Processing:** Quality and format from `RightPanel` / store; encoding mode from `getEncodingMode()` (`webcodecs` vs `wasm`).
- **Output:** `exportEngine` + muxers (`mp4-muxer`, `webm-muxer`); ZIP when batching multiple outputs (jszip).
- **Preview:** `CenterPanel` coordinates before/after URLs and scrubbing; `VideoPreview` uses `<video>` + time fraction callbacks. `ZoomStage` uses `canvasViewport.js` for fit contain + user zoom; media renders at natural dimensions inside a transformed stage (no fixed 300px height cap).

## Dependencies (from package.json)

- **Runtime:** `react`, `react-dom`, `zustand`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `jszip`, `mp4-muxer`, `webm-muxer`, `mediabunny`
- **Build:** `vite`, `@vitejs/plugin-react`, `@ffmpeg/core-mt` (dev)

---

**Last Updated:** 2026-09-12
**Package version:** 2.0.2 (aligned with the website version badge and release notes for media inspection, poster selection, contact sheets, and per-file audio controls)
