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
generalizes the post-agent commit (Part B). **Both parts are in scope for this
plan** (see Resolved); B may be sequenced as later packages that land after A is
proven, but the decomposition must cover both.

## Open Questions

### A0 split of responsibility: does the machine PERFORM the no-agent git side effects, or only DECIDE the action sequence while main.ts/GitService execute it?

The user's answer makes the internal loop "part of the state machine." But
`Machine.ts` is, by hard invariant (`Machine.ts:3-11`), pure: no IO, no Effect,
no git. The no-agent advances (`removeGtdDir`, `closeReview`, `commitPending`)
are git WRITES that must stay on the edge (`Git.ts`, cross-cutting constraint
below). So "the loop is machine logic" cannot mean the machine runs git. The
crisp split must be one of:

- **(a) Machine decides, edge executes, edge re-feeds.** The fold now resolves
  to a leaf PLUS, when that leaf is a no-agent state, a typed `EdgeAction`
  descriptor
  (`{ kind: "closeReview", base } | { kind: "removeGtdDir" } | { kind: "commitPending" }`).
  `main.ts` executes the action via `GitService`, re-gathers events, re-folds.
  The loop _body_ is still in `main.ts`, but the _decision of what action to run
  and whether to keep going_ is 100% machine output — main.ts has zero branching
  on leaf identity, it just runs the action the machine names until the machine
  names none.
- **(b) Machine drives a multi-hop fold internally.** `resolve` itself becomes
  iterative: it folds to a leaf, and if that leaf is a no-agent state it
  _applies a pure tree-delta function_ to a model of the working tree, then
  re-folds — looping inside `resolve` until a fixpoint (agent/human leaf). The
  edge would have to hand the machine a _pure model of the tree_ it can mutate
  in-memory (predicted post-action `ResolvePayload`), and then replay the real
  git writes afterward. This is much heavier: it duplicates git semantics as a
  pure predictor.

**Recommendation: (a).** It keeps `Machine.ts` pure (no tree model, no
duplicated git semantics), satisfies "decision is machine logic" (main.ts
branches on nothing — it executes the `EdgeAction` the machine emits and
re-feeds the real re-gathered events), and reuses the existing `gatherEvents` →
`resolve` path verbatim per hop. The "loop is machine logic" claim is honored by
making the machine the sole authority on (1) which no-agent action to run and
(2) whether another hop is warranted — main.ts becomes a dumb driver. (b) is
rejected unless the user specifically wants the tree-delta predicted in-machine
(big new surface: a pure git-write simulator).

<!-- user answers here -->

### Where does cycle-detection / termination live, given the fold is restarted from scratch each hop?

Today each `gtd` run builds events fresh and folds from `initialContext`; across
the A0 loop, main.ts will re-gather and re-fold each hop, so the machine starts
from `initialContext` every iteration and has **no memory** of prior hops.
"Stuck / self-resolving" detection as _machine logic_ therefore needs a place to
thread hop history. Options:

- **(a) Thread a visited-set / hop-count into the fold as input.** Add an event
  (e.g. `{ type: "ADVANCE"; priorLeaf: LeafState; hop: number }`) or extend the
  RESOLVE payload with `priorAdvances: ReadonlyArray<LeafState>`; main.ts
  accumulates the trace across hops and feeds it back in, and a machine guard
  (`stuck`: next no-agent leaf === last advanced leaf, or `hop >= cap`) routes
  to `escalate`. Detection lives in a guard (machine logic); main.ts only
  carries the accumulator forward — the analogue of how `verifyIterations` is
  already folded from `COMMIT` events (`Machine.ts:149-154`).
- **(b) Make the no-agent advance a real xstate transition with persisted
  context.** Instead of restarting the actor each hop, keep ONE actor alive
  across hops: send `RESOLVE`, read the emitted `EdgeAction`, edge executes it,
  then send a new `RESOLVE` with re-gathered facts to the SAME running actor, so
  `verifyIterations`-style context (a `noAgentHops` counter, `lastAdvancedLeaf`)
  persists in `GtdContext` and the cap/stuck guard reads it directly. This makes
  the loop genuinely a sequence of machine transitions (the user's literal
  framing) rather than N independent folds.

