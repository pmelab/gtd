# The gtd v2 state machine

`gtd` is a turn-taking state machine layered over a git branch. There is no
long-lived process and no daemon: every invocation is a single
`gather → resolve → (perform)` hop, or a short chain of hops. The machine
(`src/Machine.ts`) is a pure function from an event stream (first-parent commit
history + a working-tree snapshot) to a `Result`; all git/filesystem IO lives at
the edge (`src/Events.ts`).

This document is the design reference for that machine: the turn-taking model,
the commit-subject grammar, the command surface, the 21 states, the precedence
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
4. **which steering files are present** (`.gtd/TODO.md`, `.gtd/ARCHITECTURE.md`,
   `.gtd/PLAN.md`, `.gtd/NN-…/` work packages, `.gtd/REVIEW.md`,
   `.gtd/FEEDBACK.md`, `.gtd/ERRORS.md`, `.gtd/HEALTH.md`, `.gtd/SQUASH_MSG.md`,
   `.gtd/LEARNINGS.md`)

All steering files live under `.gtd/` — the directory is the workflow's
namespace, and everything outside it is project code. A root-level `TODO.md` or
`REVIEW.md` belongs to the project: the machine never reads, consumes, or
deletes it, and agents are prompted never to touch `.gtd/` except the single
file their turn explicitly grants.

**File content never steers**, with exactly three machine-verified exceptions:

- **.gtd/FEEDBACK.md emptiness** — a whitespace-only `.gtd/FEEDBACK.md` written
  by a fresh agentic review is the approval signal (`feedbackEmpty` in
  `ResolvePayload`); a non-empty one is a findings round.
- **.gtd/REVIEW.md checkbox-only diffs** — a pending `.gtd/REVIEW.md` edit that
  is purely `- [ ]` ↔ `- [x]` flips (and nothing else dirty) is an approval
  signal, not review feedback (`isCheckboxOnlyDiff` in `src/Events.ts`).
- **Structural validation of the AGENT's own draft** at the grilling,
  architecting, and review gates — `.gtd/TODO.md` / `.gtd/ARCHITECTURE.md`'s
  `## Open Questions` structure (`src/OpenQuestions.ts`) and `.gtd/REVIEW.md`'s
  header/base-comment/chunk structure (`src/ReviewDoc.ts`), surfaced as
  `grillingDocErrors` / `reviewDocErrors` in `ResolvePayload`. This never
  inspects a HUMAN's own turn (their answer at grilling, their feedback/approval
  at review) — only the agent's own turn capture can be refused this way
  (`applyTurnTaking` in `src/Machine.ts`). See "Open questions and review
  structure" below.

`.gtd/LEARNINGS.md` and `.gtd/SQUASH_MSG.md` are the two exceptions to this rule
at a different layer: their content becomes the human-review draft / the final
squash commit message verbatim, but neither ever _steers_ a routing decision —
only their **presence** and (for the machine-written template) whether they
still hold the unmodified template do.

Every other piece of content — .gtd/TODO.md prose, .gtd/FEEDBACK.md's actual
findings text, .gtd/REVIEW.md's prose, code diffs — is inlined into prompts for
agents/humans to read, but never inspected by the resolver to make a routing
decision.

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
writes `.gtd/HEALTH.md` and commits it, entering the health-fixing detour (§4).

### Open questions and review structure

`.gtd/TODO.md` / `.gtd/ARCHITECTURE.md` and `.gtd/REVIEW.md` stay plain,
human-readable markdown, but each has an enforced structure so the data can be
parsed out (`gtd questions` / `gtd changesets`, §3) instead of staying opaque
prose:

- **`.gtd/TODO.md` / `.gtd/ARCHITECTURE.md`** (identical contract, mirrored
  phases, parsed by `parseOpenQuestions` in `src/OpenQuestions.ts`): an OPTIONAL
  `## Open Questions` section (omitted entirely = zero open questions, not an
  error). Every `###` sub-heading directly under it is one open question; its
  body's first non-blank line must be `Suggested default: <text>` (the agent's
  unanswered default) or `Answer: <text>` (a human's answer). A `###` question
  with neither is a structural error.
- **`.gtd/REVIEW.md`** (parsed by `parseReviewDoc` in `src/ReviewDoc.ts`): a
  `# Review: <short-hash>` header as the document's first line, an
  `<!-- base: <full-hash> -->` comment, and at least one `##` chunk, each with a
  non-empty title and at least one `- [ ]` / `- [x]` file-pointer line. A chunk
  with zero file pointers, or a missing header/base comment, is a structural
  error.

Validation applies ONLY to the **agent's own authored draft** at the gate that
writes the file (`gtd(agent): grilling`, `gtd(agent): architecting`,
`gtd(agent): review`) — never to a human's free-form edits (their answer at the
grilling/architecting gate, their feedback/approval at the review gate). When
the active file is malformed, `gtd step-agent` refuses (zero commits, a stderr
message listing every structural error) instead of capturing the turn — the
agent fixes the file and reruns `gtd step-agent`. This is the third of the
narrow, machine-verified exceptions to "file content never steers" above.

A squash commit's message MAY carry a sibling `## Decisions` section — one
`### <question>` entry per architecture/product decision resolved that cycle,
marked unambiguously by a trailing `Gtd-Decisions: true` line (squash commits
take on arbitrary conventional-commit subjects, so the trailer, not the subject,
is what makes such a commit findable). Free-form prose, consumed by an LLM on
both ends (squashing writes it, grilling/architecting read it) rather than
machine-parsed, so it has no enforced grammar and never blocks a turn. See §4's
`squashing` and `grilling`/`architecting` sections below.

## 2. The commit-subject grammar

`src/Subjects.ts` defines the sole channel the machine reads from history: the
**subject line** of the last (first-parent) commit. There are exactly two
machine-authored namespaces, plus a catch-all:

- **Turn commits** — `gtd(human): <gate>` / `gtd(agent): <gate>` — authored by
  `gtd step` / `gtd step-agent` as the _first_ commit of a chain, recording who
  acted and under which gate.
- **Routing commits** — `gtd: <state>` — authored by the machine itself as
  bookkeeping between turns. Each label names the state the commit enters
  (`gtd: building`, `gtd: await-review`, …); `tests-green` / `test-failed` are
  marker states recording a check outcome whose next state guarded rules decide
  at resolution.
- **Boundary commits** — anything else: an ordinary non-`gtd` commit, or any
  `gtd: *` subject outside the closed routing set below (this is also the v1
  compatibility rule — see §2.3).

`parseSubject` is total and never throws: every subject maps to exactly one of
`"turn"`, `"routing"`, or `"boundary"`.

### 2.1 Turn gates (`TurnGate`)

```
grilling | architecting | grilled | building | fixing | agentic-review | review
| squashing | health-fixing | escalate | learning | learning-apply
```

`turnSubject(actor, gate)` produces `gtd(${actor}): ${gate}`. Not every
`(actor, gate)` pair is reachable: turns are strictly separated (§3), so a gate
is only ever authored by its awaited actor — there is no `gtd(human): building`
at all, and `gtd(human)` appears only at the human gates (`grilling`'s and
`architecting`'s entry and answer turns, `grilled`'s and `health-fixing`'s entry
turns (the `.gtd/PLAN.md` and hand-written `.gtd/HEALTH.md` entry points — see
§5.5 rung 1), `review`, `escalate`, and — mirroring `review` — `learning`, whose
human turn (at the `await-learning-review` rest) shares the agent draft turn's
gate name rather than getting its own).

### 2.2 Routing phases (`RoutingPhase`) and their awaited actor

Every non-parameterized routing subject is a literal string (`ROUTING_SUBJECT`
in `src/Subjects.ts`). The table below transcribes the classification
`classifyHead` in `src/Machine.ts` assigns to each — its rest-or-mid-chain class
and the actor it lands on (`"—"` = the row is resolved by the payload-dependent
ladder, not by subject alone):

