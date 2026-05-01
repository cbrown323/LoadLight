# AGENTS.md — AI Coding Rules for LoadLight

## Stack reality

- **Vite + React + JSX** under `src/`. App logic in `src/components/`, `src/store/useStore.js`, `src/lib/*.js`.
- **Do not** introduce `.ts`/`.tsx` files unless the user explicitly asks for a TypeScript migration.
- **Client-only:** There is no separate server runtime in this repo; validate and process in the browser. Phrase guidance as client-side validation and safe browser APIs.

## Path discipline

- **Verify before edit:** Search or list the repo for real paths. Never invent `lib/media/`, `hooks/useFoo.ts`, or Next.js-style `app/` layouts for this project.
- **Prefer `src/lib/`** for shared encoding/preview/export helpers (see `awf/AI_PROJECT_STATE.md`).
- **`@`-mentions in Cursor:** Attach only files the task actually touches (typically 3–5).

## Core Principles

- **Correctness over Cleverness:** Media processing requires precision. Prioritize accurate file handling and playback.
- **Surgical Changes Only:** Make minimal, targeted edits. No refactoring unrelated code during feature work.
- **Follow Existing Patterns:** Match the codebase's file structure, naming conventions, and architectural patterns.
- **No New Dependencies Without Permission:** Especially critical for media libraries — they're large and have security implications.

## Editing Style

- **Be Concise:** Minimize chat explanations. Show code, not commentary.
- **Ask When Unclear:** If requirements are ambiguous, request clarification before coding.
- **Summary Required:** Always end with: `Modified files: [list] | Reason: [brief]`
- **No Assumptions:** Don't guess at file paths, component names, or API signatures — verify first.

## Typing (JSX)

- Prefer **JSDoc** (`@param`, `@returns`, `@typedef`) on non-trivial functions when types help reviewers.
- **PropTypes** are optional; do not block work on adding them unless requested.

## Media Processing Specific Rules

1. **File type validation:** Validate extensions/MIME and unsupported codecs before heavy work.
2. **Memory management:** Large files — avoid unnecessary full-buffer copies; revoke `blob:` URLs when discarding previews.
3. **Browser compatibility:** Test codec support before assuming format availability.
4. **Errors:** Wrap media operations in try/catch with user-visible messages where appropriate.
5. **Performance:** Profile before optimizing, but avoid blocking the main thread for long synchronous work.

## Canvas & Timeline Rules

1. **Canvas updates:** Use `requestAnimationFrame` for smooth canvas-driven updates where applicable.
2. **Timeline sync:** Keep video `currentTime` and scrubber position consistent with a single source of truth (see `useStore` + `CenterPanel`).
3. **State management:** Playing, paused, seeking — avoid duplicate competing state.
4. **Event handling:** Debounce/throttle high-frequency events (timeline drag, zoom).

## Security & Safety

- **Input sanitization:** Validate uploads; reject unexpected types/sizes per product limits.
- **Resource limits:** File size limits and timeouts where the app already patterns them.
- **XSS prevention:** Sanitize user-provided text (batch names, labels) when rendered as HTML (prefer text nodes / React escaping).
- **Final check protocol:** When wrapping up, audit for:
  - Proper file type validation
  - Memory leak prevention (cleanup listeners, `URL.revokeObjectURL`)
  - Error handling completeness

## Anti-Patterns for LoadLight

- No `// TODO: implement later` placeholders
- No deleting existing functionality without explicit request
- No synchronous blocking operations for large files
- No hardcoded paths that ignore the real `src/` layout
- No direct DOM manipulation of canvas outside focused helpers
- No duplicated conflicting playback state between video and scrubber

## Testing Expectations

- Test with actual media files of varying sizes
- Verify behavior in the browser used for development (`npm run dev`)
- Check memory usage with large batches when touching preview/export
- Validate timeline scrubber during play and seek

## Communication Protocol

When you complete a task, report:

1. **Changed Files:** List of modified/created files
2. **Testing Done:** What you verified works
3. **Known Limitations:** Edge cases or browser-specific issues
4. **Next Dependencies:** What needs to happen before this can be deployed
