# Cursor agentic workflow guide — Foreman + Builders

## Goal

Use **separate Cursor chats** (one Foreman plan, then one chat per builder task) so context stays small and file conflicts stay rare. LoadLight is **Vite + React + JSX** under `src/`; workflow docs live in **`awf/`**; root [`AGENTS.md`](../AGENTS.md) summarizes rules for Cursor.

---

## Prerequisites

1. **Repo layout**
   - [`awf/AI_PROJECT_STATE.md`](AI_PROJECT_STATE.md) — current system map
   - [`awf/DEV_LOG.md`](DEV_LOG.md) — session history
   - [`awf/FOREMAN_MASTER_PROMPT.md`](FOREMAN_MASTER_PROMPT.md) — Foreman template
   - [`AGENTS.md`](../AGENTS.md) at repo root — entry point; full rules in [`awf/AGENTS.md`](AGENTS.md)
2. **Optional:** [`.cursor/rules/path-discipline.md`](../.cursor/rules/path-discipline.md) — enforce path verification project-wide
3. **Cursor usage**
   - Open a **new chat** from the Command Palette (e.g. **Cursor: New Chat**) if your shortcut differs from older docs.
   - **Plan mode** — Foreman planning (no app code edits in that pass).
   - **Agent mode** — builders and doc updates (edits allowed).
   - **Ask mode** — review-only (read/diff questions without writes).

---

## Cursor features this workflow uses

- **Root `AGENTS.md`** — always-on high-level rules for the agent
- **`.cursor/rules/`** — optional extra constraints (e.g. path discipline)
- **`@` mentions** — attach only the files each task needs (about 3–5)
- **Plan / Agent / Ask modes** — separate planning from implementation
- **Per-chat context** — close finished chats so the next task does not inherit noise

---

## First session (recommended)

Before running **2–4 builders in parallel**, do one full cycle:

1. **Foreman** — one chat, **Plan mode**, `@awf/FOREMAN_MASTER_PROMPT.md` + `@awf/AI_PROJECT_STATE.md` + `@awf/DEV_LOG.md`
2. **One builder** — one chat, **Agent mode**, one Task capsule, only its verified `src/` files
3. **Merge** — one chat, **Agent mode**, update `awf/DEV_LOG.md` and `awf/AI_PROJECT_STATE.md`
4. **Commit** — `git commit` so the next builder starts from a clean base

After that succeeds, you can open **multiple Agent chats** only when Foreman says file sets are **disjoint**.

---

## Phase 1: Foreman planning (single chat)

1. **New chat** → set **Plan mode**
2. **Prompt** (adjust `@` paths if your workspace root differs):

   ```
   @awf/FOREMAN_MASTER_PROMPT.md
   @awf/AI_PROJECT_STATE.md
   @awf/DEV_LOG.md

   Produce the shared contract and Task capsules per FOREMAN_MASTER_PROMPT.
   ```

3. **Outputs to capture**
   - Shared contract (JSDoc / shared JS boundaries — not a made-up TypeScript tree)
   - Task capsules (each with verified paths, forbidden paths, acceptance check, merge order)
   - Implementation sequence and risks

4. **Apply shared contract** — one **Agent** session (or manual edit), then commit if you use git checkpoints.

5. **Close** the Foreman chat when the plan is saved (copy capsules somewhere handy).

---

## Phase 2: Builder execution

### Default: sequential builders

For each Task capsule from the Foreman:

1. **New chat** → **Agent mode**
2. Paste capsule + rules:

   ```
   @AGENTS.md
   @awf/AI_PROJECT_STATE.md

   [Paste full Task capsule from Foreman]

   ONLY modify files listed under "Repo-relative paths (verified)".
   ```

3. **`@` attach** only those `src/` files (and `NEW:` files if Foreman created them).

4. Review diff, keep or revert, **close chat**.

### After your first clean cycle: parallel builders

Only when:

- Foreman marked tasks as parallel-safe (no overlapping files), and  
- You are comfortable resolving occasional conflicts  

open **2–4 Agent chats** at once, each with a **different** capsule and **disjoint** `@` file sets.

**Example pattern** (paths are **illustrative** — your Foreman must list real LoadLight files):

```
@AGENTS.md
@awf/AI_PROJECT_STATE.md

TASK: <from Foreman>
Files to touch: @src/lib/example.js @src/components/Example.jsx
DO NOT modify: <from Foreman capsule>
```

---

## Phase 3: Merge and document

1. **Test:** `npm run dev` and run each acceptance check from the capsules.

2. **One Agent chat:**

   ```
   @awf/DEV_LOG.md
   @awf/AI_PROJECT_STATE.md

   Summarize completed tasks: [...]
   Update both files per project conventions.
   ```

3. **Commit** with a message that matches what actually changed.

4. **Close** open agent chats when finished.

---

## Workflow diagram

```
START
  ↓
[Foreman chat, Plan mode] → shared contract + Task capsules
  ↓
[Apply contract] → optional commit
  ↓
[First session: one Builder chat, Agent mode] → then merge + commit
  ↓
[Later: parallel Builder chats only if disjoint files]
  ↓
[Test: npm run dev]
  ↓
[Merge chat] → awf/DEV_LOG + awf/AI_PROJECT_STATE
  ↓
[Commit]
  ↓
END
```

---

## Advanced tips

### When builders conflict

1. Finish one builder, commit  
2. Open the second builder with refreshed `@` files  
3. Say explicitly: "Another task changed `<file>`; re-read and merge carefully."

### Dependencies

If Task B needs Task A’s output: complete A, commit, then start B with Foreman’s merge order.

### Context budget

- About **3–5 `@` files** per builder chat  
- Do not attach the entire `src/` tree  
- You may skip `@awf/AI_PROJECT_STATE.md` in a tight builder if the capsule is self-contained (Foreman should still have listed truth in the capsule)

### When to re-run Foreman

- Architecture change mid-flight  
- New feature not in the current capsules  
- Repeated file overlap between tasks  

---

## Common mistakes

1. Too many `@` files in one chat  
2. Skipping Foreman — builders invent wrong paths  
3. Leaving many old chats open — noisy follow-ups  
4. Parallel builders on overlapping files  
5. Not updating `awf/AI_PROJECT_STATE.md` / `awf/DEV_LOG.md` — next session loses ground truth  

---

## Success criteria

- Task capsules reference **real** `src/` paths (or explicit `NEW:`)  
- Builders rarely touch the same file unserialized  
- State and dev log match the repo after merges  
- You can start a new session with a short Foreman + targeted builders  

---

## Quick start checklist

- [ ] Read [`awf/QUICK_REFERENCE.md`](QUICK_REFERENCE.md)  
- [ ] Foreman chat (Plan) with `@awf/FOREMAN_MASTER_PROMPT.md` + state + log  
- [ ] Apply shared contract, commit  
- [ ] First builder cycle (single Agent chat), then merge  
- [ ] Optional: parallel builders only when safe  
- [ ] Update `awf/DEV_LOG.md` / `awf/AI_PROJECT_STATE.md`, commit  

For copy-paste blocks, use [`COPY_PASTE_PROMPTS.md`](COPY_PASTE_PROMPTS.md).
