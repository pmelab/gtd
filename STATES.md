# Repository states and development phases

`gtd` reads the repository — working tree, the steering files present, and the
last commit message — derives the current state, performs deterministic actions
(commits, reverts, file edits, running tests), and prints the next prompt for
the agent. States tagged **auto-advance** append a suffix telling the agent to
run `gtd` again, so a chain of deterministic steps runs without human input.

High-level procedure on every invocation:

1. derive the current state from filesystem + working-tree status + last commit
   message
2. execute deterministic actions
3. print the next instruction prompt (auto-advance states also tell the agent to
   re-run `gtd`)

## Steering files

`gtd` writes and commits temporary steering files:

- **TODO.md** — the current plan
- **REVIEW.md** — a guided human review with file pointers spanning a commit
  diff
- **FEEDBACK.md** — test output, or agentic-review findings to be fixed — an
  **empty** FEEDBACK.md from a clean agentic review signals approval (→ Close
  package)
- **ERRORS.md** — escalation gate: persistent test-failure output that stops the
  loop for a human (written instead of FEEDBACK.md once the fix-attempt cap is
  hit; never auto-consumed)
- **.gtd/** — ordered work packages (one directory each) of parallelizable
  subtasks

Steering files are **authoritative**: while any exist, `gtd` resumes that
workflow regardless of the last commit (even a non-gtd one). They are never
garbage-collected automatically — a stale steering file from an abandoned branch
is resumed exactly like a live one, so the user must `rm` files from a workflow
they have abandoned.

"**Code changes**" below means pending working-tree changes (tracked or
untracked, respecting `.gitignore`) **outside** the steering set. Changes to
steering files are detected separately.

## Detection model

### Commit taxonomy

The last commit message is bucketed:

- **Boundary** — a non-`gtd:` commit, or `gtd: done`. Marks a cold start: no
  workflow in progress.
- **Mid-phase** — `gtd: new task | grilling | grilled | planning | building |
  errors | fixing | feedback | package done | awaiting review`. Identifies the
  exact phase of an in-progress workflow; disambiguates states the filesystem
  alone cannot separate.

### Precedence (first match wins)

0. **HEAD `gtd: transport`** → Transport.
1. **ERRORS.md present** → Escalate (human gate; STOP).
2. **FEEDBACK.md present** → non-empty → Fixing; **empty** (a clean agentic
   review = approval) → Close package.
3. **.gtd present** → build lifecycle, routed by tree + HEAD:
   - `.gtd` modified (package files added/edited) → Planning
   - code changes present → Testing
   - clean tree + HEAD `gtd: fixing` (no-op fixer) → Testing (re-test)
   - else clean, by HEAD: `planning`/`package done` → Building; `building` →
     Agentic Review
4. **REVIEW.md present** → review lifecycle (Await Review / Accept Review /
   Done), routed by committed-ness + tree.
5. **Boundary HEAD + pending changes** (no .gtd/REVIEW/FEEDBACK), or HEAD
   `gtd: new task` + clean tree (regenerate a lost seed) → New Feature.
6. **TODO.md present** → Grilling / Grilled.
7. **Boundary/`package done` HEAD + clean tree** → Clean (review) or Idle.

Anything matching no rule is corruption — hard-error rather than guess.

State is folded from **first-parent** history: gtd assumes a single writer on a
linear branch. Distribute by **sequential handoff** (one active machine at a
time) over **rebase / fast-forward** — a merge commit as HEAD breaks the counter
folds, the review base, and last-commit detection. `gtd: transport` is the
primitive for carrying uncommitted work across machines (commit it, push, reset
on the far side).

### Illegal combinations

These never arise in normal flow; if seen, `gtd` hard-errors rather than
guessing:

- REVIEW.md + .gtd
- REVIEW.md + TODO.md
- FEEDBACK.md + REVIEW.md
- FEEDBACK.md without .gtd
- ERRORS.md + FEEDBACK.md
- ERRORS.md without .gtd

Legal coexistence: `.gtd`+TODO.md (plan + packages during build),
FEEDBACK.md+`.gtd` (fix during build).

## States

### Transport

**Conditions:** HEAD is `gtd: transport` (produced by the external `gtd
transport` command that commits in-progress work to move it across
machines/branches — not by the state machine itself).

**Actions:** mixed-reset the `gtd: transport` commit, then re-derive state from
scratch.

**Prompt:** none.

### New Feature (auto-advance)

**Conditions:** either boundary HEAD (non-gtd or `gtd: done`) with pending **code
changes and/or a new (uncommitted) TODO.md** and no `.gtd`/REVIEW.md/FEEDBACK.md
(a _committed_ TODO.md under a boundary HEAD is a resumed grill — see Grilling);
**or** HEAD `gtd: new task` with a clean tree (a checkout/pull that lost the
uncommitted seed — regenerate it).

**Actions:**

- if HEAD is not already `gtd: new task`, commit the raw input verbatim
  `gtd: new task` (durable capture; advances HEAD off the boundary)
- revert `gtd: new task`'s diff into the working tree, uncommitted — back to a
  clean baseline
- seed TODO.md, uncommitted, from that diff (any prior TODO.md text, code
  comments, code suggestions)

**Prompt:** none — auto-advance. _(Next: TODO.md present + reverted code →
Grilling, which commits the revert + seed as the first `gtd: grilling` and
develops the plan. The seed is regenerable from the `gtd: new task` commit, so
this state survives a checkout/pull — no `gtd: cleanup` needed.)_

### Grilling

TODO.md is present and this is not New Feature. "Pending" = uncommitted at
invocation. (The first round after New Feature / Accept Review carries the
reverted code + seeded TODO.md, committed together as the first `gtd: grilling`.)
Resolves three ways:

**1 — Open questions** (TODO.md has remaining `?` markers):

- **Actions:** commit any pending changes `gtd: grilling`.
- **Prompt:** STOP — tell the user to answer the open questions inline in
  TODO.md. _(not auto-advance — human turn)_

**2 — Adjustment** (no markers, but pending changes to TODO.md or other files):

- **Actions:** commit pending changes `gtd: grilling`.
- **Prompt:** grilling agent — incorporate the edits, push back, ask anything
  still unresolved (re-opening `?` markers if needed). _(auto-advance)_

**3 — Converged** (no markers, clean tree) → **Grilled**.

Advance happens only at case 3 — an invocation where nobody changed anything and
no question is open — so the user (or agent) may iterate indefinitely.
Convention: each round ends either leaving `?` markers or writing "no open
questions — run gtd to plan", so a clean tree with no markers means genuinely
converged; hold the gate by leaving a marker.

### Grilled (auto-advance)

**Conditions:** TODO.md present, no `?` markers, clean tree.

**Actions:** commit any pending changes `gtd: grilled`.

**Prompt:** decompose the plan — create the `.gtd/` directory of ordered work
packages and parallelizable subtasks.

### Planning (auto-advance)

**Conditions:** `.gtd` present and modified (package files added/edited); HEAD
`gtd: grilled` or `gtd: planning`.

**Actions:** commit changes `gtd: planning`.

**Prompt:** continue decomposition if incomplete, otherwise none. _(Planning may
span multiple turns: each turn commits `gtd: planning`; an unmodified `.gtd` with
a clean tree advances to Building.)_

### Building (auto-advance)

**Conditions:** `.gtd` present and clean, clean tree, HEAD `gtd: planning` or
`gtd: package done`.

**Actions:** select the first remaining package.

**Prompt:** subagents build the subtasks of the first package in parallel.

### Testing (auto-advance)

**Conditions:** `.gtd` present and clean; no FEEDBACK.md; ERRORS.md not present;
and a reason to test — **code changes** present, a pending **ERRORS.md deletion**
(human resume), or a clean tree under HEAD `gtd: fixing` (a fixer that produced
no change — re-test it).

**Actions:**

- commit any pending changes `gtd: building` (nothing to commit in the
  no-op-fixer case)
- run the test command
- exit = 0 → proceed
- exit ≠ 0 → count `gtd: errors` (fix attempts) since the **most recent of** the
  package start (`gtd: planning`/`gtd: package done`), the last `gtd: feedback`
  (start of a review-fix), or the last commit that **removed ERRORS.md**, walking
  through any non-gtd commits — so each test-fix sub-loop, every review-fix, and a
  human resume each start a fresh budget:
  - **under the fix-attempt cap (default 3)** → write output to FEEDBACK.md,
    commit `gtd: errors`
  - **at/over the cap** → write output to ERRORS.md, commit `gtd: errors`

**Prompt:**

- tests green, or FEEDBACK.md written → re-invoke _(auto-advance → Agentic
  Review or Fixing)_
- ERRORS.md written → **STOP**, no auto-advance: report that the fix-attempt cap
  was reached and the human must investigate (→ Escalate)

### Fixing (auto-advance)

**Conditions:** **non-empty** FEEDBACK.md present (an empty FEEDBACK.md is a clean
review → Close package). Implies `.gtd` present.

**Actions:**

- read FEEDBACK.md into the prompt
- if FEEDBACK.md is **uncommitted** (written by Agentic Review) → commit its
  removal `gtd: feedback` (the review-loop iteration marker)
- if FEEDBACK.md is **already committed** (`gtd: errors`, written by Testing) →
  commit its removal `gtd: fixing`
- FEEDBACK.md is removed either way, so the next state is not Fixing

**Prompt:** fixer agent — fix the code per the feedback. _(Fixer output returns
through Testing → `gtd: building`.)_

### Escalate

**Conditions:** ERRORS.md present (highest precedence after Transport; implies
`.gtd` present).

**Actions:** none.

**Prompt:** **STOP** — surface the captured test failure and tell the human to
investigate; `gtd` will not auto-advance to another fix attempt while ERRORS.md
exists. The human resolves (or nudges) the failure and removes ERRORS.md to
resume: removing ERRORS.md **resets the fix-attempt budget** (the count restarts
after that removal), so the next run re-tests and grants another `cap` agentic
fixes before escalating again. _(not auto-advance — human gate.)_

### Agentic Review (auto-advance)

**Conditions:** `.gtd` present and clean, clean tree, no FEEDBACK.md, HEAD `gtd:
building`.

**Actions:** if the `gtd: feedback` count (review-fix rounds, independent of the
test-fix `gtd: errors` count) since the package start has reached the threshold →
write an **empty** FEEDBACK.md (force-approve) and skip the review; otherwise
none.

**Prompt:** (only when not force-approved) review the package's accumulated diff
(since `gtd: planning`/`gtd: package done`) and **always write FEEDBACK.md** —
empty if clean (= approval), with findings if not. _(auto-advance)_

_Next: empty FEEDBACK.md → Close package; non-empty → Fixing. The verdict is a
file, not a marker commit, so a pending review (no FEEDBACK yet) re-detects
Agentic Review and re-reviews instead of being mistaken for "done" — and it
survives a checkout/pull._

### Close package (auto-advance)

**Conditions:** an **empty** FEEDBACK.md present (a clean agentic review =
approval); `.gtd` present.

**Actions:** remove the empty FEEDBACK.md, delete the first (finished) package
directory — plus the now-empty `.gtd/` if it was the last — and commit
`gtd: package done`.

**Prompt:** proceed. _(Next: `.gtd` still has packages → Building; `.gtd` gone →
Clean.)_

### Clean

**Conditions:** no steering files, clean tree, and either non-gtd HEAD (review
freshly committed work) or HEAD `gtd: package done` with `.gtd` gone (review the
finished feature).

**Actions:** determine the base commit for the review — the **more recent
ancestor of HEAD** of these two candidates:

- the last commit that deleted REVIEW.md (`gtd: done`, or the first `gtd:
  grilling` after an accepted review), on **any** branch;
- the merge-base with the default branch (a proper ancestor on a feature
  branch).

The deletion wins whenever it post-dates the merge-base, so a completed branch
review advances the base past `gtd: done` instead of re-reviewing the whole
branch. If neither candidate exists, the base is the root.

**Prompt:** create REVIEW.md for the changes since the base commit. _(not
auto-advance; agent writes REVIEW.md → Await Review.)_

### Await Review

**Conditions:** REVIEW.md present and **uncommitted**.

**Actions:** commit REVIEW.md `gtd: awaiting review`.

**Prompt:** tell the user to review the changes using REVIEW.md. _(not
auto-advance — human turn.)_

### Accept Review (auto-advance)

**Conditions:** REVIEW.md present and **committed**, with pending changes (the
human edited code, added comments, or annotated REVIEW.md).

**Actions:** (all left uncommitted — no commit of its own)

- seed TODO.md with the changeset (REVIEW.md annotations, code comments, change
  suggestions)
- discard the human's code edits (`git checkout` — back to the reviewed baseline)
- remove REVIEW.md

**Prompt:** none — auto-advance. _(Next: REVIEW.md gone + TODO.md present →
Grilling, which commits the lot as the first `gtd: grilling` and synthesizes the
plan. Removing REVIEW.md is what stops Accept Review re-firing — no commit
needed.)_

### Done

**Conditions:** REVIEW.md present and **committed**, clean tree (the human ran
`gtd` without making changes = approval).

**Actions:** remove REVIEW.md, commit `gtd: done`.

**Prompt:** none. _(Approval is the absence of changes — `gtd` cannot
distinguish "approved" from "not yet looked at", so a premature run closes the
review.)_

### Idle

**Conditions:** no steering files, clean tree, HEAD `gtd: done`.

**Actions:** none.

**Prompt:** nothing to do. _(Prevents a finished review from spawning a spurious
empty re-review.)_
