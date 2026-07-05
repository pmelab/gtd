## Task: Squash all `gtd: *` commits into one conventional-commits message

The process is **approved and done**. Your job is to author a clean
conventional-commits squash message and hand it off to the harness.

### Step 1 — Extract decisions from grilling rounds

Scan the inlined full-process diff below. Look for changes to `TODO.md` —
specifically the `## Captured input (grilling)` sections and any edits to plan
text. Extract **key decisions, trade-offs, and design choices** made during
grilling rounds. These will appear in the commit body so the history is
self-documenting.

### Step 2 — Draft the commit message

Draft ONE conventional-commits message:

```
type(scope): subject

body (explain the why — motivation, trade-offs, key decisions from grilling)
```

- **type**: `feat` / `fix` / `refactor` / `chore` / `docs` / `test`
- **subject**: imperative mood, ≤ 72 characters, lowercase after the colon
- **body**: include the important decisions / trade-offs from grilling sessions.
  Omit if there were no meaningful decisions to capture.

### Step 3 — Write SQUASH_MSG.md and hand off

Write the commit message (plain text, no markdown wrapper) to `SQUASH_MSG.md` in
the repo root, then leave it uncommitted — the harness handles the squash commit
on the next cycle once it sees `SQUASH_MSG.md`.

**Do not run `git reset --soft` or `git commit` yourself** — the harness handles
the squash commit.