| Subject                      | Class at that HEAD | Lands at (state, actor)                                                                                                                                                                                                                                                                               |
| ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gtd: architecting`          | rest               | `architecting`, agent                                                                                                                                                                                                                                                                                 |
| `gtd: grilled`               | rest               | `grilled`, agent                                                                                                                                                                                                                                                                                      |
| `gtd: building`              | rest               | `building`, agent                                                                                                                                                                                                                                                                                     |
| `gtd: tests-green`           | rest or mid-chain  | `.gtd` present: force-approved → mid-chain `closePackage` → `close-package`, agent; not force-approved → rest `agentic-review`, agent. No `.gtd` (health path): learning enabled → mid-chain `writeLearningTemplate`; else squash enabled → mid-chain `writeSquashTemplate`; else rest `idle`, human. |
| `gtd: test-failed`           | rest               | `.gtd/ERRORS.md` present → `escalate`, human; else → `fixing`, agent                                                                                                                                                                                                                                  |
| `gtd: close-package`         | — (ladder)         | remaining packages → `building`, agent; else reviewable diff → `review`, agent; else idle/health                                                                                                                                                                                                      |
| `gtd: await-review`          | rest               | `await-review`, human — while an invocation rests here, the program edge opens the review checkout window (see `await-review`, §4)                                                                                                                                                                    |
| `gtd: grilling`              | rest               | `grilling`, agent                                                                                                                                                                                                                                                                                     |
| `gtd: done`                  | rest or mid-chain  | learning enabled + squash base present → mid-chain `writeLearningTemplate`; else squash enabled + squash base present → mid-chain `writeSquashTemplate`; else rest `idle`, human                                                                                                                      |
| `gtd: squashing`             | rest               | `squashing`, agent                                                                                                                                                                                                                                                                                    |
| `gtd: review <hash>`         | rest               | `review`, agent                                                                                                                                                                                                                                                                                       |
| `gtd: health-check`          | rest               | `.gtd/ERRORS.md` present → `escalate`, human; else → `health-fixing`, agent                                                                                                                                                                                                                           |
| `gtd: testing`               | rest (usually)     | `idle`, human — see the health-fix re-test carve-out below                                                                                                                                                                                                                                            |
| `gtd: learning`              | rest               | `learning`, agent                                                                                                                                                                                                                                                                                     |
| `gtd: await-learning-review` | rest               | `await-learning-review`, human                                                                                                                                                                                                                                                                        |
| `gtd: learning-apply`        | rest               | `learning-apply`, agent                                                                                                                                                                                                                                                                               |
| `gtd: learning-applied`      | rest or mid-chain  | squash enabled + squash base present → mid-chain `writeSquashTemplate`; else rest `idle`, human                                                                                                                                                                                                       |

The parameterized anchor `gtd: review <hash>` (`reviewingSubject` in
`src/Subjects.ts`) is written only by `gtd review <target>` (§3); `<hash>` is
the resolved review base and supplies `reviewBase` directly, overriding the
ordinary review-scope rules (§4, Review).

**Turn-commit classification** (the other half of `classifyHead`, keyed on
`(actor, gate)`):

| Turn commit                  | Class                                                     | Lands at                                                                                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gtd(agent): grilling`       | empty diff → rest; non-empty → rest                       | `grilling`, agent (empty, re-emit) or `grilling`, human (non-empty, answer gate)                                                                                                                                                                               |
| `gtd(human): grilling`       | empty diff → mid-chain; non-empty → rest                  | empty → `commitRouting "gtd: architecting", seedArchitectureFromTodo: true` → `architecting`/agent; non-empty → rest `grilling`, agent                                                                                                                         |
| `gtd(agent): architecting`   | empty diff → rest; non-empty → rest                       | `architecting`, agent (empty, re-emit) or `architecting`, human (non-empty, answer gate)                                                                                                                                                                       |
| `gtd(human): architecting`   | empty diff → mid-chain; non-empty → rest                  | empty → `commitRouting "gtd: grilled"` → `grilled`/agent; non-empty → rest `architecting`, agent                                                                                                                                                               |
| `gtd(human): grilled`        | `.gtd/PLAN.md` present → mid-chain; else — (ladder)       | mid-chain → `commitRouting "gtd: grilled", seedArchitectureFromPlan: true` (writes .gtd/ARCHITECTURE.md from .gtd/PLAN.md, removes .gtd/PLAN.md); without .gtd/PLAN.md it falls to the ladder (a half-seeded crash recovers via the .gtd/ARCHITECTURE.md rung) |
| `gtd(agent): grilled`        | mid-chain                                                 | `commitRouting "gtd: building"` (removes .gtd/ARCHITECTURE.md)                                                                                                                                                                                                 |
| `gtd(agent): building`       | mid-chain                                                 | `runTest`                                                                                                                                                                                                                                                      |
| `gtd(agent): fixing`         | empty diff → rest; non-empty → mid-chain                  | empty → rest `fixing`, agent (re-emit); non-empty → `runTest`                                                                                                                                                                                                  |
| `gtd(agent): agentic-review` | rest                                                      | `agentic-review`, agent (only reached when .gtd/FEEDBACK.md was never written at all — the .gtd/FEEDBACK.md-present cases are handled by the steering-file precedence check that runs before this)                                                             |
| `gtd(agent): review`         | mid-chain                                                 | `commitRouting "gtd: await-review"`                                                                                                                                                                                                                            |
| `gtd(human): review`         | mid-chain                                                 | substantive → `commitRouting "gtd: grilling"` (removes .gtd/REVIEW.md); non-substantive (clean or checkbox-only) → `commitRouting "gtd: done"` (removes .gtd/REVIEW.md)                                                                                        |
| `gtd(agent): squashing`      | squash base present → mid-chain; else rest                | mid-chain → `squashCommit`; rest → `squashing`, agent                                                                                                                                                                                                          |
| `gtd(agent): health-fixing`  | mid-chain                                                 | `commitRouting "gtd: testing"` (removes .gtd/HEALTH.md)                                                                                                                                                                                                        |
| `gtd(human): health-fixing`  | — (precedence)                                            | the hand-written-HEALTH.md entry turn: no `classifyHead` row — the steering-file precedence rung (§5.2) rests it at `health-fixing`, agent. A clean `gtd step-agent` at this HEAD is inert (the entry description must survive until an agent has read it)     |
| `gtd(human): escalate`       | mid-chain                                                 | `runTest` (re-test after the human's fix)                                                                                                                                                                                                                      |
| `gtd(agent): learning`       | squash base present + non-template → mid-chain; else rest | mid-chain → `commitRouting "gtd: await-learning-review"`; rest → `learning`, agent (re-emit until the agent overwrites the template)                                                                                                                           |
| `gtd(human): learning`       | mid-chain (unconditional — no reject path)                | `commitRouting "gtd: learning-apply"`                                                                                                                                                                                                                          |
| `gtd(agent): learning-apply` | mid-chain                                                 | `commitRouting "gtd: learning-applied"` (removes .gtd/LEARNINGS.md)                                                                                                                                                                                            |

**The health-fix re-test carve-out.** `gtd: testing` classifies as a plain rest
(`idle`, human) for `gtd next` / `gtd status` — a clean tree there "self-heals":
the very next invocation's health check simply re-runs. But a mutating
invocation that lands on `gtd: testing` mid-chain (i.e. the same invocation that
just captured the health-fixer's own turn) must re-test in that same chain
rather than stopping; this is handled as a special case in `applyTurnTaking`,
not in `classifyHead`. Likewise, `gtd: health-check` forces a re-test on **any**
invoking actor once the fix-attempt budget is already exhausted (`capReached`) —
there is nothing left to fix, so even a human's `gtd step` must force the
escalating re-test rather than be refused as an out-of-turn step. These two
carve-outs sit _above_ the out-of-turn refusals in `applyTurnTaking` on purpose:
they perform bookkeeping (a re-test), never a turn capture, so they don't breach
the strict actor separation of turns (§3).

### 2.3 Compatibility rule and upgrade requirement

Any `gtd: *` subject **outside** the closed routing set above parses as
`"boundary"` — this includes every v1 subject: `gtd: new task`, `gtd: grilling`,
`gtd: building`, `gtd: fixing`, `gtd: feedback`, `gtd: transport`, and a bare
`gtd: review` without a hash. v2 does not recognize these; they are treated
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
  package files, extra .gtd/TODO.md detail) stay pending and ride along as input
  to the agent's next captured turn.
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
  1. **`gtd: tests-green` reached mid-chain**, when it resolves to a genuine
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
commits `gtd: review <hash>`. Refuses on a dirty tree or an empty filtered diff.
This anchor takes precedence over the ordinary in-process review-scope rules
(§4, Review) the next time the machine resolves a review.

### `gtd questions` — pure reader

`invoker`-agnostic pure read: no dirty-tree check, no mutation. Reads whichever
of `.gtd/TODO.md` / `.gtd/ARCHITECTURE.md` is present (they never coexist),
parses it per "Open questions and review structure" above (§1), and reports the
open-questions list — plus any structural errors, the same ones that would
refuse the next `gtd(agent): grilling`/`gtd(agent): architecting` turn capture.
Reports an empty list (no file, no error) when neither file is present. Rejects
extra positional arguments. For a future UI.

### `gtd changesets` — pure reader

Mirrors `gtd questions` for the review side: reads `.gtd/REVIEW.md`, if present,
parses it per §1 above, and reports the changeset/file list plus any structural
errors. Reports an empty list (no file, no error) when the file is absent.
Rejects extra positional arguments. For a future UI.

### `gtd format <file>`

Reformats a single markdown file in place (via the same formatter `gtd` applies
to .gtd/TODO.md after a capture). Rejects `--json` — it is not a v2 state
command.

### The always-clean invariant

By the time any mutating command (`step`, `step-agent`) returns exit 0, the
working tree is clean — a red test run is never left uncommitted: `runTest`
writes .gtd/FEEDBACK.md/.gtd/ERRORS.md and commits it (`gtd: test-failed`) in
the same hop, and `runHealthCheck` writes .gtd/HEALTH.md/.gtd/ERRORS.md and
commits (`gtd: health-check`) likewise. This is why red test results still
"succeed" at the CLI level (exit 0) — failure is captured as durable state, not
surfaced as a process failure, so the chain can hand off to the next actor
deterministically.

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

`--json` is supported on `step`, `step-agent`, `next`, `status`, `review`,
`questions`, and `changesets` (not `format`). Representative shapes:

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
- `questions`: `{ file, questions, errors }` — `file` is `.gtd/TODO.md` /
  `.gtd/ARCHITECTURE.md` / `null`; `questions` is
  `{ question, status: "suggested" | "answered", text }[]`; `errors` lists any
  structural violations found (same diagnosis `gtd step-agent` would refuse the
  agent's turn capture with).
- `changesets`: `{ file, shortHash, fullHash, changesets, errors }` — `file` is
  `.gtd/REVIEW.md` / `null`; `changesets` is
  `{ title, description, files: { path, line, checked, note }[] }[]`; `errors`
  mirrors `questions`' field above.
- Any top-level failure (including inside the Effect pipeline) renders as
  `{ state: "error", prompt: <message> }` before the process exits non-zero.

## 4. Per-state documentation

The 21 frozen `GtdState`s (`src/Machine.ts`). 15 are prompt-bearing
(`isPromptState` in `src/Prompt.ts`): `grilling`, `architecting`, `grilled`,
`building`, `fixing`, `agentic-review`, `review`, `await-review`, `squashing`,
`learning`, `await-learning-review`, `learning-apply`, `escalate`, `idle`,
`health-fixing`. The other 6 — `testing`, `planning`, `close-package`, `done`,
`health-check`, `learning-applied` — are performed entirely by the driver/edge
and must never reach `buildPrompt` (it throws if they do).

### `grilling`

**Means:** developing a plan (`.gtd/TODO.md`) toward a concrete, product-level
form — user-facing/product decisions only, iterating between agent and human.
Technical/architectural decisions are explicitly out of scope here; they belong
to the next phase (`architecting`).

**Awaited actor:** `agent` or `human`, depending on which prompt renders —
`awaitedActor("grilling")` alone only gives the generic default (`"agent"`); the
actual awaited actor for a given rest is read off `Result.actor`, which
distinguishes the human-answer-gate rest (`@grilling-answers` template) from the
agent-develops rest (`@grilling-agent` template).

**Prompt:**

- `@grilling-agent` (agent awaited) — develop `.gtd/TODO.md` into a concrete
  product-level plan in one turn, using subagents; every remaining open question
  goes under a `## Open Questions` section (§1, "Open questions and review
  structure") with a suggested default; leave .gtd/TODO.md uncommitted. Inlines
  the latest human turn's diff (workflow files excluded) as "feedback, not
  finished work" when present, and — ahead of that — every past squash commit's
  `## Decisions` section (§1), concatenated oldest to newest, as settled "Prior
  decisions" context, when non-empty.
- `@grilling-answers` (human awaited) — a pure human gate: edit `.gtd/TODO.md`
  in place to answer/annotate, or run `gtd step` with no edits to accept all
  suggested defaults.

**Entry:** a dirty boundary tree with `invoker: "human"` (no steering files, no
committed .gtd/TODO.md, .gtd/ARCHITECTURE.md, .gtd/PLAN.md, or .gtd/HEALTH.md)
captures `gtd(human): grilling` — the v2 entry turn (`isDirtyBoundaryEntry` in
`applyTurnTaking`). `gtd: done` counts as a boundary HEAD for this purpose too,
even though it parses as `"routing"` — a settled cycle is exactly where the next
feature's dirty tree lands. `gtd: grilling` also rests here (agent awaited) —
the re-grilling entry from review feedback (§4, Review-feedback re-grill below).

**Entry points:** which gate the entry turn is captured under depends on which
steering file the dirty tree already contains — file-_presence_-based routing,
the same mechanism every steering-file rung in the ladder already uses, never
content-based steering. The four files are pairwise illegal combinations (§5.1),
so the pick is always unambiguous:

- **no steering file / `.gtd/TODO.md`** → `gtd(human): grilling` — product
  grilling, the default (a hand-written `.gtd/TODO.md` is the draft product plan
  the agent iterates on).
- **`.gtd/ARCHITECTURE.md`** → `gtd(human): architecting` — an already-technical
  sketch skips product grilling entirely for this cycle (see `architecting`'s
  Entry below).
- **`.gtd/PLAN.md`** → `gtd(human): grilled` — a FINAL architecture skips both
  grilling phases: the turn mid-chains to
  `commitRouting "gtd: grilled", seedArchitectureFromPlan: true` (writes
  `.gtd/ARCHITECTURE.md` from the `.gtd/PLAN.md` content and deletes
  `.gtd/PLAN.md`, in one commit) and rests at the decompose prompt (see
  `grilled`'s Entry below).
- **`.gtd/HEALTH.md`** (hand-written) → `gtd(human): health-fixing` — an error
  description enters the health-fixing detour directly (see `health-fixing`'s
  Entry below).

**Exit:** an empty human turn at the answer gate (`gtd(human): grilling` with an
empty diff) mid-chains to
`commitRouting "gtd: architecting", seedArchitectureFromTodo: true` (writes
`.gtd/ARCHITECTURE.md` from the converged `.gtd/TODO.md` content and deletes
`.gtd/TODO.md`, in one commit) → **architecting**.

### `architecting`

**Means:** developing the converged product plan (`.gtd/ARCHITECTURE.md`) into a
concrete, implementation-ready technical/architectural plan — file/module
structure, data models, tech-stack choices — iterating between agent and human.
Mechanically an exact mirror of `grilling`, one file and one phase later.

**Awaited actor:** `agent` or `human`, depending on which prompt renders — same
`Result.actor` distinction as `grilling` (`@architecting-answers` vs.
`@architecting-agent`).

**Prompt:**

- `@architecting-agent` (agent awaited) — develop `.gtd/ARCHITECTURE.md` into a
  concrete technical plan in one turn, using subagents; every remaining open
  question goes under a `## Open Questions` section (§1, "Open questions and
  review structure") with a suggested default; leave .gtd/ARCHITECTURE.md
  uncommitted. Must not re-open product/user-facing decisions already settled by
  grilling. Inlines the latest human turn's diff as "feedback, not finished
  work" when present, and — like `@grilling-agent` — the concatenated
  `## Decisions` history (§1) as "Prior decisions" context, when non-empty.
- `@architecting-answers` (human awaited) — a pure human gate: edit
  `.gtd/ARCHITECTURE.md` in place to answer/annotate, or run `gtd step` with no
  edits to accept all suggested defaults.

**Entry:** the routing commit `gtd: architecting` is a rest landing here (agent)
— reached either from grilling's converged exit (`.gtd/ARCHITECTURE.md` seeded
from `.gtd/TODO.md`) or directly from the `.gtd/ARCHITECTURE.md` entry point
(§4, `grilling`'s Entry points: the file authored by the human from scratch, no
`.gtd/TODO.md` ever existing).

**Exit:** an empty human turn at the answer gate (`gtd(human): architecting`
with an empty diff) mid-chains to `commitRouting "gtd: grilled"` → **grilled**.

### `grilled`

**Means:** the architecture has converged (no open questions, nothing pending);
ready to be decomposed into ordered work packages.

**Awaited actor:** agent.

**Prompt:** `@decompose` — decompose `.gtd/ARCHITECTURE.md` into
`.gtd/NN-<package>/` directories of numbered task `.md` files. Rules inlined in
the prompt: packages are sequential/dependency-ordered, each package must be
green on its own, tasks within a package are parallel and file-disjoint,
packages are vertical slices, task files are self-contained. The subagent must
not commit — this runs inside a larger orchestration that depends on uncommitted
state.

**Entry:** the routing commit `gtd: grilled` is a rest landing here (agent) —
reached from architecting's converged exit, or directly from the `.gtd/PLAN.md`
entry point: a dirty boundary tree containing `.gtd/PLAN.md` (a final,
decompose-as-is architecture) captures `gtd(human): grilled`, which mid-chains
to `commitRouting "gtd: grilled", seedArchitectureFromPlan: true` — writing
`.gtd/ARCHITECTURE.md` from the `.gtd/PLAN.md` content (with a seed banner) and
deleting `.gtd/PLAN.md` in that one commit, so the decompose prompt and
everything downstream are untouched by which entry the cycle used. The seed hop
is guarded on `.gtd/PLAN.md` actually being present (mirroring the packages
guard on `gtd(agent): grilled`): a hand-crafted `gtd(human): grilled` HEAD
without it falls through the ladder, and a crash half-way through the seed
(ARCHITECTURE.md written, PLAN.md deleted, commit failed) recovers via the
`architectureExists` rung as a normal architecting round.

**Exit:** `gtd(agent): grilled` mid-chains to `commitRouting "gtd: building"`
(also removing `.gtd/ARCHITECTURE.md`) → **planning**.

**Turn-taking:** `gtd step` (human) is refused here like at every agent-awaited
rest (§3), and this rest is why the rule matters: the dirty tree is the
decompose agent's uncommitted output, and adopting it as a `gtd(human): grilled`
turn would misattribute agent work and regress the ladder to grilling. To amend
the decomposition, leave notes in `.gtd/` package/task files after the
`gtd: building` commit lands; an unamended `.gtd/` proceeds to **building**.

### `planning`

**Means:** `.gtd/` package files are still being added/edited (multi-turn
decomposition).

**Awaited actor:** agent (edge-only — no independent prompt template; the _next_
rest after an unmodified, clean `.gtd/` is **building**, which reuses
`@building`).

**Entry:** `.gtd/` present and modified vs. the committed tree, regardless of
HEAD (checked ahead of the subject-based ladder).

**Exit:** each turn commits `gtd: building`; once `.gtd/` stops changing (clean
tree, unmodified) the next resolve lands on **building**.

### `building`

**Means:** executing the first remaining package's tasks.

**Awaited actor:** agent.

**Prompt:** `@building` — spawn one subagent per task, all in parallel, TDD
discipline (one test → implement → pass → repeat, never all-tests-first); report
worker failures back for a retry/skip/abort decision; leave all changes
uncommitted. Inlines the active package's task files (`@package` partial).

**Entry:** `gtd: building` (rest) or `gtd: close-package` with packages
remaining (ladder rule, since that routing subject's landing state depends on
package/diff facts, not the subject alone).

**Exit:** `gtd(agent): building` mid-chains straight into `runTest` → red writes
.gtd/FEEDBACK.md/.gtd/ERRORS.md and commits `gtd: test-failed`; green commits
`gtd: tests-green` → **testing**'s outcome (agentic-review or force-approved
close, or the idle/squash path when there is no `.gtd/` at all — the health side
of the same routing subject).

### `testing`

**Means:** running the configured `testCommand` against the package's
accumulated diff. Edge-only — no independent prompt; it is the mid-chain
`runTest` action fired from `gtd(agent): building`, `gtd(agent): fixing`
(non-empty), or `gtd(human): escalate`.

**Awaited actor:** agent (the actor who authored the turn being tested).

**Actions:** run `testCommand`; exit 0 → commit `gtd: tests-green`; exit ≠ 0 →
count fix attempts since the most recent of {package start, last agentic-review
findings round, last `.gtd/ERRORS.md` removal} (the `testFixCount` fold) — below
`fixAttemptCap` (default 3) → write .gtd/FEEDBACK.md, commit `gtd: test-failed`;
at/over the cap → write .gtd/ERRORS.md, commit `gtd: test-failed`.

**Prompt:** none — always mid-chain, folding straight into the next rest.

### `fixing`

**Means:** a non-empty `.gtd/FEEDBACK.md` is present (findings from a red test
run or a non-approving agentic review). Implies `.gtd/` present (illegal
otherwise — §5).

**Awaited actor:** agent.

**Prompt:** `@fixing` — spawn a fix subagent to work through "Feedback to
address" (the inlined `.gtd/FEEDBACK.md` content): fix the code, or dispute the
finding by emptying/deleting `.gtd/FEEDBACK.md` — the machine re-tests either
way; leave every change uncommitted.

**Entry:** `gtd: test-failed` with `.gtd/ERRORS.md` absent (routing rest); or
the steering-file precedence check firing on a live, uncommitted
`.gtd/FEEDBACK.md` write by the reviewer (once captured as
`gtd(agent): agentic-review`, this same precedence check routes on to fixing or
close on the next hop).

**Exit:** `gtd(agent): fixing` with an empty diff (the fixer changed nothing
yet) is a rest (re-emit the same prompt) — an **inert empty fixer turn**,
recorded once. A non-empty diff mid-chains into `runTest` (.gtd/FEEDBACK.md is
removed unconditionally first, whether the fixer left it, deleted it, or emptied
it) → **testing**.

### `escalate`

**Means:** `.gtd/ERRORS.md` is present — the fix-attempt cap was reached (by the
build/fix loop or by the health-check loop), and the human must intervene.
Highest precedence after nothing else — checked before .gtd/FEEDBACK.md,
.gtd/HEALTH.md, and everything else in the ladder.

**Awaited actor:** human.

**Prompt:** `@escalate` — tell the human to read `.gtd/ERRORS.md`, fix the
underlying issue, delete `.gtd/ERRORS.md`, then run `gtd step`.

**Entry:** `.gtd/ERRORS.md` present (from either the build/fix loop or the
health-check loop).

**Exit:** the human deletes `.gtd/ERRORS.md` and runs `gtd step` — this lands as
the human's own mid-chain turn, `gtd(human): escalate`, which folds straight
into a fresh `runTest` (re-testing from a reset budget, since removing
`.gtd/ERRORS.md` resets the fix-attempt count) → **testing**.

### `agentic-review`

**Means:** a clean `gtd: tests-green` rest with `.gtd/` present — the completed
package's diff is ready for an automated review verdict.

**Awaited actor:** agent.

**Actions:** if the review-fix count (`reviewFixCount`) has already reached
`reviewThreshold` (default 3) since the package start, or `agenticReview` is
disabled by config — **force-approve**: route straight to mid-chain
`closePackage` → **close-package**, without ever spawning a reviewer and without
writing `.gtd/FEEDBACK.md` at all (`closePackage` only _removes_ a maybe-absent
`.gtd/FEEDBACK.md`; force-approve never creates one). Otherwise render the
review prompt.

**Prompt:** `@agentic-review` — spawn a reviewing subagent to check the
package's task specs against its cumulative diff (`@package` + inlined diff),
and **always** write `.gtd/FEEDBACK.md`: empty (whitespace-only) = approve;
non-empty, concrete findings = fix. The reviewer must not edit source or commit.

**Entry:** `gtd: tests-green` rest with `.gtd/` present and not force-approved.

**Exit:** an empty `.gtd/FEEDBACK.md` written by this turn mid-chains to
`closePackage` → **close-package**. A non-empty `.gtd/FEEDBACK.md` rests at
**fixing**. (A duplicate clean `gtd step-agent` invoked between review turns
cannot itself approve — the .gtd/FEEDBACK.md-present-and-empty case requires it
to be a _fresh_ verdict from this very turn; inside an already-in-progress fix
loop, an empty .gtd/FEEDBACK.md instead reads as the fixer disputing/emptying an
already-on-the-record finding.)

### `close-package`

**Means:** a package's review verdict approved (empty `.gtd/FEEDBACK.md`,
whether from a real review or force-approve). Edge-only.

**Awaited actor:** agent.

**Actions:** remove the (possibly already-empty/absent) `.gtd/FEEDBACK.md`,
remove the first (finished) package directory (and `.gtd/` itself if it was the
last one), commit `gtd: close-package`.

**Prompt:** none — always mid-chain.

**Exit:** more packages remain → **building** (next package); `.gtd/` is now
gone and there's a reviewable diff → **review**; `.gtd/` gone and nothing
reviewable → idle/health path (§4, Idle).

### `review`

**Means:** the human-facing code review lifecycle. Agent awaited, drafting
`.gtd/REVIEW.md`. Two distinct entry subjects rest at this same state, both
rendering under the `@review` template:

1. `gtd: close-package` (nothing left in `.gtd/`, reviewable diff present).
2. The ad-hoc `gtd: review <hash>` anchor (from `gtd review <target>`).

(The re-grilling entry from review feedback, `gtd: grilling`, is a separate rest
landing at **grilling**, not `review` — see Actions/Exit below and the
`grilling` section's Entry paragraph.)

(The human-awaited "`.gtd/REVIEW.md` committed" rest is a separate `GtdState`,
`await-review`, documented below — it resolves to state `await-review`, not
`review`, and renders the `@await-review` template.)

**Prompt (agent draft, `@review`):** spawn a subagent to read the inlined diff
(`git diff <reviewBase> HEAD`, workflow files excluded), group hunks
semantically into chunks, and write `.gtd/REVIEW.md` with a fixed, enforced
format (§1, "Open questions and review structure"): a `# Review: <short-hash>`
header, an HTML-comment `base:` line, and per-chunk `- [ ]` file-pointer
checkboxes (`./path#line`). Checkboxes are the approval mechanism — ticking them
with nothing else edited approves; any other edit (to .gtd/REVIEW.md or the
code) is a change request. Leave `.gtd/REVIEW.md` uncommitted.

The human gate reached after drafting (`gtd: await-review`) is a separate
`GtdState`, `await-review`, with its own `@await-review` prompt — see below.

**Scope of the review diff** (computed at the edge, `src/Events.ts`):

- **Within a process** (a grilling turn commit exists after the last
  `gtd: done`), no `gtd: await-review` yet in this cycle → base = the first
  grilling turn commit of the cycle (the whole task).
- **Within a process**, a prior `gtd: await-review` exists in this cycle → base
  = that last `gtd: await-review` (only the feedback-cycle's new work).
- **A `gtd: review <hash>` anchor** present in the cycle overrides both rules
  above.
- **Outside a process** (any branch, no grilling turn in this cycle) → no base
  is set; the branch review never fires (falls through to idle/health).

Workflow files (`.gtd/TODO.md`, `.gtd/ARCHITECTURE.md`, `.gtd/REVIEW.md`,
`.gtd/FEEDBACK.md`, `.gtd/ERRORS.md`, `.gtd/HEALTH.md`, `.gtd/SQUASH_MSG.md`,
`.gtd/`) are excluded from every review diff.

**Actions/Exit:**

- `gtd(agent): review` (the drafting turn landing) mid-chains to
  `commitRouting "gtd: await-review"` → the **await-review** rest (see below).
- `gtd(human): review` — the human's response, classified on **substantiveness**
  (computed from that very turn commit's own diff, not live dirtiness, since the
  tree is clean again by the time this HEAD is classified): non-substantive
  (clean, or a pure .gtd/REVIEW.md checkbox flip, or a .gtd/REVIEW.md
  **deletion** — deleting the whole file to approve is decisively
  non-substantive) mid-chains to `commitRouting "gtd: done"` (removing
  .gtd/REVIEW.md) → **done**. Substantive (any other file changed, or
  .gtd/REVIEW.md's own hunk is more than a checkbox flip) mid-chains to
  `commitRouting "gtd: grilling"` (removing .gtd/REVIEW.md) → re-grilling.
- **Review-feedback re-grill**: `gtd: grilling` is a rest landing at
  **grilling** (agent awaited). The edge inlines the _parent_ commit's (the
  human turn's) diff as `headTurnDiff` here — since by the time this routing
  HEAD resolves, HEAD is the routing commit, not the turn commit itself — with
  .gtd/REVIEW.md deliberately **not** excluded from that diff (unlike everywhere
  else): a substantive review-feedback turn may be pure prose edited into
  .gtd/REVIEW.md, which is itself the finding to fold into the plan. The task
  cycle never closes on this path — no `gtd: done` is committed; the re-seeded
  plan re-enters grilling → planning → building, and the follow-up review covers
  only the new work (per the "Scope of the review diff" rules above).

### `await-review`

**Means:** `.gtd/REVIEW.md` has been drafted and committed; the human-facing
review gate is waiting for the human's verdict. A real, distinct `GtdState` (not
folded into `review`) — resolve at `gtd: await-review` reports
`state: "await-review"` (`src/Machine.ts`).

**Awaited actor:** human.

**Prompt:** `@await-review` — tell the human: approve by running `gtd step` with
no edits or only checkbox ticks; request changes by writing substantive
edits/annotations (to .gtd/REVIEW.md or code) then running `gtd step`.

**Entry:** `gtd: await-review` is a rest landing here (human) — the routing
commit written by `commitRouting` when `gtd(agent): review`'s drafting turn
mid-chains (see `review`, Actions/Exit above).

**Exit:** `gtd(human): review` — the human's response — classified on
substantiveness as described under `review` above: non-substantive mid-chains to
`commitRouting "gtd: done"` → **done**; substantive mid-chains to
`commitRouting "gtd: grilling"` → the review-feedback re-grill (**grilling**).

**The review checkout window** (`src/ReviewWindow.ts`) — a driver/IO concern
layered on this rest, invisible to the machine. Editors' standard git
integration only surfaces _uncommitted_ changes, and at this rest everything is
committed — so whenever a gtd invocation finishes resting at
`gtd: await-review`, the program edge (`src/program.ts`) opens a window:

1. Save HEAD to `refs/gtd/review-head` and the review base to
   `refs/gtd/review-base`. The base mirrors the review-scope rules
   (`reviewWindowBase`, with HEAD itself excluded so rule 2 means the _previous_
   round's `gtd: await-review`).
2. `git reset --mixed <base>` — HEAD/index at the base, working tree untouched →
   the whole reviewable diff shows as uncommitted changes in any editor.
3. Pin `.gtd/` index entries back to the saved head (plumbing stays out of the
   unstaged view) and intent-to-add untracked files (added files render as
   content diffs, and editor "discard" is a coherent reject-this-file gesture).

Every gtd invocation **closes** the window first (keyed on ref existence, before
`ConfigInit.ensure` and any `gatherEvents`):
`git reset --mixed refs/gtd/review-head` restores HEAD/index exactly and deletes
the refs, leaving only the reviewer's own edits dirty. Read-only commands
(`gtd next`, `gtd status`) and refused invocations re-arm the window on their
way out.

Invariants:

- The machine never observes an open window, and the working tree is never
  touched — so the reviewer's edits (including editor "discard hunk" reversions
  and plain file deletions) are captured as their own separate
  `gtd(human): review` turn commit, never mixed into the package commits, and
  substantiveness classification is unchanged.
- Every open/close step is idempotent under re-entry: a crash at any point is
  recovered by the next invocation's close, and `refs/gtd/review-head` keeps the
  real head GC-reachable throughout.
- Manual commits made during the window survive as working-tree content (they
  become review feedback); the commit object and its message are discarded.
- If HEAD leaves the reviewed branch while a window is open (the saved base is
  no longer an ancestor of HEAD), the close fails loudly with recovery
  instructions and leaves the refs in place rather than resetting a foreign
  branch. Linked worktrees are unsupported (the refs are repo-global; HEAD and
  index are per-worktree).

### `done`

**Means:** the review approved; the cycle is closing. Edge-only.

**Awaited actor:** agent (mid-chain) when learning or squash is queued,
otherwise this routing subject rests at **idle** (human) directly.

**Actions:** none of its own beyond having been committed by the review's
mid-chain hop (`commitRouting "gtd: done"`, removing .gtd/REVIEW.md).

**Exit:** learning enabled and a squash base is present → mid-chain
`writeLearningTemplate` → **learning** (the learning phase runs before the
squash decision, since it needs the same pre-squash history the squash base
covers). Otherwise, squash enabled and a squash base is present → mid-chain
`writeSquashTemplate` → **squashing**. Otherwise → rest at **idle**.

### `learning`

**Means:** the cycle is approved and (if squash is also on) headed for a squash
— before that history collapses, the agent distills durable lessons from it into
`.gtd/LEARNINGS.md`. Reached from the same two entry points as squashing (a
feature cycle's `gtd: done`, or a health-fix cycle's green re-test), reusing the
identical squash base/diff.

**Awaited actor:** agent.

**Actions (two-hop flow, mirrors `squashing`):**

1. `writeLearningTemplate` — write a fixed skeleton to `.gtd/LEARNINGS.md` and
   commit it as `gtd: learning`. Nothing is drafted yet.
2. `gtd next` at that rest renders `@learning` — walk the cycle's
   `gtd: .../gtd(agent): .../gtd(human): ...` history (test failures and fixes,
   review feedback, health-check rounds, grilling decisions), keep only
   durable/generalizable lessons, and **overwrite** `.gtd/LEARNINGS.md` with
   them (leaving it uncommitted).
3. `gtd(agent): learning`, once `.gtd/LEARNINGS.md` no longer holds the
   unmodified template, mid-chains to
   `commitRouting "gtd: await-learning-review"` → **await-learning-review**.
   While the template is still unmodified, this turn is inert (re-emits the same
   prompt), exactly like `squashing`'s own template guard.

**Exit:** `commitRouting "gtd: await-learning-review"` →
**await-learning-review**.

### `await-learning-review`

**Means:** a human gate — the agent's `.gtd/LEARNINGS.md` draft is ready for
review. There is no reject/redo path here: the human either accepts the draft
as-is or edits it in place, and either way the very next `gtd step` proceeds
forward. This is a deliberate simplification from `review`'s dual-branch
(approve vs. feedback) — refining what gets kept is not the same kind of
decision as approving finished work.

**Awaited actor:** human.

**Prompt:** `@await-learning-review` — read `.gtd/LEARNINGS.md`, delete anything
not worth keeping or add anything missed, then run `gtd step` (with or without
edits).

**Actions:** `gtd(human): learning` unconditionally mid-chains to
`commitRouting "gtd: learning-apply"` — an empty human turn here is a signal
("accept as-is"), not a no-op, same as an empty turn at `review`/ `grilling`'s
answer gate.

**Exit:** `commitRouting "gtd: learning-apply"` → **learning-apply**.

### `learning-apply`

**Means:** the human-approved learnings are ready to be integrated into the
project's own memory — `CLAUDE.md`, `AGENTS.md`, or whichever doc fits, agent's
judgment. `.gtd/LEARNINGS.md` itself is never the final home; it's deleted once
this turn lands.

**Awaited actor:** agent.

**Prompt:** `@learning-apply` — read the approved `.gtd/LEARNINGS.md`, integrate
its points into the relevant project doc(s), leave uncommitted. Never edit or
delete `.gtd/LEARNINGS.md` directly — the machine removes it.

**Actions:** `gtd(agent): learning-apply` mid-chains to
`commitRouting "gtd: learning-applied"`, removing `.gtd/LEARNINGS.md`. A clean
tree here is a plain do-nothing agent turn (no doc edits to capture) —
unconditionally inert, unlike `health-fixing`'s meaningful empty turn.

**Exit:** `commitRouting "gtd: learning-applied"` → **learning-applied**.

### `learning-applied`

**Means:** the learning phase is done; `.gtd/LEARNINGS.md` is gone, and the
project's docs carry whatever survived review. Edge-only — runs the exact same
squash decision `done` runs, now that learning has already had its turn.

**Awaited actor:** agent (mid-chain) when squash is queued, otherwise this
routing subject rests at **idle** (human) directly.

**Actions:** none of its own beyond having been committed by `learning-apply`'s
mid-chain hop.

**Exit:** squash enabled and a squash base is present → mid-chain
`writeSquashTemplate` → **squashing**. Otherwise → rest at **idle**. The doc
edits landed in `gtd(agent): learning-apply` are folded into the eventual squash
commit's tree (they survive there, not as their own commit) when squash is also
on.

### `squashing`

**Means:** collapsing an entire finished cycle's `gtd: *` bookkeeping commits
into one conventional-commits message. Two entry points share this state:

- **Feature-cycle squash**: `gtd: done` → squash base = parent of the first
  grilling, architecting, or grilled entry turn commit of the cycle — whichever
  entry point (§4, `grilling`'s Entry points) the cycle used — (or the
  `gtd: review <hash>` anchor, whichever is nearest HEAD within the cycle).
- **Health-fix squash**: a health-fix cycle went green with squash enabled —
  squash base = parent of the run's earliest start marker: the first
  `gtd: health-check` of the run, or the `gtd(human): health-fixing` entry turn
  for a hand-written-HEALTH.md run (which may go green with zero
  `gtd: health-check` commits ever landing). The anchor resets on
  `gtd: tests-green` (a processed run never re-triggers the chain at later idle
  rests), except the run's own green marker while HEAD is still inside the
  post-green learning/squash chain.

**Awaited actor:** agent.

**Actions (two-hop flow):**

1. `writeSquashTemplate` — write a conventional-commits skeleton to
   `.gtd/SQUASH_MSG.md` and commit it as `gtd: squashing`. No squash happens
   yet.
2. `gtd next` at that rest renders `@squashing` — extract key decisions from the
   grilling and architecting rounds' `.gtd/TODO.md` and `.gtd/ARCHITECTURE.md`
   history, draft one conventional-commits message, and **overwrite**
   `.gtd/SQUASH_MSG.md` with it (leaving it uncommitted). No sentinel text
   appears anywhere in this prompt. When this cycle resolved any open questions,
   the drafted message includes a `## Decisions` section (one `### <question>`
   entry each) plus a trailing `Gtd-Decisions: true` line — only this cycle's
   own decisions, never a restatement of earlier ones.
3. `gtd(agent): squashing`, once `.gtd/SQUASH_MSG.md` is present, mid-chains to
   `squashCommit`: read `.gtd/SQUASH_MSG.md`'s content, remove the file,
   `git reset --soft <squashBase>`, then commit-all under that content as the
   message. The whole `<squashBase>..HEAD` range — every `gtd: *` and
   `gtd(actor): *` commit of the cycle — collapses into one commit; commits
   before the squash base are untouched, so any `## Decisions` section they
   carry survives untouched too.

**Trigger is turn position, not content**: the squash fires because HEAD is at
the right point in the chain, never because of what `.gtd/SQUASH_MSG.md` says —
arbitrary prose (even prose that mentions `gtd: test-failed`) still gets
squashed in verbatim.

**Exit:** after the squash, HEAD is a single non-`gtd:` boundary commit →
**idle**. Idempotent: a second `gtd step` after the squash sees a boundary HEAD
and `.gtd/SQUASH_MSG.md` absent, so it does not re-squash.

### `idle`

**Means:** no steering files, clean tree, and either the re-trigger gate is
closed (no commits after the last `gtd: done`, or none exists) with an empty
reviewable diff, or the branch is outside any process and the health check came
back green with no prior `gtd: testing` commits this run. The terminal, steady
rest.

**Awaited actor:** human.

**Prompt:** `@idle` — report that the repository is idle, nothing to do.

**Actions:** none directly, but every `gtd step` at idle re-runs the health
check (§1's carve-out): green stops the driver loop with **zero commits**; red
writes `.gtd/HEALTH.md`/`.gtd/ERRORS.md` and commits, entering the health-fixing
detour. `gtd next`/`gtd status` (invoker `"none"`) do not trigger this — they
just report idle/human.

### `health-fixing`

**Means:** `.gtd/HEALTH.md` is present — the idle-path health check found a red
gate below the fix-attempt cap. (No `.gtd/`, no `.gtd/REVIEW.md`, no
`.gtd/FEEDBACK.md` may coexist with it — illegal otherwise, §5.)

**Awaited actor:** agent.

**Prompt:** `@fixing` (the exact same template as build/test fixing) — read
`.gtd/HEALTH.md`'s content as the "Feedback to address," fix the code, leave
uncommitted.

**Entry:** `gtd: health-check` rest with `.gtd/ERRORS.md` absent — or the
hand-written-HEALTH.md entry point: a dirty boundary tree containing
`.gtd/HEALTH.md` (a human-authored error description) captures
`gtd(human): health-fixing`, after which the steering-file precedence rung
(§5.2) rests here exactly as for the machine-written detour. The description is
a means to make `testCommand` green: a red re-test overwrites it with the actual
failure output, and a green one closes the run. One guard protects the entry:
while HEAD is still the human's entry turn, a clean `gtd step-agent` (the loop
protocol's opening beat) is **inert** rather than a meaningful environmental-fix
turn — otherwise it would consume the description before any agent read it.

**Actions on entry (mid-chain from `gtd(agent): health-fixing`):**
`commitRouting "gtd: testing"`, removing `.gtd/HEALTH.md` — same removal
discipline as `fixing`/`.gtd/FEEDBACK.md`.

**Exit:** the fixer's own turn commit `gtd(agent): health-fixing` mid-chains
straight into removing .gtd/HEALTH.md and committing `gtd: testing`. The next
resolve at `gtd: testing` (same invocation, mid-chain — §2's carve-out) re-runs
`testCommand`: green with learning or squash queued → commit `gtd: tests-green`
→ continues into the learning template chain (if learning is on) or straight
into the squash template chain (learning off, squash on); green with neither
queued → stop with zero further commits (a plain idle rest); red below cap →
write a fresh `.gtd/HEALTH.md`, commit `gtd: health-check`, loop again; red at
cap → write `.gtd/ERRORS.md`, commit `gtd: health-check` → **escalate**.

### `health-check`

One of the 21 frozen `GtdState`s, but no code path in `resolve` ever reports
`state: "health-check"` — it never appears as a `Result.state`. The health check
itself runs as the internal `runHealthCheck` edge action, invoked from
**idle**'s carve-out or from the `gtd: testing` re-test hop; its output is the
routing commit `gtd: health-check`, which resolves to **escalate** or
**health-fixing** (§2.2), never back to a `health-check` rest. Mentioned here
only to disambiguate from `health-fixing` (the state, entered once
`.gtd/HEALTH.md` is committed).

## 5. The precedence ladder

`resolve` (`src/Machine.ts`) applies rules in this fixed order. First match
wins; anything matching nothing is `corruption` — a hard error, never a guess.

### 5.1 Illegal-combination guard (`assertLegal`, before anything else)

Checked in four passes — .gtd/HEALTH.md-specific rules first (so a
.gtd/HEALTH.md + .gtd/FEEDBACK.md, say, gets the two-file diagnosis rather than
the more generic single-file one), then .gtd/LEARNINGS.md-specific rules, then
.gtd/PLAN.md-specific rules, then the rest:

```
.gtd/HEALTH.md + .gtd
.gtd/HEALTH.md + .gtd/REVIEW.md
.gtd/HEALTH.md + .gtd/FEEDBACK.md
.gtd/HEALTH.md + .gtd/ERRORS.md
.gtd/HEALTH.md + .gtd/TODO.md         (entry files must be unambiguous;
.gtd/HEALTH.md + .gtd/ARCHITECTURE.md  scribbling a next-feature draft while a
.gtd/HEALTH.md + .gtd/PLAN.md          health detour is live is a refused guess,
                          not a tolerated ride-along — note assertLegal also
                          runs for `gtd status`/`gtd next`, so those error too)
.gtd/LEARNINGS.md + .gtd
.gtd/LEARNINGS.md + .gtd/REVIEW.md
.gtd/LEARNINGS.md + .gtd/FEEDBACK.md
.gtd/LEARNINGS.md + .gtd/ERRORS.md
.gtd/LEARNINGS.md + .gtd/HEALTH.md
.gtd/LEARNINGS.md + .gtd/SQUASH_MSG.md
.gtd/PLAN.md + .gtd/TODO.md
.gtd/PLAN.md + .gtd/ARCHITECTURE.md
.gtd/PLAN.md + .gtd
.gtd/PLAN.md + .gtd/REVIEW.md
.gtd/PLAN.md + .gtd/FEEDBACK.md
.gtd/PLAN.md + .gtd/ERRORS.md
.gtd/PLAN.md + .gtd/SQUASH_MSG.md     (the last two are defensive, like the
.gtd/PLAN.md + .gtd/LEARNINGS.md       LEARNINGS.md rules: they keep a stray
                          PLAN.md from riding into a squash/learning capture
                          and stranding committed at a boundary HEAD)
.gtd/REVIEW.md + .gtd
.gtd/REVIEW.md + committed .gtd/TODO.md
uncommitted .gtd/REVIEW.md + .gtd/TODO.md
.gtd/REVIEW.md + committed .gtd/ARCHITECTURE.md
uncommitted .gtd/REVIEW.md + .gtd/ARCHITECTURE.md
.gtd/TODO.md + .gtd/ARCHITECTURE.md   (the two never legitimately coexist —
                          TODO.md is always deleted in the same commit that
                          seeds ARCHITECTURE.md)
.gtd/FEEDBACK.md + .gtd/REVIEW.md
.gtd/FEEDBACK.md without .gtd
.gtd/ERRORS.md + .gtd/FEEDBACK.md
.gtd/ERRORS.md without .gtd   (exempted while HEAD is gtd: health-check / gtd: testing —
                          .gtd/ERRORS.md briefly outlives .gtd during the health-check
                          cap escalation)
```

The `.gtd/LEARNINGS.md` rules are defensive, not load-bearing: unlike
`.gtd/HEALTH.md`, `.gtd/LEARNINGS.md`'s presence never drives a routing decision
on its own (§5.2 doesn't mention it) — only `classifyHead`'s `learning` gate
branch reads it, and none of these six combinations can arise on a legal
history.

Each is a predicate over `ResolvePayload` paired with the exact diagnosis string
`GtdStateError` throws.

### 5.2 Steering-file precedence (`resolveBaseline`, ahead of HEAD classification)

These fire regardless of what HEAD says, because file presence is more current
than the last commit:

1. `.gtd/ERRORS.md` present → rest **escalate**, human.
2. `.gtd/HEALTH.md` present (and HEAD is not the health-fixer's own turn
   consuming it) → rest **health-fixing**, agent.
3. `.gtd/FEEDBACK.md` present (and HEAD is not the fixer's own turn consuming
   it, and not force-approved-outside-the-fix-loop) →
   - if HEAD is `gtd: tests-green` (a live, uncommitted write by the review
     agent) → rest **agentic-review**, agent (capture that turn first).
   - else, empty and not already inside the fix loop → mid-chain
     **close-package**.
   - else → rest **fixing**, agent.

### 5.3 HEAD classification (`classifyHead`)

Pure function of the commit subject plus a small config/content-dependent flag
set (`ClassifyFlags`): resolves every turn-commit and routing-commit row in §2's
tables. Returns `null` for boundary subjects and the one payload-dependent
routing row (`gtd: close-package`), deferring those to the ladder below.

### 5.4 Payload-driven ladder (falls through from `classifyHead === null`)

In order:

1. `.gtd/` exists and is modified vs. committed → **planning**.
2. HEAD is `gtd: close-package` → packages remain → **building**; else
   reviewable → **review**; else → idle/health.
3. `.gtd/TODO.md` present (any other HEAD) → **grilling** continues.
4. `.gtd/ARCHITECTURE.md` present (any other HEAD) → **architecting** continues
   (mirrors rung 3 — the two files never coexist, per the illegal-combination
   guard, so ordering between rungs 3 and 4 is inert).
5. `.gtd/PLAN.md` present (any other HEAD) → rest **grilled**, **human**. Unlike
   rungs 3/4 (agent-developed files mid-process), PLAN.md is only ever
   human-authored entry input: the ordinary case is the pre-entry dirty boundary
   (rung 1 of §5.5 short-circuits this baseline), and the recovery case is a
   committed PLAN.md at a boundary HEAD, where the human's `gtd step` resumes
   the entry (captures `gtd(human): grilled`, which seeds and routes) instead of
   corrupting.
6. `.gtd/` exists with a pending package **and** the nearest workflow commit
   (skipping boundary commits stacked on top) is still `gtd(agent): building` →
   **building** (operational-recovery carve-out: a boundary commit, e.g. a
   config fix, landed on top of the checkpoint after a mid-chain failure, but
   the checkpoint is still the active one). Narrow by design — an unrecognized
   boundary HEAD with no such checkpoint in its history still hard-errors.
7. No steering files at all, no recognized workflow HEAD → idle/health
   (`resolveIdleOrHealth`): reviewable diff → **review**; else → **idle**,
   human.
8. Anything else → `corrupt()` — hard error.

### 5.5 Turn-taking layer (`applyTurnTaking`, always applied last)

Independent of the ladder above, layered on every resolved baseline:

1. **Dirty-boundary entry** (`invoker === "human"`, dirty tree, no committed
   .gtd/TODO.md, .gtd/ARCHITECTURE.md, .gtd/PLAN.md, or .gtd/HEALTH.md, no
   packages/REVIEW.md/FEEDBACK.md/ERRORS.md, boundary/`gtd: done` HEAD) →
   captures the entry turn, short-circuiting everything else. Which gate depends
   on which steering file the dirty tree contains (§4, `grilling`'s Entry
   points; pairwise illegal per §5.1, so the pick order is inert):
   `.gtd/HEALTH.md` → `gtd(human): health-fixing`; `.gtd/PLAN.md` →
   `gtd(human): grilled`; `.gtd/ARCHITECTURE.md` → `gtd(human): architecting`;
   otherwise → `gtd(human): grilling`.
2. **Mid-chain baseline** → `invoker === "none"` reports `pending: true`; any
   other invoker performs the edge action.
3. **Rest baseline, `invoker === "none"`** → report state/actor, no mutation.
4. **`gtd: testing` (rest = idle) or `gtd: health-check` at the exhausted cap**
   → force a `runHealthCheck` re-test regardless of invoker (the carve-outs from
   §2).
5. **Out-of-turn**: the invoker is not the awaited actor → `refusal`, in BOTH
   directions, on clean and dirty trees alike (§3) — the wrong mutator always
   errors instead of no-op-ing or adopting the dirty tree as a turn of its own;
   pending edits stay in the tree and ride along as input to the awaited actor's
   next captured turn.
6. **Idle carve-out**: `baseline.state === "idle"`, `invoker === "human"` →
   force `runHealthCheck`, never an empty commit or plain no-op.
7. **In-turn, fixpoint check**: HEAD already carries this exact
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
`agenticReview: false`, `squash: false`, and `learning: false` unless noted.

### Happy path (no detours)

```
<boundary/init>
gtd(human): grilling        # dirty-boundary entry turn
gtd(agent): grilling        # agent develops the product plan (non-empty)
gtd(human): grilling        # human accepts (empty turn)
gtd: architecting            # routing: .gtd/ARCHITECTURE.md seeded, .gtd/TODO.md removed
gtd(agent): architecting    # agent develops the architecture (non-empty)
gtd(human): architecting    # human accepts (empty turn)
gtd: grilled                # routing: converged
gtd(agent): grilled         # agent's own-gate turn (immediately mid-chains)
gtd: building                # routing: .gtd/ARCHITECTURE.md removed
gtd(agent): building        # agent writes code
gtd: tests-green             # routing: test passed
gtd: close-package             # routing: force-approved (agenticReview off)
gtd(agent): review          # agent drafts .gtd/REVIEW.md
gtd: await-review         # routing: rest for the human
gtd(human): review          # human approves (deletes .gtd/REVIEW.md)
gtd: done                    # routing: cycle closed
```

A subsequent `gtd step` at rest with a green health check adds **zero** commits
and reports `state: idle`.

### Happy path with squash on

Same sequence through `gtd: done`, but `gtd: done` is no longer a rest — the
same human-turn invocation continues straight to:

```
gtd: squashing          # writeSquashTemplate
```

`gtd next` renders the squashing prompt; the agent overwrites
`.gtd/SQUASH_MSG.md`; `gtd step-agent` performs the squash — the entire
`gtd(human): grilling .. gtd: squashing` range collapses into one commit whose
subject is the message's first line (e.g.
`feat: add calculator with add support`). None of the intermediate `gtd: *` /
`gtd(actor): *` subjects survive in the final log.

### Happy path with learning on

Same sequence through `gtd: done`, but the same invocation continues straight to
the learning phase first — before the squash decision, if squash is also on:

```
gtd: learning          # writeLearningTemplate
<gtd next → learning prompt with the full-process diff>
gtd(agent): learning            # agent drafts .gtd/LEARNINGS.md (non-template)
gtd: await-learning-review           # routing: rest for the human
gtd(human): learning            # human accepts as-is or edits — no reject path
gtd: learning-apply          # routing: rest for the agent
gtd(agent): learning-apply      # agent integrates into CLAUDE.md/AGENTS.md/docs
gtd: learning-applied           # routing: .gtd/LEARNINGS.md removed
```

From `gtd: learning-applied`, the exact same squash decision `gtd: done` makes
runs again: squash on continues to `gtd: squashing` (§"Happy path with squash
on"); squash off rests at **idle**. When both are on, the doc edits landed in
`gtd(agent): learning-apply` are folded into the eventual squash commit's tree —
they survive there, not as a separate commit.

### Red-then-fixed detour (build/test/fix loop)

```
gtd: building
gtd(agent): building
gtd: test-failed                   # red, below cap: .gtd/FEEDBACK.md written
<gtd next → fixing prompt with the failure output>
gtd(agent): fixing            # fixer patches the code (non-empty diff)
gtd: tests-green               # re-test, now green
gtd: close-package               # force-approve closes it
```

### Grilling round with a human answer

```
gtd(human): grilling          # dirty-boundary entry (notes.md)
gtd(agent): grilling          # agent leaves an open question with a suggested default
gtd(human): grilling          # human answers inline in .gtd/TODO.md (non-empty!) — NOT accept
gtd(agent): grilling          # agent converges, no more markers
gtd: architecting               # human's next clean step converges
```

Note the human's answer round is itself a **non-empty** human turn — it does not
converge on its own; the agent still gets one more round to confirm convergence
before the clean accept lands `gtd: architecting`.

### Architecting round with a human answer

```
gtd: architecting               # routing: .gtd/ARCHITECTURE.md seeded from converged TODO.md
gtd(agent): architecting      # agent leaves an open question with a suggested default
gtd(human): architecting      # human answers inline in .gtd/ARCHITECTURE.md (non-empty!) — NOT accept
gtd(agent): architecting      # agent converges, no more markers
gtd: grilled                    # human's next clean step converges
```

Mechanically identical to the grilling round above, one file and one phase
later.

### Entry point: already-technical input

```
<boundary/init>
gtd(human): architecting      # dirty-boundary entry, but the human authored
                                 # .gtd/ARCHITECTURE.md directly — product
                                 # grilling is skipped entirely
gtd(agent): architecting      # agent develops the architecture from that raw input
gtd(human): architecting      # human accepts (empty turn)
gtd: grilled                    # routing: converged — .gtd/TODO.md never existed
```

### Entry point: a final plan, straight to decomposition

```
<boundary/init>
gtd(human): grilled           # dirty-boundary entry — the human authored
                                 # .gtd/PLAN.md, a FINAL architecture
gtd: grilled                    # routing: .gtd/ARCHITECTURE.md seeded from
                                 # .gtd/PLAN.md (removed) — same invocation
gtd(agent): grilled           # decompose turn (packages written)
gtd: building                   # routing: .gtd/ARCHITECTURE.md removed
...                             # building/testing/review proceed as usual —
                                 # no grilling or architecting round ever ran
```

### Entry point: a hand-written error report, straight to error fixing

```
<boundary/init>
gtd(human): health-fixing     # dirty-boundary entry — the human authored
                                 # .gtd/HEALTH.md describing the errors
<gtd next → health-fixing prompt with the hand-written description>
<a clean opening gtd step-agent here is INERT — the description survives>
gtd(agent): health-fixing     # fixer's turn (the actual fix)
gtd: testing                 # routing: .gtd/HEALTH.md removed; re-tests in
                                 # the same chain
# green, squash on  → gtd: tests-green → gtd: squashing → ... → one
#                     squash commit collapsing from the entry turn (the run
#                     may have ZERO gtd: health-check commits)
# green, squash off → stop, plain idle rest
# red               → gtd: health-check (machine-written HEALTH.md now carries
#                     the test output) — the normal detour loop from here
```

### Escalation and recovery

```
gtd: test-failed   (×fixAttemptCap)
gtd: test-failed                    # at/over cap: .gtd/ERRORS.md written instead of .gtd/FEEDBACK.md
<escalate prompt: human reads .gtd/ERRORS.md>
<human deletes .gtd/ERRORS.md, runs gtd step>
gtd(human): escalate           # mid-chain: re-tests from a reset budget
gtd: tests-green                 # (if the human's fix worked)
```

### Review-feedback detour

```
gtd: await-review
gtd(human): review             # substantive edit/annotation (not a plain approve)
gtd: grilling             # routing: .gtd/REVIEW.md removed, re-grilling begins
gtd(agent): grilling           # re-plan against the captured feedback diff
...                             # re-enters grilling → planning → building
gtd: await-review            # follow-up review covers only the new work packages
```

No `gtd: done` is ever committed on this path until a later review approves
cleanly.

### Health cycle (idle path)

```
<idle, clean tree>
<gtd step: health check runs testCommand>
gtd: health-check                # red below cap: .gtd/HEALTH.md written
gtd(agent): health-fixing       # fixer's own turn
gtd: testing                   # .gtd/HEALTH.md removed; re-tests in the same chain
# green, learning off, squash off → stop, plain idle rest, zero further commits
# green, learning on               → gtd: tests-green → gtd: learning → ... (learning phase, then the squash decision)
# green, learning off, squash on  → gtd: tests-green → gtd: squashing → ... → one squash commit
# red, below cap    → gtd: health-check again (loop)
# red, at cap       → .gtd/ERRORS.md written, gtd: health-check → escalate
```

## 7. The loop protocol

The step-first two-beat loop an agent (or the `loop` skill) should run to drive
`gtd` end to end:

1. Run `gtd step-agent`.
2. Run `gtd next`.
3. If `actor` is `"human"` → **halt** (the human owns the next move: a human
   gate — answer .gtd/TODO.md or .gtd/ARCHITECTURE.md questions, review, review
   the distilled learnings, fix an escalation — or a human-driven pending
   checkpoint resumed by `gtd step`).
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
