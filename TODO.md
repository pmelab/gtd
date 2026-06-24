---
status: grilling
---

# Offload mechanical git/fs work from the agent to the deterministic edge

Continue the direction set by edge-driven `review-process`: move deterministic
git/filesystem work out of agent prompts and into the Effect **edge**
(`main.ts` + `GitService`, fed by read-only `Events.ts`). The agent should only
ever do work that needs LLM judgment; everything mechanical should be a pure
function of the tree run by the edge.

Today the edge runs once per `gtd` invocation, then emits exactly one prompt;
the agent does the prompt's work and re-invokes `gtd` (the auto-advance loop is
agent-driven). `review-process` already proved the offload pattern: the edge
runs `recordAndRevertReview` before emitting (`main.ts:30-40`), leaving the
agent only synthesis.

This work package extends that to three more states (Part A) and then
generalizes the post-agent commit (Part B).

## Open Questions

### Should Part B ship in this plan, or split into a follow-up once Part A lands?

**Recommendation: split Part B into its own follow-up plan.** Grounded in the
code, Part A and Part B are different risk classes:

- Part A states (`cleanup`, `close-review`, `code-changes`) consume inputs that
  **already exist when the edge runs** — empty `.gtd/`, a ticked `REVIEW.md`, a
  dirty tree. The edge can act and re-resolve in the same process. The git ops
  already exist or are trivially extracted (`closeReview` is literally the tail
  of `recordAndRevertReview`, `Git.ts:230-252`). Risk is contained to `main.ts`
  pre-render blocks + new `GitService` ops + retiring three prompts.
