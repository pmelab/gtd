<%~ include("@header") %>

The process is **approved and done**. `.gtd/SQUASH_MSG.md` has already been
committed with a template — your job is to overwrite it with the real
conventional-commits squash message and finish your turn.

### Step 1 — Extract decisions from grilling rounds

Scan the git history of recent `gtd: ...` / `gtd(agent): ...` /
`gtd(human): ...` commits. Look for changes to `.gtd/TODO.md` and
`.gtd/ARCHITECTURE.md` — specifically the `## Captured input` sections and any
edits to plan/architecture text. Extract **key decisions, trade-offs, and
design choices** made during grilling and architecting rounds — specifically
the `### <question>` entries under `## Open Questions` that got resolved
(`Answer:`, or an accepted `Suggested default:`) this cycle.

### Step 1a — Update `.gtd/DECISIONS.md`
<% if (it.context.decisionLog && it.context.decisionLog.trim()) { %>
The current content is shown below.
<%~ include("@decision-log", { decisionLog: it.context.decisionLog, fenceFor: it.fenceFor }) %>
<% } else { %>
`.gtd/DECISIONS.md` doesn't exist yet (or has no recorded decisions).
<% } %>

For each decision extracted in Step 1: if it relates to an existing entry
shown above and contradicts or refines it, **replace that entry in place** —
the newer decision wins, don't keep both and don't append a
contradiction/history trail. If it's genuinely new, append it as its own
`### <topic>` entry. This is a judgment call, not a mechanical key match — the
same topic is rarely worded identically across cycles.

Write the **complete** resulting document back to `.gtd/DECISIONS.md` (create
it with just a `# Architecture & Product Decisions` heading plus this cycle's
entries if it didn't exist). Leave it **uncommitted** — `gtd step-agent`'s
squash sweeps up every working-tree change, including this file, into the one
squash commit below. If this cycle recorded no decisions, leave the file
untouched (don't create an empty one).

### Step 2 — Draft the commit message

Draft ONE conventional-commits message:

```
type(scope): subject

body (explain the why — motivation, trade-offs, key decisions from grilling)
```

- **type**: `feat` / `fix` / `refactor` / `chore` / `docs` / `test`
- **subject**: imperative mood, ≤ 72 characters, lowercase after the colon
- **body**: a brief motivation/trade-off summary. Don't restate the detailed
  decisions already recorded in `.gtd/DECISIONS.md` (Step 1a) — that's their
  durable home now.

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
