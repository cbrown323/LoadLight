# LoadLight agentic workflow — quick reference

## First session rule

Do **not** start with four parallel builders. Run **one Foreman (Plan)** → **one Builder (Agent)** → **one merge (Agent)** → **commit**. Add parallel Agent chats only after that works and Foreman says file sets are disjoint.

---

## The three phases

### 1. Foreman (planning)

New chat → **Plan mode** → `@awf/FOREMAN_MASTER_PROMPT.md` + `@awf/AI_PROJECT_STATE.md` + `@awf/DEV_LOG.md` → save plan → apply shared contract (Agent or manual) → close chat.

### 2. Builders (execution)

For each **Task capsule** from the Foreman: new chat → **Agent mode** → `@AGENTS.md` + `@awf/AI_PROJECT_STATE.md` (if needed) + capsule → `@` only the **verified** `src/` paths from the capsule (about 3–5 files) → review → close chat.

**Do not** copy stale example paths from old templates. The Foreman lists real paths for this repo (Vite + React + JSX).

### 3. Merge (documentation)

Final doc chat → **Agent mode** → `@awf/DEV_LOG.md` + `@awf/AI_PROJECT_STATE.md` → sync state → close → commit.

---

## Feature areas (for Foreman — not fixed file lists)

Give these bullets to the Foreman; it returns capsules with **real** paths:

1. TIFF / MOV / AVI ingestion (ingestion only, no output requirement in brief)
2. Batch name visibility / UX
3. Canvas / preview zoom
4. Timeline scrubber smooth playback

**Files per builder:** `<fill from Foreman Task capsule>` — never guess `lib/media`, `hooks/*.ts`, or `.tsx` unless they exist in the repo.

---

## Rules

**Do:**

- `@` about 3–5 files per builder chat
- Close finished chats
- Update `awf/DEV_LOG.md` and `awf/AI_PROJECT_STATE.md` after milestones
- Run `npm run dev` before committing

**Do not:**

- Load the whole repo into one chat
- Skip Foreman for multi-file features
- Run parallel builders on overlapping files
- Assume Next.js or TypeScript layout for LoadLight

---

## Token budget (rough)

- Foreman: about 20–30k tokens  
- Each builder: under ~30k tokens when file set is small  
- Full session: avoid piling many huge pastes into one thread  

---

## File hierarchy (this repo)

```
project-root/
├── AGENTS.md                 ← Cursor entry (points to awf/AGENTS.md)
├── awf/
│   ├── AI_PROJECT_STATE.md   ← Brain
│   ├── DEV_LOG.md            ← History
│   ├── AGENTS.md             ← Full rules
│   ├── FOREMAN_MASTER_PROMPT.md
│   ├── COPY_PASTE_PROMPTS.md
│   ├── CURSOR_WORKFLOW_GUIDE.md
│   ├── QUICK_REFERENCE.md     ← this file
│   └── VISUAL_WORKFLOW.md
└── src/                       ← application code (JSX + lib + store)
```

Optional: `.cursor/rules/path-discipline.md`

---

## Emergency procedures

**Builders conflict:** Finish one builder, commit, reopen the other with updated `@` files.

**Context too large:** Close chats; restart from Foreman with stricter file lists.

**Breakage:** `git diff`; restore if needed; note in `awf/DEV_LOG.md`.

---

## Next session startup

1. Read `@awf/AI_PROJECT_STATE.md`  
2. Read `@awf/DEV_LOG.md`  
3. New Foreman run if scope changed  
4. Builder chats from fresh capsules  
5. Close chats when done — **ground truth is in the markdown files**, not chat history  