**Recommendation: (b).** It is the most faithful reading of "the loop is part of
the state machine": the machine is a long-lived actor whose context accumulates
hop state, the no-agent advance is a modeled transition (no-agent leaf → back to
`replaying` on the next RESOLVE), and the stuck/cap guard is ordinary machine
logic reading `context.noAgentHops` / `context.lastAdvancedLeaf` — exactly
mirroring the existing `capReached` guard (`Machine.ts:130`). This requires the
no-agent final states to stop being `type: "final"` (a final state can't accept
another event) and instead transition back to `replaying`, plus `resolve` to
expose an actor-stepping API rather than the one-shot fold. Cap value: reuse a
named constant beside `MAX_VERIFY_ITERATIONS` (e.g. `MAX_NO_AGENT_HOPS = 8`);
never overridable.

<!-- user answers here -->

### What does `resolve` / `ResolveResult` become so main.ts can drive multi-hop transitions?

Today `resolve(events)` creates a fresh actor, sends all events, snapshots once,
discards the actor (`Machine.ts:288-298`); `ResolveResult` is
`{ value, context, autoAdvance }`. Driving the machine through no-agent hops
needs the actor (or its step function) to survive between hops AND the result to
carry the no-agent `EdgeAction` (per the first question's option (a)).
Concretely `ResolveResult` likely gains an `edgeAction?: EdgeAction` (present
iff the leaf is no-agent and not stuck/capped), and the module exposes either:

- a stepping API: `start(events) → handle`, `handle.advance(newEvents) → result`
  keeping one actor alive (pairs with the cap-in-context option (b)); or
- a stateless `resolve(events, priorAdvances)` that re-creates the actor but is
  fed the accumulated trace (pairs with option (a) of the previous question).

main.ts's post-`detect` block becomes: fold → if `result.edgeAction`, execute it
via `GitService`, print a status line, re-gather + re-step, repeat → when
`edgeAction` is absent, fall through to the existing test-gate / review-process
/ buildPrompt tail and emit exactly one prompt.

**Recommendation: expose a thin stepping handle** (`start` + `advance`) that
owns the live actor, returning `ResolveResult & { edgeAction?: EdgeAction }`
each step. This keeps the cap/stuck state in `GtdContext` (machine logic), keeps
main.ts free of leaf-identity branching, and leaves the existing one-shot
`resolve(events)` as a trivial wrapper (`start(events)` then read) so all
current unit tests of `resolve` keep compiling. Pin down in implementation:
`detect()` (`State.ts:57`) currently returns a single `ResolveResult`; it must
either return the handle or be split into `gatherEvents` (kept) + an explicit
driver in main.ts.

<!-- user answers here -->

### Does the internal loop change the "exactly one prompt" stdout contract, now that the advance is a machine transition rather than a main.ts hop-loop?

**Recommendation: no — still exactly one prompt per `gtd` run; the
machine-driven advances are silent except for one status line each.** The output
contract is unchanged from the procedural framing: every `gtd` invocation drives
the machine through its no-agent transitions (each executed by the edge), then
emits exactly **one** prompt for the first agent/human leaf and exits. What the
machine-loop answer changes is _internal_: the decision to keep advancing is a
machine guard, not a main.ts `if`. Stdout is unaffected — the machine never
writes; only the edge writes the per-action status line + the final prompt.

e2e impact is the same as before: tests spawn `scripts/gtd.js` once (`world.ts`)
and assert a single `stdout`. `auto-advance.feature`'s "Code changes prompt
includes auto-advance" must change — `code-changes` becomes a no-agent
transition, so a dirty-file run commits and re-folds to the next leaf rather
than emitting the commit prompt. New e2e assert the **post-loop** observable:
the commit exists in `git log` (`gitLog()`, `lastCommitSubject()`) AND stdout
shows the _next_ leaf's prompt. The bundled `scripts/gtd.js` and the
`<command>gtd</command>` skill (`SKILL.md` step 2) keep working: the agent still
reads exactly one prompt; the auto-advance partial still drives the
agent-visible re-run for agent leaves. Only deterministic transitions are
absorbed.

One open sub-point the machine framing sharpens: the test gate
(`TEST_GATED_LEAVES`, `main.ts:49-57`) and the `review-process` pre-render
(`main.ts:30-40`) currently run _after_ the single fold. With a multi-hop
machine advance they must run _at loop exit_, on the final non-no-agent leaf —
because a no-agent `code-changes` advance can re-fold into a test-gated
`human-review` / `execute`. Confirm: gate runs once, on the terminal leaf the
machine settles on, not per hop. (See the test-gate interleave question below.)

<!-- user answers here -->

### How does the test gate interleave with a multi-hop machine advance?

`TEST_GATED_LEAVES = {human-review, execute}` (`main.ts:49`) runs the suite
before emitting their prompt; `review-process` runs `recordAndRevertReview`
before emitting. With the A0 machine loop, a no-agent advance (`code-changes`
commit) can settle the machine on a test-gated leaf. The gate must run **exactly
once, at loop exit, on the settled leaf** — never per no-agent hop (no no-agent
leaf is test-gated, so running the suite mid-loop would be wasted work and could
spuriously escalate). Concretely: the loop body executes only `edgeAction`s;
when the machine emits no `edgeAction` (settled on an agent/human leaf), main.ts
then runs the existing review-process pre-render / test-gate / buildPrompt tail
unchanged. Open: should the settled leaf's identity come from the machine handle
(clean) and does `selectPrompt`'s cap interplay (`State.ts:43-46`, escalate on
red ≥ cap) need to compose with the _new_ no-agent-hop cap, or are they fully
independent counters (recommend independent: `verifyIterations` counts
`fix(gtd)` commits, `noAgentHops` counts deterministic advances — orthogonal,
never conflated)?

