# The gtd v2 state machine

`gtd` is a turn-taking state machine layered over a git branch. There is no
long-lived process and no daemon: every invocation is a single
`gather → resolve → (perform)` hop, or a short chain of hops. The machine
(`src/Machine.ts`) is a pure function from an event stream (first-parent commit
history + a working-tree snapshot) to a `Result`; all git/filesystem IO lives at
the edge (`src/Events.ts`).

This document is the design reference for that machine: the turn-taking model,
the commit-subject grammar, the command surface, the 16 states, the precedence
ladder, canonical transcripts, and the loop protocol an agent should follow to
drive it. It documents the shipped v2 engine — `gtd step` / `gtd step-agent` /
`gtd next` — not the earlier single-mutating-command design. Where this document
and the code disagree, the code (`src/Machine.ts`, `src/Subjects.ts`,
`src/Events.ts`) wins.

## 1. The turn-taking model

`gtd` alternates turns between two actors, **human** and **agent**. At any
resolved state, the machine is either:

- **at rest**, awaiting one specific actor's next turn, or
- **mid-chain**, meaning there is a further deterministic bookkeeping step
  (`EdgeAction`) to perform before the next rest is reached.

A transition is a pure function of four inputs, nothing else:

1. **the invoking actor** — `"human"` (`gtd step`), `"agent"`
   (`gtd step-agent`), or `"none"` (`gtd next` / `gtd status`, which never
   mutate)
2. **whether the working tree is dirty or clean**
3. **the class of HEAD's commit subject** — turn commit, routing commit, or
   boundary commit (§2)
4. **which steering files are present** (`TODO.md`, `.gtd/`, `REVIEW.md`,
   `FEEDBACK.md`, `ERRORS.md`, `HEALTH.md`, `SQUASH_MSG.md`)

**File content never steers**, with exactly two machine-verified exceptions:

- **FEEDBACK.md emptiness** — a whitespace-only `FEEDBACK.md` written by a fresh
  agentic review is the approval signal (`feedbackEmpty` in `ResolvePayload`); a
  non-empty one is a findings round.
- **REVIEW.md checkbox-only diffs** — a pending `REVIEW.md` edit that is purely
  `- [ ]` ↔ `- [x]` flips (and nothing else dirty) is an approval signal, not
  review feedback (`isCheckboxOnlyDiff` in `src/Events.ts`).

Every other piece of content — TODO.md prose, FEEDBACK.md's actual findings
text, REVIEW.md's prose, code diffs — is inlined into prompts for agents/humans
to read, but never inspected by the resolver to make a routing decision.

**One commit per turn** at every await-actor gate: `gtd step` / `gtd step-agent`
author at most one turn commit (`gtd(<actor>): <gate>`) per invocation for the
actor's own turn, then continue only through mid-chain routing hops until the
next rest.

**Empty agent turns are inert.** If the agent runs `gtd step-agent` with nothing
dirty, the machine still records a turn commit (so the chain has a checkpoint
and `gtd next` can re-emit the exact same prompt), but it does not advance the
workflow — a second clean `gtd step-agent` authors nothing further.

**Empty human turns mean accept/approve.** A clean `gtd step` at a human gate
(the grilling answer gate, the review gate) is read as "no notes" — accept the
suggested defaults, or approve the review — and the machine advances accordingly
(grilling converges to `gtd: grilled`; a clean review converges to `gtd: done`).

**The idle carve-out.** At idle, a human `gtd step` never authors an empty turn
commit and never plain no-ops: it always re-runs the configured `testCommand` as
a health check. A green result stops the loop with **zero commits** — idle is a
true steady state, not a place that accumulates empty-commit noise. A red result
writes `HEALTH.md` and commits it, entering the health-fixing detour (§4).

## 2. The commit-subject grammar

`src/Subjects.ts` defines the sole channel the machine reads from history: the
**subject line** of the last (first-parent) commit. There are exactly two
machine-authored namespaces, plus a catch-all:

- **Turn commits** — `gtd(human): <gate>` / `gtd(agent): <gate>` — authored by
  `gtd step` / `gtd step-agent` as the _first_ commit of a chain, recording who
  acted and under which gate.
- **Routing commits** — `gtd: <phase>` — authored by the machine itself as
  bookkeeping between turns.
- **Boundary commits** — anything else: an ordinary non-`gtd` commit, or any
  `gtd: *` subject outside the closed routing set below (this is also the v1
  compatibility rule — see §2.3).

`parseSubject` is total and never throws: every subject maps to exactly one of
`"turn"`, `"routing"`, or `"boundary"`.

### 2.1 Turn gates (`TurnGate`)

```
grilling | grilled | building | fixing | agentic-review | review
| squashing | health-fixing | escalate
```

`turnSubject(actor, gate)` produces `gtd(${actor}): ${gate}`. Not every
`(actor, gate)` pair is reachable: turns are strictly separated (§3), so a gate
is only ever authored by its awaited actor — there is no `gtd(human): building`
at all, and `gtd(human)` appears only at the human gates (`grilling`'s entry and
answer turns, `review`, `escalate`).

### 2.2 Routing phases (`RoutingPhase`) and their awaited actor

Every non-parameterized routing subject is a literal string (`ROUTING_SUBJECT`
in `src/Subjects.ts`). The table below transcribes the classification
`classifyHead` in `src/Machine.ts` assigns to each — its rest-or-mid-chain class
and the actor it lands on (`"—"` = the row is resolved by the payload-dependent
ladder, not by subject alone):

