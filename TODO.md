---
status: complete
---

# Offload mechanical git/fs work from the agent to the deterministic edge

Continue the direction set by edge-driven `review-process`: move deterministic
git/filesystem work out of agent prompts and into the Effect **edge**
(`main.ts` + `GitService`, fed by read-only `Events.ts`). The agent should only
ever do work that needs LLM judgment; everything mechanical should be a pure
function of the tree, **decided by the machine** and executed by the edge.

Today the edge runs once per `gtd` invocation, then emits exactly one prompt;
the agent does the prompt's work and re-invokes `gtd` (the auto-advance loop is
agent-driven). `review-process` already proved the offload pattern: the edge
runs `recordAndRevertReview` before emitting (`main.ts:30-40`), leaving the
agent only synthesis. But today that offload is hard-coded in `main.ts` (an
`if (result.value === "review-process")` block and a `TEST_GATED_LEAVES` set) —
the edge, not the machine, decides to run those side effects.

This work package generalizes that into **one machine-directed-action model**:
the machine resolves to a leaf and, for any non-agent work, emits a typed
`EdgeAction` the edge executes — covering not just the no-agent git ops
(`removeGtdDir`/`closeReview`/`commitPending`) but ALSO the **test gate** and
the **review-process pre-render**. `main.ts` becomes a pure driver: ask the
machine → if it names an action (git op | run-test-gate | review-pre-render),
execute it via the right service and re-feed → else emit the prompt. Part A
lands the loop + no-agent states; Part B generalizes the post-agent commit as
another `EdgeAction` kind. **Both parts are in scope** (see Resolved).

## Cross-cutting constraints

- **`Machine.ts` stays pure.** No IO, no Effect, no git (`Machine.ts:3-11`). The
  machine may only _decide_ an `EdgeAction` and _detect_ stuck/cap via its own
  context; it never performs git, never runs the test suite, never reads/writes
  files. This is the hard boundary the whole design respects. The test-gate /
  review-pre-render results come back into the machine as **events** (see A0).
- **All git writes + the test-suite spawn + REVIEW.md recording stay in
  `main.ts` / `GitService` / `TestRunner`.** `Events.ts` stays read-only. New
  write ops follow the `recordAndRevertReview` precedent (`Git.ts:186`).
- **The loop contract changes.** `gtd` stops being "fold once, emit one prompt"
  and becomes "drive the machine through its edge-directed actions (each
  executed by the edge, results re-fed as events), then emit exactly one
  prompt." The single-prompt-per-invocation _output_ contract is preserved
  (Resolved q4). **No status output** of any kind — the only stdout is the final
  prompt (Resolved q6).

## Part A — machine-directed actions + no-agent edge states

These need zero LLM judgment — pure functions of the current tree, plus two
side-effect actions (test gate, review pre-render) whose _results_ the machine
folds. The machine decides each action; the edge executes it, re-feeds, and the
machine re-folds, until it settles on an agent/human leaf and one prompt is
emitted.

### A0. Machine-directed action loop (prerequisite)

