# LoadLight Cursor workflow — visual overview

Cursor does **not** auto-open multiple chats for you. You start each phase manually: **new chat**, pick **Plan** or **Agent** mode, paste from [`COPY_PASTE_PROMPTS.md`](COPY_PASTE_PROMPTS.md) or your saved Foreman output.

Prompts and state files live under **`awf/`**. Root [`AGENTS.md`](../AGENTS.md) points agents at the full rules in [`awf/AGENTS.md`](AGENTS.md).

---

## Visual flow

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: One-time / per milestone                           │
├─────────────────────────────────────────────────────────────┤
│  Repo has: awf/AI_PROJECT_STATE.md, awf/DEV_LOG.md,         │
│  awf/FOREMAN_MASTER_PROMPT.md, root AGENTS.md               │
│  Optional: .cursor/rules/path-discipline.md                 │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Foreman (1 chat)                                   │
├─────────────────────────────────────────────────────────────┤
│  New chat → Plan mode                                       │
│  @awf/FOREMAN_MASTER_PROMPT.md + @awf/AI_PROJECT_STATE.md   │
│       + @awf/DEV_LOG.md                                     │
│  Output: shared contract + Task capsules (verified src/ paths)│
│  Close chat when plan is saved                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 3a: FIRST SESSION — one builder (recommended)          │
├─────────────────────────────────────────────────────────────┤
│  New chat → Agent mode → one Task capsule + @AGENTS.md      │
│  @ only 3–5 files from capsule                              │
│  Review diff → close chat                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 3b: LATER — parallel builders (optional)             │
├─────────────────────────────────────────────────────────────┤
│  Only if Foreman says file sets are disjoint                │
│  Multiple new chats in Agent mode, one capsule each           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Documentation (1 chat)                             │
├─────────────────────────────────────────────────────────────┤
│  New chat → Agent mode                                      │
│  @awf/DEV_LOG.md + @awf/AI_PROJECT_STATE.md                 │
│  Sync completed work and known issues                       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 5: Test and commit                                    │
├─────────────────────────────────────────────────────────────┤
│  npm run dev                                                │
│  git add / git commit                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Time rough order (varies by task)

| Phase        | Chats | What you do |
|-------------|-------|-------------|
| Foreman     | 1     | Plan mode, wait for capsules, save plan |
| Builders    | 1–N   | Agent mode per capsule; start with N=1 |
| Docs        | 1     | Agent mode, update awf/*.md |
| Test/commit | —     | Local run, git commit |

---

## Why multiple chats instead of one huge thread

**One long chat:** large context, easy path mistakes, mixed features, harder review.

**Foreman + builders:** planning stays separate; each builder keeps a small `@` set; you close chats to reset context. Foreman must list **real** paths under `src/` (see [`AI_PROJECT_STATE.md`](AI_PROJECT_STATE.md)).

---

## Modes at a glance

| Mode   | Typical use in this workflow      |
|--------|-----------------------------------|
| Plan   | Foreman — plan only, no code     |
| Agent  | Builders, contract apply, docs   |
| Ask    | Read-only review before merge    |

Shortcuts differ by Cursor version — use **Command Palette** and search for **New Chat** / mode picker if needed.

---

## Ready to start

1. Open [`COPY_PASTE_PROMPTS.md`](COPY_PASTE_PROMPTS.md)  
2. Run **TAB 1** (Foreman, Plan mode)  
3. Run builders from Foreman capsules (Agent mode), starting with **one** builder  
4. Run documentation tab, then test and commit  