| Subject                 | Class at that HEAD | Lands at (state, actor)                                                                                                                                                                                                                        |
| ----------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gtd: grilled`          | rest               | `grilled`, agent                                                                                                                                                                                                                               |
| `gtd: planning`         | rest               | `building`, agent                                                                                                                                                                                                                              |
| `gtd: tests green`      | rest or mid-chain  | `.gtd` present: force-approved → mid-chain `closePackage` → `close-package`, agent; not force-approved → rest `agentic-review`, agent. No `.gtd` (health path): squash-after-green → mid-chain `writeSquashTemplate`; else rest `idle`, human. |
| `gtd: errors`           | rest               | `ERRORS.md` present → `escalate`, human; else → `fixing`, agent                                                                                                                                                                                |
| `gtd: package done`     | — (ladder)         | remaining packages → `building`, agent; else reviewable diff → `review`, agent; else idle/health                                                                                                                                               |
| `gtd: awaiting review`  | rest               | `await-review`, human                                                                                                                                                                                                                          |
| `gtd: review feedback`  | rest               | `grilling`, agent                                                                                                                                                                                                                              |
| `gtd: done`             | rest or mid-chain  | squash enabled + squash base present → mid-chain `writeSquashTemplate`; else rest `idle`, human                                                                                                                                                |
| `gtd: squash template`  | rest               | `squashing`, agent                                                                                                                                                                                                                             |
| `gtd: reviewing <hash>` | rest               | `review`, agent                                                                                                                                                                                                                                |
| `gtd: health-check`     | rest               | `ERRORS.md` present → `escalate`, human; else → `health-fixing`, agent                                                                                                                                                                         |
| `gtd: health-fix`       | rest (usually)     | `idle`, human — see the health-fix re-test carve-out below                                                                                                                                                                                     |

The parameterized anchor `gtd: reviewing <hash>` (`reviewingSubject` in
`src/Subjects.ts`) is written only by `gtd review <target>` (§3); `<hash>` is
the resolved review base and supplies `reviewBase` directly, overriding the
ordinary review-scope rules (§4, Review).

**Turn-commit classification** (the other half of `classifyHead`, keyed on
`(actor, gate)`):

| Turn commit                  | Class                                      | Lands at                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gtd(agent): grilling`       | empty diff → rest; non-empty → rest        | `grilling`, agent (empty, re-emit) or `grilling`, human (non-empty, answer gate)                                                                                                         |
| `gtd(human): grilling`       | empty diff → mid-chain; non-empty → rest   | empty → `commitRouting "gtd: grilled"` → `grilling`/agent picture; non-empty → rest `grilling`, agent                                                                                    |
| `gtd(agent): grilled`        | mid-chain                                  | `commitRouting "gtd: planning"` (removes TODO.md)                                                                                                                                        |
| `gtd(agent): building`       | mid-chain                                  | `runTest`                                                                                                                                                                                |
| `gtd(agent): fixing`         | empty diff → rest; non-empty → mid-chain   | empty → rest `fixing`, agent (re-emit); non-empty → `runTest`                                                                                                                            |
| `gtd(agent): agentic-review` | rest                                       | `agentic-review`, agent (only reached when FEEDBACK.md was never written at all — the FEEDBACK.md-present cases are handled by the steering-file precedence check that runs before this) |
| `gtd(agent): review`         | mid-chain                                  | `commitRouting "gtd: awaiting review"`                                                                                                                                                   |
| `gtd(human): review`         | mid-chain                                  | substantive → `commitRouting "gtd: review feedback"` (removes REVIEW.md); non-substantive (clean or checkbox-only) → `commitRouting "gtd: done"` (removes REVIEW.md)                     |
| `gtd(agent): squashing`      | squash base present → mid-chain; else rest | mid-chain → `squashCommit`; rest → `squashing`, agent                                                                                                                                    |
| `gtd(agent): health-fixing`  | mid-chain                                  | `commitRouting "gtd: health-fix"` (removes HEALTH.md)                                                                                                                                    |
| `gtd(human): escalate`       | mid-chain                                  | `runTest` (re-test after the human's fix)                                                                                                                                                |

**The health-fix re-test carve-out.** `gtd: health-fix` classifies as a plain
rest (`idle`, human) for `gtd next` / `gtd status` — a clean tree there
"self-heals": the very next invocation's health check simply re-runs. But a
mutating invocation that lands on `gtd: health-fix` mid-chain (i.e. the same
invocation that just captured the health-fixer's own turn) must re-test in that
same chain rather than stopping; this is handled as a special case in
`applyTurnTaking`, not in `classifyHead`. Likewise, `gtd: health-check` forces a
re-test on **any** invoking actor once the fix-attempt budget is already
exhausted (`capReached`) — there is nothing left to fix, so even a human's
`gtd step` must force the escalating re-test rather than be refused as an
out-of-turn step. These two carve-outs sit _above_ the out-of-turn refusals in
`applyTurnTaking` on purpose: they perform bookkeeping (a re-test), never a turn
capture, so they don't breach the strict actor separation of turns (§3).

### 2.3 Compatibility rule and upgrade requirement

Any `gtd: *` subject **outside** the closed routing set above parses as
`"boundary"` — this includes every v1 subject: `gtd: new task`, `gtd: grilling`,
`gtd: building`, `gtd: fixing`, `gtd: feedback`, `gtd: transport`, and a bare
`gtd: reviewing` without a hash. v2 does not recognize these; they are treated
exactly like an ordinary non-`gtd` commit — inert, cold-start boundary. This is
intentional: `parseSubject` is total and safe to run over v1 history without
throwing.

**Upgrade requirement**: a repository must have finished or cleaned up its v1
cycles (no v1 steering files, no v1 `gtd:` HEAD mid-workflow) before upgrading
to v2. Landing v2 on top of a v1 in-flight cycle produces an unrecognized
boundary HEAD with orphaned v1 steering files still on disk — the v2
illegal-combination / corruption checks (§5) will very likely fire immediately,
by design (refusing to guess is safer than silently misinterpreting v1 state as
v2 state).

## 3. Command surface & contracts

### `gtd step` — human mutator

Drives the fixpoint loop as the human actor: `gatherEvents("human")` → `resolve`
→ perform the returned `EdgeAction` → repeat, until `resolve` returns no
`EdgeAction` (a genuine fixpoint) or one of `runStep`'s documented
mid-invocation checkpoints (below) is hit. Idempotent: re-running at a fixpoint
authors zero commits.

- **Out-of-turn: refused.** While an agent turn is awaited, `gtd step` refuses
  (exit non-zero, zero commits, stderr
  `"<state> awaits an agent turn — run \`gtd
  step-agent\`"`) on both clean and dirty trees. Turns are strictly separated in both directions: the wrong mutator always errors instead of no-op-ing or adopting the dirty tree as a turn of its own. Human edits made while the agent is awaited (amendment notes in `.gtd/`
  package files, extra TODO.md detail) stay pending and ride along as input to
  the agent's next captured turn.
- **Idle**: always re-runs the health check (§1's carve-out) — never an empty
  turn commit, never a plain no-op.

### `gtd step-agent` — agent mutator

Same engine, `gatherEvents("agent")`. **Refuses** when the machine awaits a
human turn (the mirror of `gtd step`'s out-of-turn refusal): exits non-zero,
authors **zero commits**, and prints `"<state> awaits a human turn — run \`gtd
step\`"`to stderr. An **empty agent turn is inert**: it is recorded once (so`gtd
next`re-emits the identical agent prompt), and a further clean`gtd step-agent`
at that same rest authors nothing more.

### Fixpoint chaining and mid-invocation checkpoints

Both `step` and `step-agent` share `runStep`, which chains hops until one of:

- `resolve` returns no `edgeAction` (true fixpoint).
- `resolve` returns a `refusal`. Only a first-hop refusal fails the invocation;
  a refusal reached past hop 1 is how the loop notices the chain has handed the
  turn to the _other_ actor (a human step's grilling-accept chain landing on the
  agent-awaited grilled rest, an agent step's review chain landing on the
  human-awaited await-review rest) — it carries no `edgeAction`, so the loop
  just stops at that state with the work already performed.
- A performed `EdgeAction` itself signals `{ stop: true }` (the health-check
  green settle with nothing further queued).
- One of three documented **mid-invocation checkpoints**
  (`shouldStopRunStepLoop` in `src/program.ts`) fires, each a deliberate "this
  invocation's job is done even though the machine could technically keep
  chaining":
  1. **`gtd: tests green` reached mid-chain**, when it resolves to a genuine
     agentic-review rest, or when it was reached via a **fixing** round (not a
     fresh build) — a fix's "did it actually work" result always gets its own
     checkpoint, even under force-approve.
  2. **A second fresh turn capture right after capturing the agentic-review
     turn** — findings recorded, and the very next hop wants a fresh
     `gtd(agent): fixing` capture. That is a second judgment call in one
     invocation; it waits for a fresh `gtd step-agent`.
  3. **A stale empty turn capture past hop 1** — an edge action that would
     capture an empty turn, reached via mid-chain bookkeeping earlier in _this
     same_ invocation (not as the very first thing it saw). A hop-1 empty
     capture is unaffected, which is what lets an out-of-band operational
     recovery (config fixed, code already committed by an earlier invocation)
     proceed straight to re-testing. `runStep` is bounded by `MAX_EDGE_HOPS`
     (100): exceeding it is a machine/edge bug, and the driver fails loudly
     rather than spinning forever.

### `gtd next` — pure prompt emitter

`invoker: "none"`, never mutates. Reads the current state and prints the prompt
for whichever actor is awaited:

- **Dirty tree** → refuses (non-zero exit), pointing at `gtd status` and the
  step command of whichever actor is awaited (`gtd step` / `gtd step-agent`).
- **Clean tree, at rest** → prints that rest's prompt (or, in `--json` mode,
  `{ state, actor, pending: false, prompt }`).
- **Clean tree, mid-chain** → reports `{ pending: true, prompt: null }` rather
  than a prompt — there is nothing to hand an agent yet. Mid-chain bookkeeping
  is invoker-agnostic, so either mutator resumes it; the plain-mode message
  names the natural one for the reported actor (`"run \`gtd step-agent\` to
  continue, then run \`gtd next\` again"`for an agent-driven checkpoint,`"run
  \`gtd step\` to continue"` for a human-driven one).

### `gtd status` — pure prediction

`invoker: "none"` as well, but works on a dirty tree too (unlike `next`) since
it never needs a clean tree to predict from. Reports `predictTurn`'s output
(state, awaited actor, the commit subject that would be authored next or `null`,
and the resulting state) without touching git or the filesystem beyond reading.
Rejects extra positional arguments.

### `gtd review <target>` — ad-hoc human review anchor

A pure mutator, orthogonal to the main loop: resolves `<target>` (a ref, branch,
or commit) via `merge-base(target, HEAD)` (falling back to the resolved target
hash if there is no merge-base or the merge-base equals the target), diffs it
against HEAD with workflow files excluded, and — if that diff is non-empty —
commits `gtd: reviewing <hash>`. Refuses on a dirty tree or an empty filtered
diff. This anchor takes precedence over the ordinary in-process review-scope
rules (§4, Review) the next time the machine resolves a review.

### `gtd format <file>`

Reformats a single markdown file in place (via the same formatter `gtd` applies
to TODO.md after a capture). Rejects `--json` — it is not a v2 state command.

### The always-clean invariant

By the time any mutating command (`step`, `step-agent`) returns exit 0, the
working tree is clean — a red test run is never left uncommitted: `runTest`
writes FEEDBACK.md/ERRORS.md and commits it (`gtd: errors`) in the same hop, and
`runHealthCheck` writes HEALTH.md/ERRORS.md and commits (`gtd: health-check`)
likewise. This is why red test results still "succeed" at the CLI level (exit 0)
— failure is captured as durable state, not surfaced as a process failure, so
the chain can hand off to the next actor deterministically.

### Checkpoint / no-rollback failure contract

A mid-chain **operational** failure (e.g. a misconfigured or missing test
command) is different from a red test result: it is a tooling error, and it does
**not** roll back the commit(s) already authored in that invocation. The turn
commit already landed is a durable checkpoint; the CLI exits non-zero at the
point of failure, `gtd next` reports the mid-chain pending state in between, and
re-running the same `step`/`step-agent` once the underlying issue is fixed
resumes the chain from that checkpoint — it does not repeat work already
committed.

### JSON shapes

`--json` is supported on `step`, `step-agent`, `next`, `status`, and `review`
(not `format`). Representative shapes:

- `step` / `step-agent`: `{ state, actions, commits }` — `actions` is the
  human-readable list of edge actions performed, `commits` the ordered list of
  commit subjects authored this run.
- `next`: `{ state, actor, pending, prompt }` — `prompt` is `null` when
  `pending` is true. `actor` is the single "proceed" signal for automated loop
  drivers: `"agent"` means another round — act on `prompt` when present (an
  agent rest; mirrors the plain-mode tail), then run `gtd step-agent`; at an
  agent-driven pending checkpoint (`prompt` is `null`, nothing to act on) just
  run `gtd step-agent`. `"human"` means halt: the human owns the next move (a
  human rest, whose prompt body already spells out the human's next action, or a
  human-driven pending checkpoint resumed by `gtd step`).
- `status`: `{ state, actor, predictedCommit, predictedState }` —
  `predictedCommit` is `null` when nothing would be committed (e.g. idle).
- `review`: `{ state: "review", reviewBase, pending: false, prompt: null }`.
- Any top-level failure (including inside the Effect pipeline) renders as
  `{ state: "error", prompt: <message> }` before the process exits non-zero.

## 4. Per-state documentation

The 16 frozen `GtdState`s (`src/Machine.ts`). 11 are prompt-bearing
(`isPromptState` in `src/Prompt.ts`): `grilling`, `grilled`, `building`,
`fixing`, `agentic-review`, `review`, `await-review`, `squashing`, `escalate`,
`idle`, `health-fixing`. The other 5 — `testing`, `planning`, `close-package`,
`done`, `health-check` — are performed entirely by the driver/edge and must
never reach `buildPrompt` (it throws if they do).

### `grilling`

**Means:** developing a plan (`TODO.md`) toward a concrete, implementation-
ready form, iterating between agent and human.

**Awaited actor:** `agent` or `human`, depending on which prompt renders —
`awaitedActor("grilling")` alone only gives the generic default (`"agent"`); the
actual awaited actor for a given rest is read off `Result.actor`, which
distinguishes the human-answer-gate rest (`@grilling-answers` template) from the
agent-develops rest (`@grilling-agent` template).

**Prompt:**

- `@grilling-agent` (agent awaited) — develop `TODO.md` into a concrete plan in
  one turn, using subagents; every remaining open question must carry a
  suggested default; leave TODO.md uncommitted. Inlines the latest human turn's
  diff (workflow files excluded) as "feedback, not finished work" when present.
- `@grilling-answers` (human awaited) — a pure human gate: edit `TODO.md` in
  place to answer/annotate, or run `gtd step` with no edits to accept all
  suggested defaults.

**Entry:** a dirty boundary tree with `invoker: "human"` (no steering files, no
committed TODO.md) captures `gtd(human): grilling` — the v2 entry turn
(`isDirtyBoundaryEntry` in `applyTurnTaking`). `gtd: done` counts as a boundary
HEAD for this purpose too, even though it parses as `"routing"` — a settled
cycle is exactly where the next feature's dirty tree lands.
`gtd: review feedback` also rests here (agent awaited) — the re-grilling entry
from review feedback (§4, Review-feedback re-grill below).

**Exit:** an empty human turn at the answer gate (`gtd(human): grilling` with an
empty diff) mid-chains to `commitRouting "gtd: grilled"` → **grilled**.

### `grilled`

**Means:** the plan has converged (no open questions, nothing pending); ready to
be decomposed into ordered work packages.

**Awaited actor:** agent.

**Prompt:** `@decompose` — decompose `TODO.md` into `.gtd/NN-<package>/`
directories of numbered task `.md` files. Rules inlined in the prompt: packages
are sequential/dependency-ordered, each package must be green on its own, tasks
within a package are parallel and file-disjoint, packages are vertical slices,
task files are self-contained. The subagent must not commit — this runs inside a
larger orchestration that depends on uncommitted state.

**Entry:** the routing commit `gtd: grilled` is a rest landing here (agent).

**Exit:** `gtd(agent): grilled` mid-chains to `commitRouting "gtd: planning"`
(also removing `TODO.md`) → **planning**.

**Turn-taking:** `gtd step` (human) is refused here like at every agent-awaited
rest (§3), and this rest is why the rule matters: the dirty tree is the
decompose agent's uncommitted output, and adopting it as a `gtd(human): grilled`
turn would misattribute agent work and regress the ladder to grilling. To amend
the decomposition, leave notes in `.gtd/` package/task files after the
`gtd: planning` commit lands; an unamended `.gtd/` proceeds to **building**.

### `planning`

**Means:** `.gtd/` package files are still being added/edited (multi-turn
decomposition).

**Awaited actor:** agent (edge-only — no independent prompt template; the _next_
rest after an unmodified, clean `.gtd/` is **building**, which reuses
`@building`).

**Entry:** `.gtd/` present and modified vs. the committed tree, regardless of
HEAD (checked ahead of the subject-based ladder).

**Exit:** each turn commits `gtd: planning`; once `.gtd/` stops changing (clean
tree, unmodified) the next resolve lands on **building**.

### `building`

**Means:** executing the first remaining package's tasks.

**Awaited actor:** agent.

**Prompt:** `@building` — spawn one subagent per task, all in parallel, TDD
discipline (one test → implement → pass → repeat, never all-tests-first); report
worker failures back for a retry/skip/abort decision; leave all changes
uncommitted. Inlines the active package's task files (`@package` partial).

**Entry:** `gtd: planning` (rest) or `gtd: package done` with packages remaining
(ladder rule, since that routing subject's landing state depends on package/diff
facts, not the subject alone).

**Exit:** `gtd(agent): building` mid-chains straight into `runTest` → red writes
FEEDBACK.md/ERRORS.md and commits `gtd: errors`; green commits
`gtd: tests green` → **testing**'s outcome (agentic-review or force-approved
close, or the idle/squash path when there is no `.gtd/` at all — the health side
of the same routing subject).

### `testing`

**Means:** running the configured `testCommand` against the package's
accumulated diff. Edge-only — no independent prompt; it is the mid-chain
`runTest` action fired from `gtd(agent): building`, `gtd(agent): fixing`
(non-empty), or `gtd(human): escalate`.

**Awaited actor:** agent (the actor who authored the turn being tested).

**Actions:** run `testCommand`; exit 0 → commit `gtd: tests green`; exit ≠ 0 →
count fix attempts since the most recent of {package start, last agentic-review
findings round, last `ERRORS.md` removal} (the `testFixCount` fold) — below
`fixAttemptCap` (default 3) → write FEEDBACK.md, commit `gtd: errors`; at/over
the cap → write ERRORS.md, commit `gtd: errors`.

**Prompt:** none — always mid-chain, folding straight into the next rest.

### `fixing`

**Means:** a non-empty `FEEDBACK.md` is present (findings from a red test run or
a non-approving agentic review). Implies `.gtd/` present (illegal otherwise —
§5).

**Awaited actor:** agent.

**Prompt:** `@fixing` — spawn a fix subagent to work through "Feedback to
address" (the inlined `FEEDBACK.md` content): fix the code, or dispute the
finding by emptying/deleting `FEEDBACK.md` — the machine re-tests either way;
leave every change uncommitted.

**Entry:** `gtd: errors` with `ERRORS.md` absent (routing rest); or the
steering-file precedence check firing on a live, uncommitted `FEEDBACK.md` write
by the reviewer (once captured as `gtd(agent): agentic-review`, this same
precedence check routes on to fixing or close on the next hop).

**Exit:** `gtd(agent): fixing` with an empty diff (the fixer changed nothing
yet) is a rest (re-emit the same prompt) — an **inert empty fixer turn**,
recorded once. A non-empty diff mid-chains into `runTest` (FEEDBACK.md is
removed unconditionally first, whether the fixer left it, deleted it, or emptied
it) → **testing**.

### `escalate`

**Means:** `ERRORS.md` is present — the fix-attempt cap was reached (by the
build/fix loop or by the health-check loop), and the human must intervene.
Highest precedence after nothing else — checked before FEEDBACK.md, HEALTH.md,
and everything else in the ladder.

**Awaited actor:** human.

**Prompt:** `@escalate` — tell the human to read `ERRORS.md`, fix the underlying
issue, delete `ERRORS.md`, then run `gtd step`.

**Entry:** `ERRORS.md` present (from either the build/fix loop or the
health-check loop).

**Exit:** the human deletes `ERRORS.md` and runs `gtd step` — this lands as the
human's own mid-chain turn, `gtd(human): escalate`, which folds straight into a
fresh `runTest` (re-testing from a reset budget, since removing `ERRORS.md`
resets the fix-attempt count) → **testing**.

### `agentic-review`

**Means:** a clean `gtd: tests green` rest with `.gtd/` present — the completed
package's diff is ready for an automated review verdict.

**Awaited actor:** agent.

**Actions:** if the review-fix count (`reviewFixCount`) has already reached
`reviewThreshold` (default 3) since the package start, or `agenticReview` is
disabled by config — **force-approve**: route straight to mid-chain
`closePackage` → **close-package**, without ever spawning a reviewer and without
writing `FEEDBACK.md` at all (`closePackage` only _removes_ a maybe-absent
`FEEDBACK.md`; force-approve never creates one). Otherwise render the review
prompt.

**Prompt:** `@agentic-review` — spawn a reviewing subagent to check the
package's task specs against its cumulative diff (`@package` + inlined diff),
and **always** write `FEEDBACK.md`: empty (whitespace-only) = approve;
non-empty, concrete findings = fix. The reviewer must not edit source or commit.

**Entry:** `gtd: tests green` rest with `.gtd/` present and not force-approved.

**Exit:** an empty `FEEDBACK.md` written by this turn mid-chains to
`closePackage` → **close-package**. A non-empty `FEEDBACK.md` rests at
**fixing**. (A duplicate clean `gtd step-agent` invoked between review turns
cannot itself approve — the FEEDBACK.md-present-and-empty case requires it to be
a _fresh_ verdict from this very turn; inside an already-in-progress fix loop,
an empty FEEDBACK.md instead reads as the fixer disputing/emptying an
already-on-the-record finding.)

### `close-package`

**Means:** a package's review verdict approved (empty `FEEDBACK.md`, whether
from a real review or force-approve). Edge-only.

**Awaited actor:** agent.

**Actions:** remove the (possibly already-empty/absent) `FEEDBACK.md`, remove
the first (finished) package directory (and `.gtd/` itself if it was the last
one), commit `gtd: package done`.

**Prompt:** none — always mid-chain.

**Exit:** more packages remain → **building** (next package); `.gtd/` is now
gone and there's a reviewable diff → **review**; `.gtd/` gone and nothing
reviewable → idle/health path (§4, Idle).

### `review`

**Means:** the human-facing code review lifecycle. Agent awaited, drafting
`REVIEW.md`. Two distinct entry subjects rest at this same state, both rendering
under the `@review` template:

1. `gtd: package done` (nothing left in `.gtd/`, reviewable diff present).
2. The ad-hoc `gtd: reviewing <hash>` anchor (from `gtd review <target>`).

(The re-grilling entry from review feedback, `gtd: review feedback`, is a
separate rest landing at **grilling**, not `review` — see Actions/Exit below and
the `grilling` section's Entry paragraph.)

(The human-awaited "`REVIEW.md` committed" rest is a separate `GtdState`,
`await-review`, documented below — it resolves to state `await-review`, not
`review`, and renders the `@await-review` template.)

**Prompt (agent draft, `@review`):** spawn a subagent to read the inlined diff
(`git diff <reviewBase> HEAD`, workflow files excluded), group hunks
semantically into chunks, and write `REVIEW.md` with a fixed format: a
`# Review: <short-hash>` header, an HTML-comment `base:` line, and per-chunk
`- [ ]` file-pointer checkboxes (`./path#line`). Checkboxes are the approval
mechanism — ticking them with nothing else edited approves; any other edit (to
REVIEW.md or the code) is a change request. Leave `REVIEW.md` uncommitted.

The human gate reached after drafting (`gtd: awaiting review`) is a separate
`GtdState`, `await-review`, with its own `@await-review` prompt — see below.

**Scope of the review diff** (computed at the edge, `src/Events.ts`):

- **Within a process** (a grilling turn commit exists after the last
  `gtd: done`), no `gtd: awaiting review` yet in this cycle → base = the first
  grilling turn commit of the cycle (the whole task).
- **Within a process**, a prior `gtd: awaiting review` exists in this cycle →
  base = that last `gtd: awaiting review` (only the feedback-cycle's new work).
- **A `gtd: reviewing <hash>` anchor** present in the cycle overrides both rules
  above.
- **Outside a process** (any branch, no grilling turn in this cycle) → no base
  is set; the branch review never fires (falls through to idle/health).

Workflow files (`TODO.md`, `REVIEW.md`, `FEEDBACK.md`, `ERRORS.md`, `HEALTH.md`,
`SQUASH_MSG.md`, `.gtd/`) are excluded from every review diff.

**Actions/Exit:**

- `gtd(agent): review` (the drafting turn landing) mid-chains to
  `commitRouting "gtd: awaiting review"` → the **await-review** rest (see
  below).
- `gtd(human): review` — the human's response, classified on **substantiveness**
  (computed from that very turn commit's own diff, not live dirtiness, since the
  tree is clean again by the time this HEAD is classified): non-substantive
  (clean, or a pure REVIEW.md checkbox flip, or a REVIEW.md **deletion** —
  deleting the whole file to approve is decisively non-substantive) mid-chains
  to `commitRouting "gtd: done"` (removing REVIEW.md) → **done**. Substantive
  (any other file changed, or REVIEW.md's own hunk is more than a checkbox flip)
  mid-chains to `commitRouting "gtd: review feedback"` (removing REVIEW.md) →
  re-grilling.
- **Review-feedback re-grill**: `gtd: review feedback` is a rest landing at
  **grilling** (agent awaited). The edge inlines the _parent_ commit's (the
  human turn's) diff as `headTurnDiff` here — since by the time this routing
  HEAD resolves, HEAD is the routing commit, not the turn commit itself — with
  REVIEW.md deliberately **not** excluded from that diff (unlike everywhere
  else): a substantive review-feedback turn may be pure prose edited into
  REVIEW.md, which is itself the finding to fold into the plan. The task cycle
  never closes on this path — no `gtd: done` is committed; the re-seeded plan
  re-enters grilling → planning → building, and the follow-up review covers only
  the new work (per the "Scope of the review diff" rules above).

### `await-review`

**Means:** `REVIEW.md` has been drafted and committed; the human-facing review
gate is waiting for the human's verdict. A real, distinct `GtdState` (not folded
into `review`) — resolve at `gtd: awaiting review` reports
`state: "await-review"` (`src/Machine.ts`).

**Awaited actor:** human.

**Prompt:** `@await-review` — tell the human: approve by running `gtd step` with
no edits or only checkbox ticks; request changes by writing substantive
edits/annotations (to REVIEW.md or code) then running `gtd step`.

**Entry:** `gtd: awaiting review` is a rest landing here (human) — the routing
commit written by `commitRouting` when `gtd(agent): review`'s drafting turn
mid-chains (see `review`, Actions/Exit above).

**Exit:** `gtd(human): review` — the human's response — classified on
substantiveness as described under `review` above: non-substantive mid-chains to
`commitRouting "gtd: done"` → **done**; substantive mid-chains to
`commitRouting "gtd: review feedback"` → the review-feedback re-grill
(**grilling**).

### `done`

**Means:** the review approved; the cycle is closing. Edge-only.

**Awaited actor:** agent (mid-chain) when squash is queued, otherwise this
routing subject rests at **idle** (human) directly.

**Actions:** none of its own beyond having been committed by the review's
mid-chain hop (`commitRouting "gtd: done"`, removing REVIEW.md).

**Exit:** squash enabled and a squash base is present → mid-chain
`writeSquashTemplate` → **squashing**. Otherwise → rest at **idle**.

### `squashing`

**Means:** collapsing an entire finished cycle's `gtd: *` bookkeeping commits
into one conventional-commits message. Two entry points share this state:

- **Feature-cycle squash**: `gtd: done` → squash base = parent of the first
  grilling turn commit of the cycle (or the `gtd: reviewing <hash>` anchor,
  whichever is nearest HEAD within the cycle).
- **Health-fix squash**: a health-fix cycle went green with ≥1 `gtd: health-fix`
  commit present and squash enabled — squash base = parent of the first
  `gtd: health-check` of that run.

**Awaited actor:** agent.

**Actions (two-hop flow):**

1. `writeSquashTemplate` — write a conventional-commits skeleton to
   `SQUASH_MSG.md` and commit it as `gtd: squash template`. No squash happens
   yet.
2. `gtd next` at that rest renders `@squashing` — extract key decisions from the
   grilling rounds' `TODO.md` history, draft one conventional-commits message,
   and **overwrite** `SQUASH_MSG.md` with it (leaving it uncommitted). No
   sentinel text appears anywhere in this prompt.
3. `gtd(agent): squashing`, once `SQUASH_MSG.md` is present, mid-chains to
   `squashCommit`: read `SQUASH_MSG.md`'s content, remove the file,
   `git reset --soft <squashBase>`, then commit-all under that content as the
   message. The whole `<squashBase>..HEAD` range — every `gtd: *` and
   `gtd(actor): *` commit of the cycle — collapses into one commit; commits
   before the squash base are untouched.

**Trigger is turn position, not content**: the squash fires because HEAD is at
the right point in the chain, never because of what `SQUASH_MSG.md` says —
arbitrary prose (even prose that mentions `gtd: errors`) still gets squashed in
verbatim.

**Exit:** after the squash, HEAD is a single non-`gtd:` boundary commit →
**idle**. Idempotent: a second `gtd step` after the squash sees a boundary HEAD
and `SQUASH_MSG.md` absent, so it does not re-squash.

### `idle`

**Means:** no steering files, clean tree, and either the re-trigger gate is
closed (no commits after the last `gtd: done`, or none exists) with an empty
reviewable diff, or the branch is outside any process and the health check came
back green with no prior `gtd: health-fix` commits this run. The terminal,
steady rest.

**Awaited actor:** human.

**Prompt:** `@idle` — report that the repository is idle, nothing to do.

**Actions:** none directly, but every `gtd step` at idle re-runs the health
check (§1's carve-out): green stops the driver loop with **zero commits**; red
writes `HEALTH.md`/`ERRORS.md` and commits, entering the health-fixing detour.
`gtd next`/`gtd status` (invoker `"none"`) do not trigger this — they just
report idle/human.

### `health-fixing`

**Means:** `HEALTH.md` is present — the idle-path health check found a red gate
below the fix-attempt cap. (No `.gtd/`, no `REVIEW.md`, no `FEEDBACK.md` may
coexist with it — illegal otherwise, §5.)

**Awaited actor:** agent.

**Prompt:** `@fixing` (the exact same template as build/test fixing) — read
`HEALTH.md`'s content as the "Feedback to address," fix the code, leave
uncommitted.

**Entry:** `gtd: health-check` rest with `ERRORS.md` absent.

**Actions on entry (mid-chain from `gtd(agent): health-fixing`):**
`commitRouting "gtd: health-fix"`, removing `HEALTH.md` — same removal
discipline as `fixing`/`FEEDBACK.md`.

**Exit:** the fixer's own turn commit `gtd(agent): health-fixing` mid-chains
straight into removing HEALTH.md and committing `gtd: health-fix`. The next
resolve at `gtd: health-fix` (same invocation, mid-chain — §2's carve-out)
re-runs `testCommand`: green with squash queued → commit `gtd: tests green` →
continues into the squash template chain; green with no squash queued → stop
with zero further commits (a plain idle rest); red below cap → write a fresh
`HEALTH.md`, commit `gtd: health-check`, loop again; red at cap → write
`ERRORS.md`, commit `gtd: health-check` → **escalate**.

### `health-check`

One of the 16 frozen `GtdState`s, but no code path in `resolve` ever reports
`state: "health-check"` — it never appears as a `Result.state`. The health check
itself runs as the internal `runHealthCheck` edge action, invoked from
**idle**'s carve-out or from the `gtd: health-fix` re-test hop; its output is
the routing commit `gtd: health-check`, which resolves to **escalate** or
**health-fixing** (§2.2), never back to a `health-check` rest. Mentioned here
only to disambiguate from `health-fixing` (the state, entered once `HEALTH.md`
is committed).

## 5. The precedence ladder

`resolve` (`src/Machine.ts`) applies rules in this fixed order. First match
wins; anything matching nothing is `corruption` — a hard error, never a guess.

### 5.1 Illegal-combination guard (`assertLegal`, before anything else)

Checked in two passes — HEALTH.md-specific rules first (so a HEALTH.md +
FEEDBACK.md, say, gets the two-file diagnosis rather than the more generic
single-file one), then the rest:

```
HEALTH.md + .gtd
HEALTH.md + REVIEW.md
HEALTH.md + FEEDBACK.md
HEALTH.md + ERRORS.md
REVIEW.md + .gtd
REVIEW.md + committed TODO.md
uncommitted REVIEW.md + TODO.md
FEEDBACK.md + REVIEW.md
FEEDBACK.md without .gtd
ERRORS.md + FEEDBACK.md
ERRORS.md without .gtd   (exempted while HEAD is gtd: health-check / gtd: health-fix —
                          ERRORS.md briefly outlives .gtd during the health-check
                          cap escalation)
```

Each is a predicate over `ResolvePayload` paired with the exact diagnosis string
`GtdStateError` throws.

### 5.2 Steering-file precedence (`resolveBaseline`, ahead of HEAD classification)

These fire regardless of what HEAD says, because file presence is more current
than the last commit:

1. `ERRORS.md` present → rest **escalate**, human.
2. `HEALTH.md` present (and HEAD is not the health-fixer's own turn consuming
   it) → rest **health-fixing**, agent.
3. `FEEDBACK.md` present (and HEAD is not the fixer's own turn consuming it, and
   not force-approved-outside-the-fix-loop) →
   - if HEAD is `gtd: tests green` (a live, uncommitted write by the review
     agent) → rest **agentic-review**, agent (capture that turn first).
   - else, empty and not already inside the fix loop → mid-chain
     **close-package**.
   - else → rest **fixing**, agent.

### 5.3 HEAD classification (`classifyHead`)

Pure function of the commit subject plus a small config/content-dependent flag
set (`ClassifyFlags`): resolves every turn-commit and routing-commit row in §2's
tables. Returns `null` for boundary subjects and the one payload-dependent
routing row (`gtd: package done`), deferring those to the ladder below.

### 5.4 Payload-driven ladder (falls through from `classifyHead === null`)

In order:

1. `.gtd/` exists and is modified vs. committed → **planning**.
2. HEAD is `gtd: package done` → packages remain → **building**; else reviewable
   → **review**; else → idle/health.
3. `TODO.md` present (any other HEAD) → **grilling** continues.
4. `.gtd/` exists with a pending package **and** the nearest workflow commit
   (skipping boundary commits stacked on top) is still `gtd(agent): building` →
   **building** (operational-recovery carve-out: a boundary commit, e.g. a
   config fix, landed on top of the checkpoint after a mid-chain failure, but
   the checkpoint is still the active one). Narrow by design — an unrecognized
   boundary HEAD with no such checkpoint in its history still hard-errors.
5. No steering files at all, no recognized workflow HEAD → idle/health
   (`resolveIdleOrHealth`): reviewable diff → **review**; else → **idle**,
   human.
6. Anything else → `corrupt()` — hard error.

### 5.5 Turn-taking layer (`applyTurnTaking`, always applied last)

Independent of the ladder above, layered on every resolved baseline:

1. **Dirty-boundary entry** (`invoker === "human"`, dirty tree, no committed
   TODO.md, no steering files, boundary/`gtd: done` HEAD) → captures
   `gtd(human): grilling` unconditionally, short-circuiting everything else.
2. **Mid-chain baseline** → `invoker === "none"` reports `pending: true`; any
   other invoker performs the edge action.
3. **Rest baseline, `invoker === "none"`** → report state/actor, no mutation.
4. **`gtd: health-fix` (rest = idle) or `gtd: health-check` at the exhausted
   cap** → force a `runHealthCheck` re-test regardless of invoker (the
   carve-outs from §2).
5. **Out-of-turn**: `invoker === "agent"`, awaited === human → `refusal`.
6. **Out-of-turn**: `invoker === "human"`, awaited === agent → dirty tree
   captures `gtd(human): <gate>`; clean tree no-ops.
7. **Idle carve-out**: `baseline.state === "idle"`, `invoker === "human"` →
   force `runHealthCheck`, never an empty commit or plain no-op.
8. **In-turn, fixpoint check**: HEAD already carries this exact
   `gtd(<invoker>): <gate>` turn AND the tree is clean → report rest, no
   mutation (idempotent re-run). Otherwise → capture a fresh turn commit under
   `gateForState(baseline.state)` (every state defaults to its own name as the
   gate except non-turn-authoring states, which fall through to `"review"` —
   though in practice only `review`-family states reach this branch as a
   turn-authoring rest).

### Corruption

Reached only when the whole ladder above falls through with nothing matching —
e.g. an unrecognized boundary HEAD with steering files present that don't fit
any legal shape. `GtdStateError` with `kind: "corruption"`, carrying the HEAD
subject and tree cleanliness in its message. Never guessed past.

## 6. Canonical transcripts

Mirrors `tests/integration/features/journeys.feature`. All examples below assume
`agenticReview: false` and `squash: false` unless noted.

### Happy path (no detours)

```
<boundary/init>
gtd(human): grilling        # dirty-boundary entry turn
gtd(agent): grilling        # agent develops the plan (non-empty)
gtd(human): grilling        # human accepts (empty turn)
gtd: grilled                # routing: converged
gtd(agent): grilled         # agent's own-gate turn (immediately mid-chains)
gtd: planning                # routing: TODO.md removed
gtd(agent): building        # agent writes code
gtd: tests green             # routing: test passed
gtd: package done             # routing: force-approved (agenticReview off)
gtd(agent): review          # agent drafts REVIEW.md
gtd: awaiting review         # routing: rest for the human
gtd(human): review          # human approves (deletes REVIEW.md)
gtd: done                    # routing: cycle closed
```

A subsequent `gtd step` at rest with a green health check adds **zero** commits
and reports `state: idle`.

### Happy path with squash on

Same sequence through `gtd: done`, but `gtd: done` is no longer a rest — the
same human-turn invocation continues straight to:

```
gtd: squash template          # writeSquashTemplate
```

`gtd next` renders the squashing prompt; the agent overwrites `SQUASH_MSG.md`;
`gtd step-agent` performs the squash — the entire
`gtd(human): grilling .. gtd: squash template` range collapses into one commit
whose subject is the message's first line (e.g.
`feat: add calculator with add support`). None of the intermediate `gtd: *` /
`gtd(actor): *` subjects survive in the final log.

### Red-then-fixed detour (build/test/fix loop)

```
gtd: planning
gtd(agent): building
gtd: errors                   # red, below cap: FEEDBACK.md written
<gtd next → fixing prompt with the failure output>
gtd(agent): fixing            # fixer patches the code (non-empty diff)
gtd: tests green               # re-test, now green
gtd: package done               # force-approve closes it
```

### Grilling round with a human answer

```
gtd(human): grilling          # dirty-boundary entry (notes.md)
gtd(agent): grilling          # agent leaves an open question with a suggested default
gtd(human): grilling          # human answers inline in TODO.md (non-empty!) — NOT accept
gtd(agent): grilling          # agent converges, no more markers
gtd: grilled                   # human's next clean step converges
```

Note the human's answer round is itself a **non-empty** human turn — it does not
converge on its own; the agent still gets one more round to confirm convergence
before the clean accept lands `gtd: grilled`.

### Escalation and recovery

```
gtd: errors   (×fixAttemptCap)
gtd: errors                    # at/over cap: ERRORS.md written instead of FEEDBACK.md
<escalate prompt: human reads ERRORS.md>
<human deletes ERRORS.md, runs gtd step>
gtd(human): escalate           # mid-chain: re-tests from a reset budget
gtd: tests green                 # (if the human's fix worked)
```

### Review-feedback detour

```
gtd: awaiting review
gtd(human): review             # substantive edit/annotation (not a plain approve)
gtd: review feedback             # routing: REVIEW.md removed, re-grilling begins
gtd(agent): grilling           # re-plan against the captured feedback diff
...                             # re-enters grilling → planning → building
gtd: awaiting review            # follow-up review covers only the new work packages
```

No `gtd: done` is ever committed on this path until a later review approves
cleanly.

### Health cycle (idle path)

```
<idle, clean tree>
<gtd step: health check runs testCommand>
gtd: health-check                # red below cap: HEALTH.md written
gtd(agent): health-fixing       # fixer's own turn
gtd: health-fix                   # HEALTH.md removed; re-tests in the same chain
# green, squash off → stop, plain idle rest, zero further commits
# green, squash on  → gtd: tests green → gtd: squash template → ... → one squash commit
# red, below cap    → gtd: health-check again (loop)
# red, at cap       → ERRORS.md written, gtd: health-check → escalate
```

## 7. The loop protocol

The step-first two-beat loop an agent (or the `loop` skill) should run to drive
`gtd` end to end:

1. Run `gtd step-agent`.
2. Run `gtd next`.
3. If `actor` is `"human"` → **halt** (the human owns the next move: a human
   gate — answer TODO.md questions, review, fix an escalation — or a
   human-driven pending checkpoint resumed by `gtd step`).
4. Otherwise: if a prompt was emitted, feed it to the agent (spawn the
   subagent(s) the prompt describes, let them make their edits, leave them
   uncommitted per the prompt's instructions); at an agent-driven pending
   checkpoint (`prompt` is `null`) there is nothing to act on.
5. Repeat from step 1.

This mirrors the plain-mode prompt tail: every agent-awaited prompt ends with
"Finish your turn by running `gtd step-agent`. Then run `gtd next` and follow
its output — repeat this cycle as long as the output is addressed to you (the
agent); when it awaits the human, stop and hand off." (`@agent-turn` partial,
suppressed in `--json` mode and for human-awaited prompts). The first sentence
closes the current turn; the second closes the outer loop, so a plain-text agent
chains multiple iterations (e.g. successive test/fix cycles) until a human gate.
`gtd step-agent` itself absorbs any number of mid-chain routing hops
automatically (§3) — the loop only needs to re-invoke it once per actual agent
turn, not once per commit.