The loop is **machine logic**, not a procedural hop-loop in `main.ts` (Resolved
q1, q2). The machine owns the decision to act and the termination/cycle
detection; `main.ts` is a dumb driver that executes whatever `EdgeAction` the
machine emits and re-feeds re-gathered facts (or the action's result).

**The `EdgeAction` vocabulary** (the single union covering every non-agent thing
the edge does):

```ts
export type EdgeAction =
  // --- no-agent git ops (Part A states; result = re-gathered events) ---
  | { kind: "removeGtdDir" } // cleanup leaf
  | { kind: "closeReview"; base: string } // close-review leaf
  | { kind: "commitPending" } // code-changes leaf (+ Part B)
  // --- side-effect actions whose result feeds back as an event ---
  | { kind: "runTestGate" } // gate before `execute` only
  | { kind: "reviewPreRender"; base: string } // review-process leaf
```

The first three are "fire-and-re-gather": the edge runs the git op, re-gathers
real events, and `advance`s the live actor. The last two carry a **result back
into the machine as a new event**, which the machine folds into the next leaf /
context (this is what makes the gate and pre-render machine-directed rather than
`main.ts` `if`s).

**Machine side (`Machine.ts`, stays pure):**

- The no-agent leaves (`cleanup`, `close-review`, `code-changes`) and the two
  side-effect leaves (`review-process`, plus a gate step in front of `execute`)
  stop being `type: "final"`. They become states that **emit an `EdgeAction`**
  (exposed on the snapshot) and accept the next event to transition back to
  `replaying` — so ONE actor stays alive across hops (Resolved q2: live-actor,
  not threaded-trace).
- Add `GtdContext` fields `noAgentHops: number` and
  `lastAdvancedLeaf: LeafState | null`; a `foldAdvance` action increments
  `noAgentHops` and records the leaf, mirroring `foldCommit`
  (`Machine.ts:149-154`).
- Add guards `noAgentCapReached` (`noAgentHops >= MAX_NO_AGENT_HOPS`) and
  `stuck` (the next no-agent leaf === `lastAdvancedLeaf`), routing to `escalate`
  — the deterministic analogue of `capReached` (`Machine.ts:130`). Named
  constant `MAX_NO_AGENT_HOPS = 8` beside `MAX_VERIFY_ITERATIONS`, never
  overridable. This cap is **orthogonal** to `verifyIterations`: separate
  constants, separate context fields, never conflated.
- **Test gate is machine-modeled and gated to `execute` ONLY** (Resolved q5).
  When the machine would settle on `execute` it first emits
  `{ kind: "runTestGate" }`. The edge runs the suite and sends back a
  `TEST_RESULT` event `{ exitCode, output }`. The machine folds it exactly as
  `selectPrompt` does today:
  - green (`exitCode === 0`) → proceed to `execute`;
  - red & `verifyIterations < maxVerifyIterations` → settle on a `fix-tests`
    leaf carrying the captured `testOutput` so `buildPrompt` can inject it;
  - red & `verifyIterations >= maxVerifyIterations` → `escalate`. The
    green/fix/escalate branching logic survives verbatim — it just moves from
    `selectPrompt` (an `if` in the edge) into the machine's fold of
    `TEST_RESULT`. **`human-review` is no longer test-gated** (today's behavior
    change): the gate fires only in front of `execute`.
- **Review pre-render is machine-modeled.** The `review-process` leaf emits
  `{ kind: "reviewPreRender"; base }`. The edge runs `recordAndRevertReview`,
  sends back a `REVIEW_RECORDED` event `{ diff, recordSha }`; the machine
  settles on `review-process` with that override data on context so
  `buildPrompt` renders the synthesis prompt (the agent-visible work that
  stays).

**Edge side (`State.ts` / `main.ts`):**

- `Machine.ts` exposes a **thin stepping handle** owning the live actor
  (Resolved q3): `start(events) → handle` and
  `handle.advance(events) → ResolveResult & { edgeAction?: EdgeAction }`. The
  one-shot `resolve(events)` stays as a trivial wrapper (`start` then read the
  first result) so existing unit tests of `resolve` keep compiling.
- `ResolveResult` gains `edgeAction?: EdgeAction` (present iff the settled leaf
  is an action leaf and not stuck/capped). The captured test output and
  review-record data ride on context (or on the result), feeding `buildPrompt`.
- `detect()` (`State.ts:57`) is reconciled: it keeps `gatherEvents()` then opens
  the handle and returns it (or `main.ts` opens the handle and `detect` becomes
  `gatherEvents` + `start`). `selectPrompt`/`PromptSelection`/`PromptOverride`
  collapse into the machine's `TEST_RESULT`/`REVIEW_RECORDED` fold — the
  `fix-tests`/`escalate`/`review-process` override now comes from the resolved
  leaf, not a separate `selectPrompt` call.
- `main.ts` driver loop (no leaf-identity branching, no `TEST_GATED_LEAVES`, no
  `review-process` `if`):
  ```
  handle = start(gatherEvents())
  loop:
    r = handle.current
    switch r.edgeAction?.kind:
      removeGtdDir | closeReview | commitPending:
        git op; handle.advance(gatherEvents()); continue
      runTestGate:
        t = TestRunner.run(); handle.advance([{TEST_RESULT t}]); continue
      reviewPreRender:
        rec = git.recordAndRevertReview(base)
        handle.advance([{REVIEW_RECORDED rec}]); continue
      undefined:
        write(buildPrompt(r, override-from-context)); return
  ```
- If the machine routes to `escalate` (verify cap, no-agent cap, or stuck),
  `edgeAction` is absent and the `escalate` prompt is emitted via the same tail.
- **No status output** (Resolved q6): the loop writes nothing until the final
  `buildPrompt`. The machine never writes; the edge writes exactly one prompt.

The `auto-advance` partial (`prompts/partials/auto-advance.md`) stays for the
agent-driven re-run of agent leaves. The `auto-advance` tag now means "the
machine may emit an `EdgeAction` for this leaf" — read by the driver, not the
agent.

### A1. `cleanup` → no agent

- Machine emits `{ kind: "removeGtdDir" }` for the `cleanup` leaf (guard already
  `gtdDirExists && !hasPackages`, `Machine.ts:213`). New
  `GitService.removeGtdDir()` deletes the directory; re-gather → re-fold →
  `verified`.
- Delete `src/prompts/cleanup.md` + its `Prompt.ts` import/`SECTIONS` entry;
  update e2e referencing the cleanup prompt.

### A2. `close-review` → no agent

- Machine emits `{ kind: "closeReview", base }` (`base` from `context.baseRef`)
  for the `close-review` leaf. Extract `GitService.closeReview(base)` from the
  tail of `recordAndRevertReview` (`Git.ts:230-252`): discard working
  `REVIEW.md`, `git rm REVIEW.md`, commit
  `chore(gtd): close approved review for <short-sha>`. Reuse from both sites.
- Delete `src/prompts/close-review.md` + import/`SECTIONS` entry. This prompt
  also carries a now-removed "Test gate (run first)" block, so retiring it is
  consistent with the q5 steer. Update `review.feature` close-review assertions
  to assert the commit subject via `gitLog()` + the next leaf's prompt instead
  of the retired prompt string.

### A3. `code-changes` → no agent

- Machine emits `{ kind: "commitPending" }` for the `code-changes` leaf. New
  `GitService.commitPending()`: `git add -A`,
  `git restore --staged TODO.md REVIEW.md`, commit
  `chore(gtd): commit pending changes` (skip if nothing staged). Fixed
  conventional message — the current prompt specifies none, so none is lost.
- Caveat: `codeDirty` is gated by `!reviewPresent` (`Machine.ts:125`), so
  `code-changes` never fires while a REVIEW.md exists; keep the
  `git restore --staged REVIEW.md` anyway (belt-and-suspenders).
- Delete `src/prompts/code-changes.md` + import/`SECTIONS` entry; update
  `auto-advance.feature` "Code changes prompt includes auto-advance" to assert
  the commit landed + the next prompt, not the (retired) commit prompt.

### A4. Test gate → machine-directed, `execute` only

- Remove `TEST_GATED_LEAVES` from `main.ts:49-57` entirely. The machine emits
  `{ kind: "runTestGate" }` in front of `execute`; the edge runs `TestRunner`
  and feeds `TEST_RESULT` back. `human-review` stops running the suite.
- **Remove the "Test gate (run first)" block** from the planning/agent prompts
  that no longer carry it: `src/prompts/new-todo.md`,
  `src/prompts/modified-todo.md`, `src/prompts/verified.md` (and
  `close-review.md` is retired in A2). The gate survives ONLY in front of
  `execute`. `escalate.md`/`fix-tests.md` test-gate wording stays — they ARE the
  gate's red branches.
- Reconcile `selectPrompt` (`State.ts:37`): its green/fix-tests/escalate logic
  moves into the machine's `TEST_RESULT` fold; the cap comparison still reads
  `verifyIterations` vs `maxVerifyIterations`.

### A5. Review pre-render → machine-directed

- Remove the `review-process` `if` block from `main.ts:30-40`. The machine emits
  `{ kind: "reviewPreRender"; base }` for the `review-process` leaf; the edge
  runs `recordAndRevertReview(base)` and feeds
  `REVIEW_RECORDED { diff, recordSha }` back. The machine settles on
  `review-process` carrying that override so `buildPrompt` renders the synthesis
  prompt unchanged. `human-review`'s REVIEW.md _generation_ is still agent work
  (unchanged prompt); only its test-gate is dropped (A4).

### A — testing (per AGENTS.md)

- New cucumber scenarios per state, using composable `Given` steps that show the
  actual tree state in scenario text (existing `Given a file …`,
  `Given a commit …` steps suffice). Assert post-loop observables via `gitLog()`
  / `lastCommitSubject()` + the next leaf's stdout, since the prompt is no
  longer the only output of a no-agent state.
- Test-gate scenarios: a dirty package tree with green tests advances into the
  `execute` prompt; with red tests below cap → `fix-tests` prompt carrying the
  captured output; at cap → `escalate`. Assert `human-review` does NOT spawn the
  runner anymore.
- Add a scenario for the no-agent hop cap + stuck guard (force a no-agent state
  to recur — e.g. a `commitPending` that leaves the tree dirty — and assert
  escalate). Primary coverage is a focused `Machine.ts` unit test driving the
  live actor through repeated no-agent + `TEST_RESULT`/`REVIEW_RECORDED` events
  and asserting the fold (green→execute, red<cap→fix-tests, red≥cap→escalate,
  hops≥cap→escalate); the e2e is the integration check.

## Part B — generalize the post-agent commit (IN SCOPE; sequence after A)

Part B is in scope (Resolved q1). Sequence it as later packages that land after
A0's loop is proven by A1–A5, but decompose it here.

`execute`, `decompose`, `new-todo`, `modified-todo`, `execute-simple`,
`human-review`, and `fix-tests` all end by committing work the agent _produced
this run_. The edge runs before the agent (`detect()` at `main.ts:27`), so the
commit can't move into the same invocation. To remove `git commit` from these
prompts, move it to the **next** cycle's edge as **another
`commitPending`-shaped `EdgeAction`** in the A0 loop: the agent leaves output
uncommitted and re-runs `gtd`; the next edge detects pending work plus a
deterministic intent and the machine emits a commit action.

The hard problem (timing + disambiguation): the next edge sees a dirty tree but
must know _which_ state produced it to pick the message + cleanup. After the
move that must be a **committed or on-disk intent descriptor** the agent leaves
behind. Per state:

- `execute` → message is the package's `COMMIT_MSG.md`; selected package +
  last-package `.gtd/` removal are edge-known. Crux: distinguish "done, ready to
  commit" from "decompose just wrote it, not yet executed" — needs an explicit
  marker.
- `decompose` → `plan(gtd): decompose TODO.md into N work packages` (edge counts
  N); the uncommitted `.gtd/` looks identical to execute-input above.
- `human-review` → `review(gtd): create review for <short>` (edge has the base);
  only **hunk grouping** stays LLM work; the uncommitted `REVIEW.md` is the
  descriptor.
- `new-todo` / `modified-todo` → fixed-ish message; `format` is a deterministic
  `gtd format` call.
- `execute-simple` → message derived from `TODO.md` (mild judgment).
- `fix-tests` → fix is the agent's job; the `Gtd-Test-Fix:` trailer counting is
  edge-side.

The Part B packages must: (1) extend the `EdgeAction` commit kind (not per-state
hacks) so it carries the disambiguated message/cleanup; (2) define an explicit,
committed/on-disk **intent descriptor** the machine folds to pick that message;
(3) resolve guard-ordering overlap with `code-changes` and `execute` so a
"just-produced, uncommitted" tree isn't misrouted (a new machine guard-ordering
problem on top of A0); (4) decide whether `decompose`'s uncommitted `.gtd/` vs
`execute`'s consumed `.gtd/` need distinct markers. Because the commit is a
machine-emitted `EdgeAction`, the A0 no-agent hop cap / stuck guard already
bounds it — a post-agent commit that fails to clear its dirty tree escalates
rather than spins.

