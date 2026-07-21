# The workflow

gtd drives a turn-taking loop between a human and an autonomous coding agent:
capture an idea, grill it into a product-level plan, grill that into a technical
architecture, decompose it into work packages, execute with parallel subagents,
test, agentically review each package, walk a human through a review, distill
durable lessons from the cycle into the project's own docs, and finally squash
the whole cycle into one conventional-commits commit at the end.

## How state is derived

Internally, gtd is a **pure fold** over git history. The decision core
(`src/Machine.ts`) is a single IO-free function, `resolve(events)` — **no
xstate, no actor, no Effect**. The Effect "edge" (`src/Events.ts`) does all the
git/filesystem IO: it reads the **first-parent** commit subjects since the
merge-base with the default branch (whole-history fallback when there is no
default branch, when HEAD equals the merge-base, or when there is no merge-base)
plus the working tree, turns them into a `COMMIT[]` + single terminal `RESOLVE`
event stream, and folds them through the machine. The fold lands on exactly
**one** of 21 states, plus which actor (human or agent) is awaited there. A
single call resolves to a single state.

Steering is entirely **machine-authored commit subjects** — there are no marker
files, sentinels, or auto-advance tails to parse. A turn commit looks like
`gtd(human): grilling` or `gtd(agent): building`; a routing commit (bookkeeping
the machine performs itself between turns) looks like `gtd: tests-green`.
`src/Subjects.ts` is the closed grammar both the machine and the edge read.

