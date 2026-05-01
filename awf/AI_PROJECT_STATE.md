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

- [x] **Ingestion / accepted formats:** [`src/lib/mediaIngest.js`](../src/lib/mediaIngest.js) + `addFiles` in [`useStore.js`](../src/store/useStore.js); ingest errors → `ingestNotice` in [`LeftPanel.jsx`](../src/components/LeftPanel.jsx)
- [x] **Canvas / static image preview:** [`CenterPanel.jsx`](../src/components/CenterPanel.jsx) — `VideoPreview` / `StaticPreview` inside `ZoomStage` (wheel zoom, pan, Fit)
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
- [x] Canvas / preview zoom (`ZoomStage`: wheel, +/- / Fit, drag pan when zoomed)
- [x] Timeline scrubber playback (`VideoPreview`: keep `prevScrub` in sync while playing)

## Known Issues

1. **TIFF:** Native `createImageBitmap` often fails in Chrome; [`tiffDecode.js`](../src/lib/tiffDecode.js) falls back to ffmpeg (first frame → PNG). Very large or exotic TIFFs may still fail or load slowly on first ffmpeg init.
2. **AVI / MOV:** Some codecs fail in-browser decode or FFmpeg — user sees thumbnail/preview errors or export failure; errors surface in UI log / preview panel.

## Media Processing Architecture (as implemented)

- **Input:** User adds files → `useStore.addFiles` → thumbnails / metadata → preview pipeline (`previewEncoder` / `videoPreviewEncoder` as applicable).
- **Processing:** Quality and format from `RightPanel` / store; encoding mode from `getEncodingMode()` (`webcodecs` vs `wasm`).
- **Output:** `exportEngine` + muxers (`mp4-muxer`, `webm-muxer`); ZIP when batching multiple outputs (jszip).
- **Preview:** `CenterPanel` coordinates before/after URLs and scrubbing; `VideoPreview` uses `<video>` + time fraction callbacks.

## Dependencies (from package.json)

- **Runtime:** `react`, `react-dom`, `zustand`, `@ffmpeg/ffmpeg`, `@ffmpeg/util`, `jszip`, `mp4-muxer`, `webm-muxer`
- **Build:** `vite`, `@vitejs/plugin-react`, `@ffmpeg/core-mt` (dev)

---

**Last Updated:** 2026-04-30  
**Package version:** 1.4.0 (see repo `package.json`)