## Resolved

### A0 split: does the machine PERFORM the no-agent git side effects, or only DECIDE the action sequence while main.ts/GitService execute it?

**Recommendation: (a) Machine decides, edge executes, edge re-feeds.** The fold
resolves to a leaf PLUS a typed `EdgeAction`
(`{kind:"closeReview",base} | {kind:"removeGtdDir"} | {kind:"commitPending"}`);
`main.ts` executes it via `GitService`, re-gathers events, re-folds.
`Machine.ts` stays pure (no tree model, no duplicated git semantics); `main.ts`
branches on nothing. (b) — an in-machine pure git-write simulator — is rejected
as a big new surface.

**Answer:** agreed.

### Where does cycle-detection / termination live, given the fold is restarted each hop?

**Recommendation: (b) one long-lived xstate actor across hops.** No-agent leaves
stop being `type:"final"` and transition back to `replaying`; a `noAgentHops` /
`lastAdvancedLeaf` counter persists in machine `context`; a stuck/cap guard
reads it (mirrors `verifyIterations` / `capReached`). Named constant
`MAX_NO_AGENT_HOPS = 8`, never overridable.

**Answer:** agreed.

### What do `resolve` / `ResolveResult` become so main.ts can drive multi-hop transitions?

**Recommendation:** expose a thin stepping handle (`start` + `advance`) owning
the live actor, returning `ResolveResult & { edgeAction?: EdgeAction }` each
step; keep the one-shot `resolve(events)` as a trivial wrapper so existing unit
tests compile. Reconcile `detect()` in `State.ts`.