**Recommendation: gate at loop exit only, on the settled leaf; keep the two caps
independent and orthogonal.** Move the review-process pre-render and the
`TEST_GATED_LEAVES` block to _after_ the no-agent loop terminates, operating on
the final `ResolveResult`. The no-agent-hop cap and the verify cap stay separate
named constants and separate context fields. This preserves "run the suite at
most once per `gtd` invocation" and avoids re-spawning the runner on every
deterministic hop.

<!-- user answers here -->

### How should the edge report each machine-driven no-agent action, given the user watches gtd output?

**Recommendation: one plain status line per executed `EdgeAction`, to stdout,
before the final prompt; honor the dirty/newline discipline.** When the machine
absorbs hops that the agent used to narrate, the user loses visibility. The edge
(which executes the action) prints one line per action it ran, e.g.
`gtd: committed pending changes (chore(gtd): commit pending changes)` /
`gtd: closed review for abc1234` / `gtd: removed empty .gtd/`, then the next
leaf's prompt. Because the machine emits the `EdgeAction` (it knows the action's
identity), the status text can be derived from the action descriptor in one
place rather than scattered per call site. Per AGENTS.md stdout notes: each
status line ends in `\n`, and the subsequent prompt write
(`process.stdout.write(prompt)`, prompt already ends `\n`, `Prompt.ts:185`) must
not assume a clean line — prefixing `status + "\n"` is safe. Always print
(low-volume, one per deterministic action); only route through the event
handler's `verbose` gate if these are emitted via the handler.

<!-- user answers here -->

## Cross-cutting constraints

- **`Machine.ts` stays pure.** No IO, no Effect, no git (`Machine.ts:3-11`). The
  machine may only _decide_ the no-agent `EdgeAction` and _detect_ stuck/cap via
  its own context; it never performs git. This is the hard boundary the A0
  design must respect.
- **Keep all git writes in `main.ts` / `GitService`.** `Events.ts` stays
  read-only. New write ops follow the `recordAndRevertReview` precedent
  (`Git.ts:186`).
- **The loop contract changes (A0).** `gtd` stops being "fold once, emit one
  prompt" and becomes "drive the machine through its no-agent transitions
  (edge-executed), then emit exactly one prompt." The single-prompt-per-
  invocation _output_ contract is preserved (see Open Questions); only
  deterministic transitions are collapsed into one process.

## Part A — no-agent edge states (inputs already exist when `gtd` runs)

These need zero LLM judgment — pure functions of the current tree. The machine
decides the no-agent advance; the edge executes it, re-gathers, and the machine
re-folds, until it settles on an agent/human leaf and one prompt is emitted.

### A0. Machine-modeled no-agent loop (prerequisite)

Per the user's answer, the loop is **machine logic**, not a procedural hop-loop
in `main.ts`. The machine owns the decision to advance and the termination/cycle
detection; `main.ts` is a dumb driver that executes whatever `EdgeAction` the
machine emits and re-feeds re-gathered facts.

