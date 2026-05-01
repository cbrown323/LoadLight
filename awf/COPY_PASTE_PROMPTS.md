# COPY-PASTE PROMPTS — LoadLight feature workflow (Cursor)

**How to use:** Open a **new Cursor chat** for each tab below. Use **Plan mode** for TAB 1 (Foreman). Use **Agent mode** for builder and documentation tabs so edits can be applied. If you do not have a Foreman plan yet, **stop** — run TAB 1 first and paste Task Capsules from its output into TAB 2+.

**Paths:** Workflow docs live under `awf/`. Root [`AGENTS.md`](../AGENTS.md) points here; `@`-mention `awf/...` when prompts reference state and logs.

---

## TAB 1: FOREMAN (planning phase)

**Action:** New chat → **Plan mode** → paste this block → Enter.

```
@awf/FOREMAN_MASTER_PROMPT.md
@awf/AI_PROJECT_STATE.md
@awf/DEV_LOG.md

You are the Project Foreman for LoadLight. Read the context files above and create an implementation plan for these features:

1. Add TIFF/MOV/AVI ingestion support (ingestion only, no output)
2. Improve batch name field visibility and UX
3. Add canvas zoom functionality
4. Fix timeline slider jumping during video playback

Provide:
- Shared contract (JSDoc / shared JS in src/lib or src/store — no fictional TS tree)
- Task capsules for Builder agents (each with verified paths, forbidden paths, acceptance check, merge order, estimated @-mentions)
- Implementation sequence
- File conflict prevention strategy

Do not write application code in this chat — planning only.
```

**After output:**

1. Apply shared contract changes (one focused Agent session or manual edit).
2. Copy each **Task capsule** from the Foreman into separate builder chats (templates below).
3. Close the Foreman chat when done.

---

## TAB 2–5: BUILDER (execution — use Foreman output)

**Action:** New chat → **Agent mode** → paste the template, **replacing placeholders with the Foreman’s Task capsule** (real paths under `src/` only).

**Do not** use hardcoded example paths from old prompts — the repo is Vite + React + JSX (`src/components/*.jsx`, `src/store/useStore.js`, `src/lib/*.js`).

```
@AGENTS.md
@awf/AI_PROJECT_STATE.md

TASK: <paste task name from Foreman>

Context (from Foreman Task capsule):
- Repo-relative paths (verified — @mention only these in Cursor): <paste>
- Forbidden paths / areas: <paste>
- Dependencies / merge order: <paste>
- Acceptance check (manual): <paste>

Requirements: <paste feature requirements from Foreman>

Implement the changes. Follow awf/AGENTS.md. End with:
1. Modified files (list)
2. What you tested (per acceptance check)
3. Known limitations

```

**Repeat** for each Task capsule (you may have fewer or more than four tasks — Foreman decides).

**After each builder:** Review diff → keep or revert → close chat.

---

## TAB 6: DOCUMENTATION UPDATE (merge phase)

**Action:** After builder(s) complete → new chat → **Agent mode** → paste (adjust the completed-work list to match reality):

```
@awf/DEV_LOG.md
@awf/AI_PROJECT_STATE.md

Completed work (edit this list to match what actually shipped):
- <item>

Please:
1. Update awf/DEV_LOG.md with today’s work, decisions, and follow-ups
2. Update awf/AI_PROJECT_STATE.md (module map, checkboxes, known issues)
3. Move completed items out of pending where applicable
4. Add any new known issues discovered during implementation
```

**After completion:** Review → close chat → `git add` / `git commit`.

---

## Quick execution guide

1. Keep `awf/COPY_PASTE_PROMPTS.md` open as reference.
2. Run **TAB 1** (Plan) → save Task capsules.
3. Run **TAB 2+** (Agent) one task at a time on first use; parallelize only when file sets are disjoint.
4. Run **TAB 6** (Agent) to sync docs.
5. `npm run dev` to verify → commit.

---

## Troubleshooting

- **Foreman invented paths:** Re-run Foreman with explicit instruction: list `src/` tree first; only `NEW:` for files that do not exist.
- **Builders conflict:** Complete one builder, commit, then rerun the other with updated `@` files.
- **Context too large:** Fewer `@` files per chat; close finished chats.