**Answer:** agreed.

### Does the internal loop change the "exactly one prompt" stdout contract?

**Recommendation: no — still exactly ONE prompt per `gtd` run;** the loop only
collapses no-agent hops; e2e assert post-loop observables (git log + next leaf's
prompt).

**Answer:** agreed.

### How does the test gate interleave with a multi-hop machine advance?

**Recommendation (superseded by the answer):** gate at loop exit only, on the
settled leaf; keep verify-cap and no-agent-cap independent.

**Answer:** both test and review gate have to be part of the machine as well.
test gate should only be enforced before package execution, not before planning
steps.

(Integrated: the test gate and the review-process pre-render are now
machine-emitted `EdgeAction`s — `{kind:"runTestGate"}` and
`{kind:"reviewPreRender"}` — whose results (`TEST_RESULT`, `REVIEW_RECORDED`)
the machine folds. The gate fires ONLY before `execute`; `human-review` is no
longer test-gated, and the "Test gate (run first)" blocks are removed from the
planning prompts. `selectPrompt`'s green/fix-tests/escalate branching survives,
moved into the machine's `TEST_RESULT` fold.)

### How should the edge report each machine-driven no-agent action?

**Recommendation (superseded by the answer):** one plain status line per
executed `EdgeAction` to stdout before the final prompt.

**Answer:** no output. the user does not watch it. we just create the prompt for
the next agent invocation.

(Integrated: all "emit a status line per edge action" design removed; the only
stdout is the single final prompt.)

### Should Part B ship in this plan, or split into a follow-up once Part A lands?

**Recommendation:** split Part B into its own follow-up plan.

**Answer:** Keep Part B IN this plan — do not defer. Build A and B in one work
stream; B may be sequenced as later packages that land after A is proven, but it
is in scope for this plan's decomposition.

### How does the internal loop terminate and bound against pathological cycles?

**Recommendation:** a small fixed iteration cap on edge-only hops AND a strict
progress assertion.

**Answer:** Don't model the loop as a procedural hop-loop in `main.ts`. The
internal loop should itself be **part of the state machine** — model the
no-agent advance as machine transitions and detect pathological loops inside the
machine's logic, not in imperative edge code. (Integrated via A0 + the
long-lived-actor decision above.)