- Part B (`execute`, `decompose`, `human-review`, `new-todo`, `modified-todo`,
  `execute-simple`, `fix-tests`) commits work the agent **produced this run**.
  Because the edge runs _before_ the agent (`detect()` at `main.ts:27`), the
  commit physically cannot move into the same invocation — it has to move to the
  _next_ cycle's edge. That requires a committed/persisted "intent" descriptor
  the next edge can read to know which message + cleanup applies, plus a
  redesign of guard ordering so a "just-produced, uncommitted" tree routes to a
  commit pass instead of being misread (e.g. an uncommitted `.gtd/` from
  `decompose` currently means `code-changes`/`execute`, not "commit the
  decompose output"). It also re-embeds artifacts that are genuinely
  agent-authored: `decompose`'s `COMMIT_MSG.md` _contents_, `human-review`'s
  hunk grouping. This is a commit- contract redesign, not an offload of a pure
  function.

Part A delivers the internal-loop machinery (A0) that Part B depends on, and
proves it on three low-risk states first. Ship Part A, then open a follow-up
TODO for Part B once the loop is in `main.ts` and exercised by e2e. Part B's
design sketch is retained below for continuity but is **out of scope for this
plan**.

<!-- user answers here -->

### Does the internal loop change the "exactly one prompt" stdout contract observed by e2e?

**Recommendation: no — keep "exactly one prompt per `gtd` run" as the output
contract, and have the internal loop only collapse no-agent transitions.** The
edge already mutates git inside a single run (`review-process` creates two
commits before emitting), so "the edge does multiple deterministic things, then
emits one prompt" is established. The loop is: `detect()` → if leaf is a
no-agent edge state, perform its action, `detect()` again, repeat — until a leaf
needs an LLM (emit its prompt) or a human (emit STOP prompt). Every `gtd`
invocation still writes exactly **one** prompt to stdout and exits.

This matters because all e2e (`tests/integration/`) spawn `scripts/gtd.js` once
via `runGtd` (`world.ts`) and assert on a single `stdout`. They never poll a
multi-step transcript. With this contract those tests stay valid: e.g.
`auto-advance.feature`'s "Code changes prompt includes auto-advance" must change
— `code-changes` now becomes a no-agent state, so a single dirty file run will
commit and re-resolve to (likely) `human-review`/`verified` rather than emitting
the commit prompt. New e2e must assert the **post-loop** observable: the commit
exists in `git log` (helpers already present: `gitLog()`, `lastCommitSubject()`)
AND stdout shows the _next_ leaf's prompt. The bundled `scripts/gtd.js` and the
`<command>gtd</command>` skill (`SKILL.md` step 2: "resolves to exactly one
active state, whose prompt is emitted") keep working unchanged: the agent still
reads one prompt; the auto-advance partial still drives the _agent-visible_ re-
run. Only deterministic hops are absorbed into one process.

<!-- user answers here -->

### How does the internal loop terminate and bound against pathological cycles?

**Recommendation: bound by a small fixed iteration cap on edge-only hops AND by
requiring strict progress.** The loop only continues while the resolved leaf is
a _no-agent edge state_ (`cleanup`, `close-review`, `code-changes`, and later
Part B's commit pass). Every such action mutates git (new commit, deleted dir),
so a correctly-behaving action changes the fold's inputs and cannot resolve to
itself forever. But to harden against a logic bug (e.g. an action that fails to
clear its trigger), add:

1. A hard cap (e.g. **8** edge hops) on the number of no-agent actions per `gtd`
   invocation; on exceeding it, fail with a clear error to stderr (`main.ts`
   already has the `catchAll`→`process.exit(1)` path at lines 69-75).
2. A progress assertion: track the resolved leaf value across hops; if the same
   leaf resolves twice in a row _after its action ran_, treat it as a stuck
   state and fail rather than spin. (This is the deterministic analogue of the
   existing `Gtd-Test-Fix:` cap at `Machine.ts:13`/`State.ts:42-46`.)

The cap is edge-internal and never overridable (mirrors the test-fix cap policy
in `SKILL.md`). Terminal leaves with the `auto-advance` tag that still need the
_agent_ (`execute`, `decompose`, etc.) end the loop and emit — they are not
edge-no-agent states.

<!-- user answers here -->

### `code-changes` (A3): what commit message, and does any agent turn remain?

**Recommendation: fully edge-run, zero agent turn, fixed message
`chore(gtd): commit pending changes`.** The current prompt (`code-changes.md`)
already specifies a purely mechanical procedure — `git add -A`, then unstage
`TODO.md`/`REVIEW.md` — and notably specifies **no** commit message at all,
which means the message has never carried information. A fixed conventional
message is strictly better than the status quo (today the agent invents one). No
judgment is lost. Implement as a `GitService.commitPending()` op (stage all,
`git restore --staged TODO.md REVIEW.md`, commit fixed message; skip if nothing
remains staged) and a `main.ts` pre-render block mirroring `review-process`
(`main.ts:30-40`). After committing, re-resolve via the A0 loop.

Caveat to verify in implementation: the existing guard `codeDirty` is gated by
`!reviewPresent` (`Machine.ts:125`), so `code-changes` never fires while a
REVIEW.md exists — the unstage-REVIEW.md safety in the prompt is belt-and-
suspenders. Keep the `git restore --staged REVIEW.md` anyway (cheap, matches
prompt intent).

<!-- user answers here -->

### `close-review` (A2) and `cleanup` (A1): zero agent judgment confirmed? What happens to the guards, auto-advance tags, and prompt files?

**Recommendation: both are confirmed zero-judgment; fully edge-run; retire their
prompt files.**

- `close-review`: 100% mechanical. The exact ops already live in
  `recordAndRevertReview`'s tail (`Git.ts:230-252`): `git rm REVIEW.md` +
  `chore(gtd): close approved review for <short-sha>`. The base sha is in
  `context.baseRef` (`Machine.ts` passthrough; populated in `Events.ts:300`).
  The prompt's `git checkout -- REVIEW.md` step maps to discarding the ticked
  working copy before `git rm`. Extract `GitService.closeReview(base)` and reuse
  it from both call sites.
- `cleanup`: `Events.ts` already detects empty `.gtd/`
  (`gtdDirExists && !hasPackages`, guard at `Machine.ts:213`). Edge deletes the
  directory, re-resolves. Note `SKILL.md:95-98` says cleanup is already a rare
  safety net (execute removes `.gtd/` on the last package), so this is low-
  traffic but still worth offloading.

Per the AGENTS.md "Removing a Workflow Step" checklist, these are **not** being
removed from the machine — they stay as leaf states with the `auto-advance` tag
(`Machine.ts:259,265`); only the **prompt emission** is replaced by an edge
action. So: keep the `LeafState` ids, `inferStep`/guards, commit-prefix
recognition; **delete** `prompts/cleanup.md`, `prompts/close-review.md`, their
imports + `SECTIONS` entries in `Prompt.ts:7,13,50,54`, and update all e2e that
assert on those prompt strings (`review.feature:122-148` "Close the approved
review", any cleanup assertions). The `auto-advance` tag becomes meaningful only
to the edge now (it signals "the edge may keep looping"), not to the agent —
keep it; A0's loop reads it.

<!-- user answers here -->

### How should the edge report what it did deterministically, given the user watches gtd output?

**Recommendation: prepend a short, plain status line per edge action to stdout,
before the final emitted prompt; respect the stdout-dirty/newline discipline.**
The user currently sees the agent narrate ("committed pending changes,
re-running gtd"). Once the edge absorbs those hops silently, the user loses
visibility. Emit one line per edge action, e.g.
`gtd: committed pending changes (chore(gtd): commit pending changes)` /
`gtd: closed review for abc1234` / `gtd: removed empty .gtd/`, then the next
leaf's prompt. Per AGENTS.md stdout notes: any direct `process.stdout.write`
must keep the dirty/newline state consistent — these status lines must end in
`\n` and the subsequent prompt write must not assume a clean line. Since
`main.ts` writes the prompt with a single `process.stdout.write(prompt)` and the
prompt already ends in `\n` (`Prompt.ts:185`), prefixing `status + "\n"` is
safe. Gate verbosity decisions behind the existing event-handler `verbose`
convention only if these status lines are routed through the event handler; the
simplest correct choice is to always print them (they are low-volume, one per
deterministic hop).

<!-- user answers here -->

## Cross-cutting constraints

- **Keep all git writes in `main.ts` / `GitService`.** `Events.ts` must stay
  read-only (the established invariant). New write ops follow the
  `recordAndRevertReview` precedent (`Git.ts:186`).
- **The loop contract changes (A0).** `gtd` stops being "emit exactly one prompt
  then return immediately" and becomes "drive the machine through no-agent edge
  states until it needs a human or an LLM, then emit exactly one prompt." The
  single-prompt-per-invocation _output_ contract is preserved (see Open
  Questions); only deterministic hops are collapsed into one process.

## Part A — no-agent edge states (inputs already exist when `gtd` runs)

These need zero LLM judgment — pure functions of the current tree. The edge does
the work, then re-resolves internally and emits the _next_ state's prompt.

### A0. `main.ts` internal loop (prerequisite)

- Refactor `main.ts` so the body after `detect()` (`main.ts:27`) is a loop:
  resolve → if leaf ∈ `NO_AGENT_EDGE_STATES`, run its `GitService` action, print
  a status line, `detect()` again → repeat. Exit the loop (and emit one prompt)
  when the leaf needs the agent or a human.
- Keep the existing `review-process` pre-render and `TEST_GATED_LEAVES` blocks
  (`main.ts:29-57`) — they remain _inside_ the loop body, since `code-changes`
  (now no-agent) can re-resolve into `human-review`/`execute` which are test-
  gated.
- `NO_AGENT_EDGE_STATES = { "cleanup", "close-review", "code-changes" }` for
  Part A. (Part B would add a generalized commit pass.)
- Termination + cycle guard: fixed hop cap (~8) + same-leaf-after-action
  progress assertion (see Open Questions); fail to stderr on violation via the
  existing `catchAll` (`main.ts:69-75`).
- The `auto-advance` partial (`prompts/partials/auto-advance.md`) stays for the
  agent-driven states; the edge owns the advance for no-agent states.

### A1. `cleanup` → no agent

- Edge detects empty `.gtd/` (`gtdDirExists && !hasPackages`). New
  `GitService.removeGtdDir()` deletes the directory; re-resolve → `verified`.
- Delete `prompts/cleanup.md` + its `Prompt.ts` import/`SECTIONS` entry; update
  e2e referencing the cleanup prompt.

### A2. `close-review` → no agent

- Extract `GitService.closeReview(base)` from the tail of
  `recordAndRevertReview` (`Git.ts:230-252`): discard working `REVIEW.md`,
  `git rm REVIEW.md`, commit
  `chore(gtd): close approved review for <short-sha>`. Reuse from both call
  sites.
- Base sha comes from `context.baseRef`. Pre-render block in `main.ts` mirrors
  `review-process`.
- Delete `prompts/close-review.md` + import/`SECTIONS` entry; update
  `review.feature` close-review assertions to assert the commit subject via
  `gitLog()` + the next leaf's prompt instead of the retired prompt string.

### A3. `code-changes` → no agent

- New `GitService.commitPending()`: `git add -A`,
  `git restore --staged TODO.md REVIEW.md`, commit
  `chore(gtd): commit pending changes` (skip if nothing staged). Pre-render
  block in `main.ts`.
- Delete `prompts/code-changes.md` + import/`SECTIONS` entry; update
  `auto-advance.feature` "Code changes prompt includes auto-advance" to assert
  the commit landed + the next prompt, not the (retired) commit prompt.

### A — testing (per AGENTS.md)

- New cucumber scenarios per state, using composable `Given` steps that show the
  actual tree state in scenario text (existing `Given a file …`,
  `Given a commit …` steps suffice). Assert post-loop observables via `gitLog()`
  / `lastCommitSubject()` + the next leaf's stdout, since the prompt is no
  longer the only output.
- Add a unit/e2e scenario for the loop cap + progress guard (force a no-agent
  state to recur and assert the error to stderr).

## Part B — generalize the post-agent commit (DEFERRED — follow-up plan)

> Out of scope for this plan per the first Open Question. Retained as the design
> sketch for the follow-up.

`execute`, `decompose`, `new-todo`, `modified-todo`, `execute-simple`,
`human-review`, and `fix-tests` all end by committing work the agent _produced
this run_. The edge runs before the agent (`detect()` at `main.ts:27`), so the
commit can't move into the same invocation. To remove `git commit` from these
prompts, move the commit to the **next** cycle's edge: the agent leaves output
uncommitted and re-runs `gtd`; the next edge detects the pending work plus a
deterministic intent and commits it (a generalized `code-changes` pass).

The hard problem (timing + disambiguation): the next edge sees a dirty tree but
must know _which_ state produced it to pick the message + cleanup. Today that
context lives in the just-run prompt; after the move it must be a **committed or
on-disk intent descriptor** the agent leaves behind. Candidates per state:

- `execute` → message is literally the package's `COMMIT_MSG.md`; the selected
  package and last-package `.gtd/` removal are already edge-known. The
  descriptor could be "an uncommitted package dir whose tasks are done" — but
  distinguishing "done, ready to commit" from "decompose just wrote it, not yet
  executed" is the crux and needs an explicit marker.
- `decompose` → `plan(gtd): decompose TODO.md into N work packages` (edge counts
  N) — but `COMMIT_MSG.md` _contents_ are agent-authored, and the uncommitted
  `.gtd/` looks identical to the execute-input case above.
- `human-review` → `review(gtd): create review for <short>` (edge has the base);
  base-marker injection is mechanical — only **hunk grouping** stays LLM work,
  and the uncommitted `REVIEW.md` is the descriptor.
- `new-todo` / `modified-todo` → fixed-ish message; `format` is already a
  deterministic `gtd format` call.
- `execute-simple` → message derived from `TODO.md` (mild judgment).
- `fix-tests` → fix is the agent's job; the `Gtd-Test-Fix:` trailer counting is
  already edge-side.

The follow-up must: (1) design ONE generalized post-agent edge-commit pass (not
per-state hacks); (2) define an explicit, committed/on-disk **intent
descriptor** that disambiguates which message/cleanup applies; (3) resolve
guard-ordering overlap with `code-changes` and `execute` so a "just-produced,
uncommitted" tree isn't misrouted; (4) decide whether `decompose`'s uncommitted
`.gtd/` vs `execute`'s consumed `.gtd/` need distinct markers.

## Resolved