- **Machine side (`Machine.ts`, stays pure):**
  - No-agent leaves (`cleanup`, `close-review`, `code-changes`) stop being
    `type: "final"`; they become states that emit an `EdgeAction` descriptor and
    accept the next `RESOLVE` to return to `replaying` (so the actor is
    long-lived across hops — see Open Questions for the live-actor vs.
    threaded-trace decision).
  - Add `GtdContext` fields `noAgentHops: number` and
    `lastAdvancedLeaf: LeafState | null`; a `foldAdvance` action increments
    `noAgentHops` and records the leaf, mirroring `foldCommit`
    (`Machine.ts:149-154`).
  - Add machine guards `noAgentCapReached` (`noAgentHops >= MAX_NO_AGENT_HOPS`)
    and `stuck` (next no-agent leaf === `lastAdvancedLeaf`), routing to
    `escalate` — the deterministic analogue of `capReached` (`Machine.ts:130`).
  - Define
    `EdgeAction = { kind: "removeGtdDir" } | { kind: "closeReview"; base string } | { kind: "commitPending" }`;
    the machine attaches it to the no-agent leaf's result.
- **Edge side (`State.ts` / `main.ts`):**
  - `resolve` exposes a stepping handle (`start`/`advance`) over a live actor;
    `ResolveResult` gains `edgeAction?: EdgeAction`. The one-shot
    `resolve(events)` stays as a wrapper so existing unit tests compile.
  - `main.ts` loop body: while the machine emits an `edgeAction`, dispatch it to
    `GitService`, print a status line, re-gather events, `advance`. On no
    `edgeAction`, fall through to the (relocated) review-process pre-render /
    test-gate / buildPrompt tail and emit one prompt.
  - The hop cap + stuck guard are machine logic; if the machine routes to
    `escalate` because of them, main.ts emits the escalate prompt (no special
    edge handling) — or fails to stderr via `catchAll` (`main.ts:69-75`)
    depending on the chosen escalate semantics (pin in Open Questions).
- The `auto-advance` partial (`prompts/partials/auto-advance.md`) stays for the
  agent-driven states; the machine+edge own the advance for no-agent states. The
  `auto-advance` tag now means "the machine may emit an `EdgeAction` for this
  leaf" — read by the driver, not the agent.

### A1. `cleanup` → no agent

- Machine emits `{ kind: "removeGtdDir" }` for the `cleanup` leaf (guard already
  `gtdDirExists && !hasPackages`, `Machine.ts:213`). New
  `GitService.removeGtdDir()` deletes the directory; re-fold → `verified`.
- Delete `prompts/cleanup.md` + its `Prompt.ts` import/`SECTIONS` entry; update
  e2e referencing the cleanup prompt.

### A2. `close-review` → no agent

- Machine emits `{ kind: "closeReview", base }` (`base` from `context.baseRef`)
  for the `close-review` leaf. Extract `GitService.closeReview(base)` from the
  tail of `recordAndRevertReview` (`Git.ts:230-252`): discard working
  `REVIEW.md`, `git rm REVIEW.md`, commit
  `chore(gtd): close approved review for <short-sha>`. Reuse from both sites.
- Delete `prompts/close-review.md` + import/`SECTIONS` entry; update
  `review.feature` close-review assertions to assert the commit subject via
  `gitLog()` + the next leaf's prompt instead of the retired prompt string.

### A3. `code-changes` → no agent

