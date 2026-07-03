# Rewrite src/prompts/squashing.md

File: `src/prompts/squashing.md`

## Goal

Remove the git commands from the prompt (the agent must NOT run
`git reset --soft` or `git commit`). Instead the agent writes the commit message
to `SQUASH_MSG.md` and re-runs gtd. Add grilling-decision extraction so the body
captures key decisions from grilling rounds.

## New content (replace the entire file)

```markdown
## Task: Squash all `gtd: *` commits into one conventional-commits message

The process is **approved and done**. Your job is to author a clean
conventional-commits squash message and hand it off to gtd.

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

````

- **type**: `feat` / `fix` / `refactor` / `chore` / `docs` / `test`
- **subject**: imperative mood, ≤ 72 characters, lowercase after the colon
- **body**: include the important decisions / trade-offs from grilling sessions.
  Omit if there were no meaningful decisions to capture.

### Step 3 — Write SQUASH_MSG.md and hand off

Write the commit message (plain text, no markdown wrapper) to `SQUASH_MSG.md`
in the repo root:

```sh
# Write the message to SQUASH_MSG.md (plain text, no wrapper)
````

Then run:

```sh
node /Users/pmelab/.claude/skills/gtd/scripts/gtd.js format SQUASH_MSG.md
```

Then re-run gtd to let the edge perform the actual squash commit.

**Do not run `git reset --soft` or `git commit` yourself** — gtd handles the
squash commit on the next invocation once it sees `SQUASH_MSG.md`.

```

## Notes

- The `Squash base:` line and the full-process diff are inlined by `Prompt.ts`
  after the prompt template — no need to reference them in the template itself.
- The agent writes the commit message as plain text to SQUASH_MSG.md (no
  markdown code fences, no wrapper — just the raw commit message text).
- The format tool call normalizes line length / trailing whitespace.
```
