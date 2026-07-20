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

### Step 2 — Draft the commit message

Draft ONE conventional-commits message:

```
type(scope): subject

body (explain the why — motivation, trade-offs, key decisions from grilling)

## Decisions

### <question, verbatim from Step 1>
Answer: <the resolved answer> (default accepted | human override: <reason>)

Gtd-Decisions: true
```

- **type**: `feat` / `fix` / `refactor` / `chore` / `docs` / `test`
- **subject**: imperative mood, ≤ 72 characters, lowercase after the colon
- **body**: a brief motivation/trade-off summary.
- **`## Decisions`**: one block per question resolved THIS cycle (from Step
  1) — omit the whole section (and the `Gtd-Decisions: true` line) entirely
  when this cycle recorded no decisions. Don't restate decisions from earlier
  cycles — this commit only records what changed now; a later grilling round
  reads the full history of these sections back as context, so repeating old
  entries here would just duplicate them forever. If this cycle's answer
  contradicts an earlier cycle's, don't try to edit or annotate the old one —
  just state the new answer plainly; the newer commit naturally reads as the
  current truth.

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