- Machine emits `{ kind: "commitPending" }` for the `code-changes` leaf. New
  `GitService.commitPending()`: `git add -A`,
  `git restore --staged TODO.md REVIEW.md`, commit
  `chore(gtd): commit pending changes` (skip if nothing staged). Fixed
  conventional message — the current prompt specifies no message, so none is
  lost (see Resolved-adjacent reasoning retained in the prior `code-changes`
  recommendation, now folded into Part B's commit-contract analysis).
- Caveat: `codeDirty` is gated by `!reviewPresent` (`Machine.ts:125`), so
  `code-changes` never fires while a REVIEW.md exists; keep the
  `git restore --staged REVIEW.md` anyway (belt-and-suspenders, matches prompt).
- Delete `prompts/code-changes.md` + import/`SECTIONS` entry; update
  `auto-advance.feature` "Code changes prompt includes auto-advance" to assert
  the commit landed + the next prompt, not the (retired) commit prompt.

### A — testing (per AGENTS.md)

- New cucumber scenarios per state, using composable `Given` steps that show the
  actual tree state in scenario text (existing `Given a file …`,
  `Given a commit …` steps suffice). Assert post-loop observables via `gitLog()`
  / `lastCommitSubject()` + the next leaf's stdout, since the prompt is no
  longer the only output.
- Add a scenario for the machine's no-agent hop cap + stuck guard (force a
  no-agent state to recur — e.g. a `commitPending` that leaves the tree dirty —
  and assert escalate / error to stderr). This exercises the cap/stuck guard as
  _machine logic_, so a focused unit test on `Machine.ts` (drive the actor
  through repeated no-agent RESOLVEs and assert it routes to `escalate`) is the
  primary coverage; the e2e is the integration check.

## Part B — generalize the post-agent commit (IN SCOPE; sequence after A)

Per the first Resolved answer, Part B is in scope for this plan's decomposition.
Sequence it as later packages that land after A0's machine loop is proven by A1–
A3, but it must be decomposed here.

`execute`, `decompose`, `new-todo`, `modified-todo`, `execute-simple`,
`human-review`, and `fix-tests` all end by committing work the agent _produced
this run_. The edge runs before the agent (`detect()` at `main.ts:27`), so the
commit can't move into the same invocation. To remove `git commit` from these
prompts, move the commit to the **next** cycle's edge: the agent leaves output
uncommitted and re-runs `gtd`; the next edge detects the pending work plus a
deterministic intent and commits it (a generalized `code-changes` pass that
slots into the A0 machine loop as another `EdgeAction` kind).

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

The Part B packages must: (1) design ONE generalized post-agent edge-commit pass
as an `EdgeAction` kind in the A0 machine loop (not per-state hacks); (2) define
an explicit, committed/on-disk **intent descriptor** that disambiguates which
message/cleanup applies; (3) resolve guard-ordering overlap with `code-changes`
and `execute` so a "just-produced, uncommitted" tree isn't misrouted (this is a
new machine guard ordering problem, on top of A0); (4) decide whether
`decompose`'s uncommitted `.gtd/` vs `execute`'s consumed `.gtd/` need distinct
markers. Because the commit becomes a machine-emitted `EdgeAction`, the no-agent
hop cap / stuck guard from A0 must also bound this pass (a post-agent commit
that fails to clear its dirty tree must escalate, not spin).

## Resolved

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
  commit pass instead of being misread. This is a commit-contract redesign, not
  an offload of a pure function.

**Answer:** Keep Part B IN this plan — do not defer. Build A and B in one work
stream; B may be sequenced as later packages that land after A is proven, but it
is in scope for this plan's decomposition.

### How does the internal loop terminate and bound against pathological cycles?

**Recommendation: bound by a small fixed iteration cap on edge-only hops AND by
requiring strict progress.** The loop only continues while the resolved leaf is
a _no-agent edge state_ (`cleanup`, `close-review`, `code-changes`, and later
Part B's commit pass). Every such action mutates git, so a correctly-behaving
action changes the fold's inputs and cannot resolve to itself forever. But to
harden against a logic bug, add:

1. A hard cap (e.g. **8** edge hops) on the number of no-agent actions per `gtd`
   invocation; on exceeding it, fail with a clear error to stderr.
2. A progress assertion: track the resolved leaf value across hops; if the same
   leaf resolves twice in a row _after its action ran_, treat it as a stuck
   state and fail rather than spin.

The cap is edge-internal and never overridable. Terminal leaves with the
`auto-advance` tag that still need the _agent_ end the loop and emit.

**Answer:** Don't model the loop as a procedural hop-loop in `main.ts`. The
internal loop should itself be **part of the state machine** — model the
no-agent advance as machine transitions and detect pathological loops (stuck /
self-resolving states) inside the machine's logic, not in imperative edge code.
`main.ts` should drive the machine and act on the deterministic transitions it
emits, keeping the cycle-detection/termination as machine logic. Re-grill A0 and
the stdout-contract question against this framing — it changes how the edge and
machine split responsibility.