All workflow state lives under **`.gtd/`**: the product plan (`.gtd/TODO.md`),
the technical architecture it converges into (`.gtd/ARCHITECTURE.md`), a
hand-written final architecture (`.gtd/PLAN.md`, an entry file — see
[Entry points](#entry-points-which-file-starts-the-cycle-where)), work packages
(`.gtd/01-…/`), review records (`.gtd/REVIEW.md`, `.gtd/FEEDBACK.md`), and loop
bookkeeping (`.gtd/ERRORS.md`, `.gtd/HEALTH.md`, `.gtd/LEARNINGS.md`,
`.gtd/SQUASH_MSG.md`). One rule follows for every agent in the loop: **never
touch `.gtd/`** except the single file a prompt explicitly grants. A `TODO.md`
or `REVIEW.md` at the repository root is the project's own file — gtd never
reads, consumes, or deletes it. (Corollary: don't gitignore `.gtd/` — the
workflow commits its state through it.)

A squash commit's message can carry a `## Decisions` section — one entry per
architecture/product question resolved that cycle. Grilling/architecting read
every past squash commit's `## Decisions` section back as "Prior decisions"
context, oldest to newest. See `decisionLog` under
[Configuration](configuration.md).

## States & subjects overview

`resolve()` lands on exactly one of **21 states**: `grilling`, `architecting`,
`grilled`, `planning`, `building`, `testing`, `fixing`, `escalate`,
`agentic-review`, `close-package`, `review`, `await-review`, `done`, `learning`,
`await-learning-review`, `learning-apply`, `learning-applied`, `squashing`,
`idle`, `health-check`, `health-fixing`. Each state has a fixed awaited actor
(see `awaitedActor` in `src/Machine.ts`): `idle`, `escalate`, `await-review`,
and `await-learning-review` await the **human**; every other state awaits the
**agent**.

For the full precedence ladder, illegal combinations, and the counter folds that
drive the fix loops, see [STATES.md](../STATES.md) — this section is a summary.

### Turn commits — `gtd(<actor>): <gate>`

Authored by `gtd step human`/`gtd step agent` as the first commit of a fresh
chain. The closed set of gates:

| Gate             | Authored by                                                        |
| ---------------- | ------------------------------------------------------------------ |
| `grilling`       | human (answers) / agent (product-plan iteration)                   |
| `architecting`   | human (answers) / agent (architecture iteration)                   |
| `grilled`        | agent (converged, ready to decompose) / human (PLAN.md entry turn) |
| `building`       | agent (package work, or human feedback while agent is out of turn) |
| `fixing`         | agent (test-fix or review-fix round)                               |
| `agentic-review` | agent (writes .gtd/FEEDBACK.md verdict)                            |
| `review`         | agent (writes .gtd/REVIEW.md) / human (approves or gives feedback) |
| `squashing`      | agent (overwrites .gtd/SQUASH_MSG.md)                              |
| `learning`       | agent (overwrites .gtd/LEARNINGS.md) / human (accepts or edits)    |
| `learning-apply` | agent (integrates .gtd/LEARNINGS.md into CLAUDE.md/AGENTS.md/docs) |
| `health-fixing`  | agent (idle health-check repair) / human (HEALTH.md entry turn)    |
| `escalate`       | human (deletes .gtd/ERRORS.md to resume)                           |

### Machine commits — `gtd: <state>`

Bookkeeping the machine authors itself between turns, never a turn a human or
agent "wins". Each label names the **state the commit enters** — so
`git log --oneline` reads as a state trace — with two **marker states**
(`tests-green` / `test-failed`) recording a check outcome whose next state is
decided by guarded rules at resolution. The closed set: `gtd: architecting`,
`gtd: grilled`, `gtd: building`, `gtd: tests-green`, `gtd: test-failed`,
`gtd: close-package`, `gtd: await-review`, `gtd: grilling`, `gtd: done`,
`gtd: squashing`, `gtd: review <hash>` (parameterized, from `gtd review`),
`gtd: health-check`, `gtd: testing`, `gtd: learning`,
`gtd: await-learning-review`, `gtd: learning-apply`, `gtd: learning-applied`.

Everything else — any non-`gtd` subject, and any `gtd: *` subject outside this
closed set — is a **boundary commit**: inert as far as the machine's grammar is
concerned. See [Upgrading from v1](upgrading-from-v1.md) for why this matters on
upgrade.

## Grilling: two phases, product then architecture

A dirty tree at a boundary HEAD (a fresh idea, sketched in a file or just left
as pending code) is captured in **one** human turn: `gtd step human` commits
everything pending as `gtd(human): grilling` — nothing is reverted or seeded,
the captured files stay in history. `gtd next` hands the agent that turn's diff;
the agent develops `.gtd/TODO.md` into a concrete **product-level** plan **in
one turn** — user-facing decisions only, no architecture — proposing a
**suggested default** for every open question under an enforced
`## Open Questions` structure (see
[Structured grilling/architecting and review files](#structured-grillingarchitecting-and-review-files)),
and leaves `.gtd/TODO.md` uncommitted for `gtd(agent): grilling`.

There are no markers to answer — the human either:

- **Accepts the suggested defaults**: runs a clean `gtd step human` at the
  answer gate. An empty `gtd(human): grilling` turn plus routing
  `gtd: architecting` lands automatically — `.gtd/ARCHITECTURE.md` is seeded
  from the converged `.gtd/TODO.md` content and `.gtd/TODO.md` is deleted, in
  that one commit.
- **Edits `.gtd/TODO.md`** with real answers, then runs `gtd step human`, which
  captures the edit as a fresh `gtd(human): grilling` turn and hands it back to
  the agent for another round.

Technical architecting works exactly the same way, one file later: the agent
develops `.gtd/ARCHITECTURE.md` into a concrete **technical** plan — file/module
structure, data model, tech-stack choices — and the human answers or accepts
defaults at the `architecting` gate. Accepting converges to `gtd: grilled` and
`gtd next` emits the decompose prompt (which now reads `.gtd/ARCHITECTURE.md`).

## Entry points: which file starts the cycle where

The entry turn's gate is driven purely by which steering file the human's
initial dirty tree contains (file _presence_, never content — no CLI flag
needed). Four entry points:

| File in the dirty tree      | Entry point                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| none (plain notes/sketches) | **Product grilling** — `gtd(human): grilling`; the agent develops `.gtd/TODO.md` from your notes                                                                                                                                                                                                                              |
| `.gtd/TODO.md`              | **Product grilling** — same gate; your draft IS the product plan the agent iterates on                                                                                                                                                                                                                                        |
| `.gtd/ARCHITECTURE.md`      | **Technical grilling** — `gtd(human): architecting`; product grilling is skipped, the agent iterates your technical sketch (great for refactorings or test improvements with no product-facing changes)                                                                                                                       |
| `.gtd/PLAN.md`              | **Decomposition** — `gtd(human): grilled`; the plan is FINAL: a mid-chain hop seeds `.gtd/ARCHITECTURE.md` from it (deleting `.gtd/PLAN.md`) and rests at the decompose prompt — no grilling round ever runs                                                                                                                  |
| `.gtd/HEALTH.md`            | **Error fixing** — `gtd(human): health-fixing`; your hand-written error description rests at the health-fixing prompt, and the normal health detour takes over (fix → re-test with `testCommand` → cap/escalate → squash/learning tail). The description is a means to make `testCommand` green — a red re-test overwrites it |

The entry files are pairwise **illegal combinations** (see
[STATES.md](../STATES.md) §5.1), so the pick is always unambiguous — a tree
containing both `.gtd/PLAN.md` and `.gtd/TODO.md` hard-errors instead of
guessing.

One guard worth knowing for the HEALTH.md entry: the loop protocol opens every
iteration with a clean-tree `gtd step agent`, and at this one rest that opening
beat is **inert** while HEAD is still the human's entry turn — so the
hand-written description is never consumed before an agent has read it.

## Structured grilling/architecting and review files

`.gtd/TODO.md`, `.gtd/ARCHITECTURE.md`, and `.gtd/REVIEW.md` stay plain,
human-readable markdown, but each follows an enforced structure so the data can
be parsed out programmatically (`gtd questions` / `gtd changesets`, both
`--json`-able, for a future UI) instead of staying opaque prose.

**Grilling/architecting** (identical contract, one file and phase apart): an
OPTIONAL `## Open Questions` section — omitted entirely means zero open
questions, not an error. Every `###` sub-heading directly under it is one open
question; its first body line must be `Suggested default: <text>` (the agent's
proposal) or `Answer: <text>` (a human's answer):

```markdown
# Plan

Build a calculator that can add and subtract.

## Open Questions

### Which operations?

Suggested default: add and subtract.
```

**Review**: a `# Review: <short-hash>` header as the first line, an
`<!-- base: <full-hash> -->` comment, and at least one `##` chunk with a
non-empty title and at least one `- [ ]` / `- [x]` file-pointer line — the same
format `@review` already instructs the agent to write (see
[Human review gate](#human-review-gate) below).

Validation applies ONLY to the **agent's own authored draft** at the gate that
writes the file — never to a human's free-form edits (their answer at the
grilling/architecting gate, their feedback/approval at the review gate). When
the active file is malformed, `gtd step agent` refuses (zero commits, a stderr
message listing every structural problem) instead of capturing the turn; the
agent fixes the file and reruns `gtd step agent`. `gtd questions --json` /
`gtd changesets --json` surface the same `errors` without blocking anything, so
an agent (or a UI) can self-check before committing to a turn.

## Build lifecycle: budgets

Once decomposed, `.gtd/` holds ordered work packages. `gtd next` at
`gtd: building`/`gtd: close-package` selects the lowest-numbered remaining
package and inlines only its task files. The agent builds it and leaves the work
**uncommitted**; the next invocation's edge action commits it (the
`gtd(agent): building` turn commit) and runs `testCommand`.

- **Green** → Agentic Review.
- **Red, below `fixAttemptCap`** (default 3) → write findings, commit
  `gtd: test-failed`, rest at **Fixing** for the agent.
- **Red, at/over the cap** → write `.gtd/ERRORS.md` instead, commit
  `gtd: test-failed`, rest at **Escalate** — a human gate. Deleting
  `.gtd/ERRORS.md` and landing that deletion as `gtd(human): escalate` resets
  the budget and re-tests from zero in the same invocation.

## Agentic review

A green test run always rests at **Agentic Review**: the agent reviews the
package's accumulated diff against its task specs and writes `.gtd/FEEDBACK.md`.
An **empty** `.gtd/FEEDBACK.md` is the approval signal — the same
`gtd(agent): agentic-review` turn closes the package (`gtd: close-package`,
removing `.gtd/FEEDBACK.md` and the finished package directory) in one
invocation. Non-empty findings rest for the fixing prompt; fixing loops back
through the test gate and re-reviews. Once `reviewFixCount >= reviewThreshold`
(default 3) within a package, Agentic Review **force-approves** without ever
writing `.gtd/FEEDBACK.md` — so a package can never review-loop forever. The
findings round that crosses the threshold still gets its fixing round; the
force-approve close then fires at the next green re-test instead of another
review. (Any agentic-review turn that touches `.gtd/FEEDBACK.md` counts toward
the threshold — including the approval write itself; an approval that crosses
the threshold simply closes the package as usual.) Setting
`agenticReview: false` force-approves every package immediately.

A **do-nothing agent invocation** — `gtd step agent` on a clean tree at ANY
agent-awaited rest whose move is a file artifact (`grilling`, `architecting`,
`grilled`, `building`, `fixing`, `agentic-review`, `review`, `squashing` while
`.gtd/SQUASH_MSG.md` still holds the unmodified template, `learning` while
`.gtd/LEARNINGS.md` still holds the unmodified template, and `learning-apply`
unconditionally) — is inert: zero commits, no state consumed; `gtd next`
re-emits the same prompt. This is load-bearing for the loop protocol, whose
every iteration opens with `gtd step agent` before the agent has acted: without
the guard that opening beat would author junk empty turns — and worse, consume
workflow state (an empty decompose turn would delete `.gtd/ARCHITECTURE.md` with
no packages written; an empty squashing turn would squash the cycle under the
placeholder template). The same guards hold at the classification layer for
histories that already carry such turns: a `gtd(agent): grilled` HEAD only
routes to `gtd: building` when packages exist, a `gtd(agent): review` HEAD only
routes to `gtd: await-review` when `.gtd/REVIEW.md` exists, and a squashing (or
learning) turn only proceeds once its template has been overwritten. The one
deliberate exception is `health-fixing`, whose empty turn is meaningful (the
failure may have been environmental — the machine removes `.gtd/HEALTH.md` and
re-tests) — except while HEAD is still the human's hand-written HEALTH.md entry
turn (`gtd(human): health-fixing`), where the empty opening beat is inert so the
description survives until an agent has actually read it. Human gates are
unaffected: an empty **human** turn stays a signal (accept-defaults at
grilling/architecting, clean approval at review, accept-the-draft-as-is at the
learning review gate).

## Human review gate

Once `.gtd/` is fully closed, the machine writes `.gtd/REVIEW.md` and rests at
**await-review**, awaiting the human. Approval is any of:

- A **clean** `gtd step human` (nothing edited) — an empty `gtd(human): review`
  turn plus routing `gtd: done`.
- Flipping only `- [ ]` → `- [x]` checkboxes in `.gtd/REVIEW.md` — checkbox-only
  edits are also treated as clean approval.
- Deleting `.gtd/REVIEW.md` outright.

Any **substantive** edit — to `.gtd/REVIEW.md` prose, or to the reviewed code
itself — is feedback: `gtd(human): review` plus routing `gtd: grilling`,
`.gtd/REVIEW.md` removed, and `gtd next` re-emits a grilling prompt to the agent
that inlines the human's finding.

**The review diff lives in your editor.** While the gate is pending, gtd holds
open a _review checkout window_: it saves the real head to
`refs/gtd/review-head`, then rewinds HEAD and the index to the review base with
`git reset --mixed`, leaving the working tree untouched. Every editor's standard
git integration now shows the entire reviewable diff as ordinary uncommitted
changes — SCM panel, gutter marks, per-file diffs. Review it there:

- **Edit** anything (code or `.gtd/REVIEW.md` prose) → feedback.
- **Discard a hunk** in the editor → that reversion IS the feedback: the agent
  is re-grilled with it.
- **Delete a surfaced file** → reject-this-file feedback.
- Touch nothing (or tick checkboxes / delete `.gtd/REVIEW.md`) → approval.

Any gtd invocation closes the window first (restoring HEAD/index exactly, so
only your own edits remain dirty — they land as their own separate
`gtd(human): review` commit, never mixed into the reviewed work), and
`gtd next`/`gtd status` re-arm it on their way out. The mechanics are
crash-safe; details and invariants in [STATES.md](../STATES.md) ("The review
checkout window").

Caveats while a review is pending: don't push (the branch tip rests at the
review base — the real head is safe under `refs/gtd/review-head`); commits you
make manually survive as working-tree content and become review feedback, but
their commit message is discarded; linked `git worktree` checkouts are
unsupported. If you switch branches mid-review, gtd refuses to touch the foreign
branch and prints the manual recovery command.

## Learning

With `learning: true` (the default), `gtd: done` (or the health-fix path's green
re-test) is **not** a rest — the chain continues straight to `gtd: learning`,
writing and committing a `.gtd/LEARNINGS.md` template, running _before_ the
squash decision so it still sees the pre-squash history. `gtd next` then emits
the learning prompt: the agent walks the cycle's test failures, review feedback,
and health-check rounds, keeps only durable/generalizable lessons, and
overwrites `.gtd/LEARNINGS.md` with them. Once `gtd step agent` captures that
draft (`gtd(agent): learning`), it rests at **await-learning-review** for a
human — who either accepts the draft as-is (an empty turn) or edits it; there is
no reject path, so the very next `gtd step human` always proceeds
(`gtd(human): learning` → `gtd: learning-apply`), resting at **learning-apply**
for the agent. The agent integrates the approved learnings into the project's
own docs (`CLAUDE.md`/`AGENTS.md`/wherever fits, its judgment); its turn
(`gtd(agent): learning-apply`) removes `.gtd/LEARNINGS.md` and lands at
`gtd: learning-applied`, which then runs the same squash decision `gtd: done`
runs today. With `learning: false`, `gtd: done` behaves exactly as it does
without this section: no `.gtd/LEARNINGS.md` is ever written. Learning and
squash are independent flags — either can be on without the other.

## Squash

With `squash: true` (the default), `gtd: done` (or, once learning has run,
`gtd: learning-applied`) is **not** a rest — the same chain continues straight
to `gtd: squashing`, writing and committing a `.gtd/SQUASH_MSG.md` template.
`gtd next` then emits the squashing prompt: the agent overwrites
`.gtd/SQUASH_MSG.md` with a real conventional-commits message (drawing on
grilling- and architecting-round decisions from history, and, when this cycle
resolved any open questions, a `## Decisions` section recording them) and
finishes its turn. `gtd step agent` then performs the squash itself:
`git reset --soft <base>` + `git commit`, collapsing every intermediate `gtd: *`
commit of the cycle into one — including any review-feedback detours, and the
learning phase's own commits if learning ran: the squash base is the cycle's
ORIGINAL start (the first grilling, architecting, or grilled entry turn since
the previous `gtd: done` boundary — whichever entry point the cycle used — or
the `gtd: review <hash>` anchor for an ad-hoc review cycle), not the most recent
re-grilling round — the collapse folds the whole cycle into one, using the
overwritten message's content verbatim (turn position, not message content,
triggers the squash). Doc edits made during `learning-apply` survive in the
squashed tree, not as their own commit. With `squash: false`, `gtd: done` (or
`gtd: learning-applied`) is the resting boundary and no template is ever
written.

## Health check

Outside any process (idle, nothing to review, no steering files),
`gtd step human` runs `testCommand` as a health check rather than settling
immediately. Green settles idle with zero commits. Red below `fixAttemptCap`
writes `.gtd/HEALTH.md` and rests at **Health Fixing** for the agent; the
fixer's own turn (`gtd(agent): health-fixing`) removes `.gtd/HEALTH.md` and
re-tests in the same chain — a green re-test continues to learning (if enabled),
then squash (if enabled), or idle; red repeats the health-fix loop; red at the
cap writes `.gtd/ERRORS.md` and escalates.

The same detour is also a direct entry point: hand-write `.gtd/HEALTH.md`
describing the errors and run `gtd step human` (see
[Entry points](#entry-points-which-file-starts-the-cycle-where)).

## Escalate / budget reset

`.gtd/ERRORS.md` present is always a human gate, regardless of which loop wrote
it (test-fix or health-fix). Deleting `.gtd/ERRORS.md` and running
`gtd step human` records the deletion as the human's `gtd(human): escalate`
turn, which **immediately re-tests in the same invocation** — this resets the
relevant fix-attempt budget to zero.

## States & subjects: overview table

| State                   | Awaits         | Turn/routing subject at rest                                   |
| ----------------------- | -------------- | -------------------------------------------------------------- |
| `grilling`              | human or agent | `gtd(human): grilling` / `gtd(agent): grilling`                |
| `architecting`          | human or agent | `gtd: architecting` / `gtd(agent): architecting`               |
| `grilled`               | agent          | `gtd: grilled`                                                 |
| `planning`              | agent          | `.gtd/` modified                                               |
| `building`              | agent          | `gtd: building` / `gtd: close-package`                         |
| `testing`               | — (edge-only)  | mid-chain only                                                 |
| `fixing`                | agent          | `gtd: test-failed`                                             |
| `escalate`              | human          | `.gtd/ERRORS.md` present                                       |
| `agentic-review`        | agent          | `gtd: tests-green`                                             |
| `close-package`         | — (edge-only)  | mid-chain only                                                 |
| `review`                | agent          | `gtd: close-package` (no more packages) / `gtd: review <hash>` |
| `await-review`          | human          | `gtd: await-review`                                            |
| `done`                  | — (edge-only)  | `gtd: done`                                                    |
| `learning`              | agent          | `gtd: learning`                                                |
| `await-learning-review` | human          | `gtd: await-learning-review`                                   |
| `learning-apply`        | agent          | `gtd: learning-apply`                                          |
| `learning-applied`      | — (edge-only)  | `gtd: learning-applied`                                        |
| `squashing`             | agent          | `gtd: squashing`                                               |
| `idle`                  | human          | no steering files, green health check                          |
| `health-check`          | — (edge-only)  | mid-chain only                                                 |
| `health-fixing`         | agent          | `.gtd/HEALTH.md` present                                       |

See [STATES.md](../STATES.md) for the full precedence ladder, the counter folds,
and every illegal steering-file combination.

## Build orchestration

### Decompose

The Grilled/Planning states spawn a planning-model subagent that breaks
`.gtd/ARCHITECTURE.md` into executable work packages under `.gtd/`:

```
.gtd/
  01-auth-module/
    01-define-types.md
    02-implement-login.md
  02-api-endpoints/
    01-create-routes.md
    02-add-middleware.md
```

Rules:

- **Packages are sequential, in ordinal dependency order** — `01-`, `02-`, …;
  the set is frozen once written. Package 02 cannot start until 01 is complete.
- **Each package is green on its own** — the test suite runs after every
  package, so none may leave the tree red for a later package to fix.
- **Tasks within a package are parallel and file-disjoint** — one subagent per
  task, no isolation; tasks that would touch the same file are merged into one.
- **Vertical slices, not horizontal** — each package is a thin, end-to-end
  slice; prefer many thin packages over a "set up infrastructure" package.
- **Task files are self-contained** — description, acceptance-criteria
  checkboxes, relevant file paths, constraints, and edge cases.

### Execute

Execution is **one package per cycle**. `gtd next` selects the single next
package itself, names it in the prompt, and inlines its task files' full
contents — the agent never browses `.gtd/` or picks a package itself. A single
cycle:

1. Spawn parallel execution-model workers for all tasks in the selected package.
2. Leave all changes **uncommitted**. Do not commit, do not delete the package
   directory, do not run tests.
3. Finish the turn with `gtd step agent` — the next hop's edge action commits
   the work (`gtd(agent): building`) and runs `testCommand` to verify it.
