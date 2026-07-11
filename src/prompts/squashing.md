<%~ include("@header") %>

The process is **approved and done**. `.gtd/SQUASH_MSG.md` has already been
committed with a template — your job is to overwrite it with the real
conventional-commits squash message and finish your turn.

### Step 1 — Extract decisions from grilling rounds

Scan the git history of recent `gtd: ...` / `gtd(agent): ...` /
`gtd(human): ...` commits. Look for changes to `.gtd/TODO.md` — specifically the
`## Captured input` sections and any edits to plan text. Extract **key
decisions, trade-offs, and design choices** made during grilling rounds. These
will appear in the commit body so the history is self-documenting.

### Step 2 — Draft the commit message

Draft ONE conventional-commits message:

```
type(scope): subject

body (explain the why — motivation, trade-offs, key decisions from grilling)
```

- **type**: `feat` / `fix` / `refactor` / `chore` / `docs` / `test`
- **subject**: imperative mood, ≤ 72 characters, lowercase after the colon
- **body**: include the important decisions / trade-offs from grilling
  sessions. Omit if there were no meaningful decisions to capture.

### Step 3 — Overwrite .gtd/SQUASH_MSG.md

Replace the **entire content** of `.gtd/SQUASH_MSG.md` (plain text, no markdown
wrapper, no leftover template scaffolding) with the message from Step 2, then
leave it uncommitted and finish your turn — `gtd step-agent` performs the
squash using this file's content.
<% if (it.context.squashDiff && it.context.squashDiff.trim()) { %>
<%= it.context.squashBase !== undefined ? "\nSquash base: " + it.context.squashBase + "\n" : "" %>
<%~ include("@diff", { heading: "Full-process diff (`git diff " + (it.context.squashBase !== undefined ? it.context.squashBase : "<squashBase>") + " HEAD`)", diff: it.context.squashDiff, fenceFor: it.fenceFor }) %>
<% } %>

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
