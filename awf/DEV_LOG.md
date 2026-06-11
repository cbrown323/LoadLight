# DEVELOPMENT LOG

## 2026-06-10 — Canvas viewport fix (Tasks 1–3)

- **Accomplished:**
  - **Task 1:** Added [`src/lib/canvasViewport.js`](../src/lib/canvasViewport.js) — fit-scale contain math, pan bounds from real overflow, zoom steps, native-pixel cap, wheel cursor anchoring helpers.
  - **Task 2:** Rewrote `ZoomStage` in [`CenterPanel.jsx`](../src/components/CenterPanel.jsx) — 100% = fit-to-canvas (no crop), zoom above 100% for pixel inspection, working +/−/Fit toolbar, pan when overflow, `ResizeObserver`, removed `maxHeight: 300` preview cap; toolbar isolated from drag pointer capture.
  - **Task 3:** Updated `awf/AI_PROJECT_STATE.md`, this log, and `ReleaseNotes.jsx` (v1.5.1).
- **Decisions:**
  - Zoom semantics: `totalScale = fitScale × userZoom`; `userZoom = 1` is “fit to canvas”; Fit resets zoom + pan.
  - Pan limits derived from scaled media vs viewport (not viewport-only heuristic).
  - Video after-placeholder hides zoom toolbar until encoded preview exists (`zoomable={false}`).
- **Testing:** `npm run build` (pass). Manual browser QA on `npm run dev` still recommended (large still, split view, wheel + buttons).
- **Follow-ups:** Deploy to load-light.vercel.app; spot-check production after push.

---

## 2026-04-30 — Foreman capsule execution (single Agent session)

- **Accomplished:**
  - Added [`src/lib/mediaIngest.js`](../src/lib/mediaIngest.js): shared ingestion validation, `isVideoLike`, `MEDIA_INPUT_ACCEPT`, JSDoc `IngestResult`.
  - Wired `addFiles` + `ingestNotice` / `clearIngestNotice` in [`src/store/useStore.js`](../src/store/useStore.js); TIFF thumbs via `createImageBitmap`; video thumbs for MOV/AVI via `isVideoLike`.
  - Replaced ad-hoc video checks with `isVideoLike` across preview/export/AI Max paths.
  - **TopBar:** labeled “Batch name”, larger input, placeholder and title for ZIP naming.
  - **LeftPanel:** new accept list, ingest error banner with dismiss, drop-zone copy; badges for TIFF/AVI.
  - **CenterPanel:** `ZoomStage` (wheel zoom, pan, +/−/Fit); `VideoPreview` keeps `prevScrub` in sync while `playing` to reduce scrubber jump on pause.
- **Testing:** `npm run build` (pass).
- **Follow-ups:** Browser spot-check with real MOV/AVI/TIFF samples; optional passive wheel listener tuning if console warns.

---

## Definition of done (per builder)

Before considering a builder task complete:

1. **Acceptance** — Manual checks from the Foreman Task capsule pass (including `npm run dev` where applicable).
2. **State** — `awf/AI_PROJECT_STATE.md` updated (module map, checkboxes, known issues) if behavior or architecture changed.
3. **Log** — This file (`awf/DEV_LOG.md`) has a new entry for the session (what changed, decisions, follow-ups).
4. **Commit** — Changes are committed (or explicitly left uncommitted with a note here) so the next builder starts from a known base.

---

## 2026-04-30 — AWF / Cursor workflow alignment (docs only)

- **Accomplished:**
  - Rewrote `awf/AI_PROJECT_STATE.md` for Vite + React + JSX and real `src/` layout (`src/lib`, `useStore`, panel components).
  - Added root `AGENTS.md` pointer; expanded `awf/AGENTS.md` with path discipline and stack reality.
  - Updated Foreman prompt, copy-paste prompts, workflow guides, quick reference, visual workflow for Plan/Agent/Ask and first-session ramp.
  - Added `.cursor/rules/path-discipline.md`.
  - Added "Definition of done (per builder)" section at top of this file.
- **Next steps:** Run Foreman (Plan) to produce Task capsules with verified paths; execute builders in Agent mode.

---

## [Current Date] - Agentic Workflow Initialization
- **Accomplished:** 
  - Set up agentic workflow structure
  - Created AI_PROJECT_STATE.md, DEV_LOG.md, AGENTS.md, FOREMAN_MASTER_PROMPT.md
  - Documented current known issues and planned features
  
- **Feature Requests Queued:**
  1. Add .TIFF ingestion support (no output)
  2. Add .MOV ingestion support (no output)
  3. Add .AVI ingestion support (no output)
  4. Improve batch name visibility/accessibility
  5. Implement canvas zoom functionality
  6. Fix timeline slider jumping during playback
  
- **Decisions:**
  - Using multi-agent workflow to parallelize development
  - Keeping file format ingestion separate from output pipeline
  - Prioritizing UX fixes (batch name, timeline slider) alongside format support
  
- **Issues Identified:**
  - Timeline slider exhibits non-linear behavior during playback (jumps backward/forward)
  - Batch name field location unclear to users
  
- **Next Steps:**
  1. Run Foreman planning session to break down tasks
  2. Define shared types/interfaces for new media formats
  3. Create task capsules for Builder agents
  4. Implement features in parallel using separate Cursor tabs

---

## Previous Development History
*[Placeholder - Add historical development notes as work progresses]*

---

## Development Workflow Notes
- Using Cursor Composer multi-tab workflow
- Each feature gets isolated in separate Builder agent chat
- Foreman agent plans and coordinates between Builders
- All changes logged here chronologically
- AI_PROJECT_STATE.md updated after each major milestone
