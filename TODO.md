# feat: squash all gtd commits into one after done

Closes #35.

## Problem

A completed gtd process leaves behind many small intermediate `gtd: *` commits
(`gtd: new task`, `gtd: grilling`, `gtd: planning`, `gtd: building`,
`gtd: package done`, `gtd: awaiting review`, `gtd: done`, …). Once the review is
approved, this churn pollutes the branch history. We want the finished feature
collapsed into a single conventional-commits commit.

## Key architectural constraints (from codebase exploration)

These shape the whole design and are non-negotiable:

1. **`src/` makes no LLM calls.** All git/fs IO lives at the edge
   (`src/Events.ts` `perform`); the pure machine (`src/Machine.ts` `resolve`)
   only decides. A conventional-commits message that "summarizes the work" must
   be authored by the **external coding agent** that runs the loop — i.e. in a
   **prompt-bearing state**, exactly like Clean authors REVIEW.md. It cannot be
   an edge action that calls an LLM.
2. **State is folded from first-parent linear history** (`Machine.ts` module
   doc). A squash is a history rewrite. It must land as the very last thing in a
   process and must not break the counter folds or the review re-trigger gate on
   subsequent runs.
3. **`done` is edge-only + auto-advance** (`State.ts` / `Prompt.ts`
   `EDGE_ONLY_STATES`), settling to Idle. The squash must happen **after** the
   `gtd: done` commit exists, so `done` stays the trigger point but the squash
   is a distinct step.
4. **The re-trigger gate keys on `gtd: done`** (`Events.ts` `lastDoneIdx` /
   `hasCommitsAfterLastDone`, and `Machine.ts` `isBoundary` treats `gtd: done`
   as a boundary). If we rewrite the `gtd: done` commit away, that gate and the
   Clean/Idle settle behavior change. The squashed commit's subject is a
   non-`gtd:` conventional-commits message, which `isBoundary` already treats as
   a boundary — so Idle still settles correctly (see design below).

## Design

### Where the squash triggers: a new `squashing` prompt-bearing state (auto-advance)

Add a new state `squashing` that fires **after** `gtd: done` lands, before Idle.
It is prompt-bearing (the agent generates the message + performs the squash),
mirroring how Clean delegates REVIEW.md authoring to a subagent. There is **no
STOP / human confirmation gate** — the agent generates the message and squashes
immediately, then settles Idle (see Resolved Q1).

Flow: `done` (edge-only, commits `gtd: done`) → auto-advance → machine resolves
`squashing` (HEAD is now `gtd: done`, squashable range exists, `squash` enabled)
→ emits a prompt telling the agent to (a) read the inlined full-process diff,
(b) generate a conventional-commits message, (c) run the squash **without
stopping**. The agent squashes, then re-runs; the machine now sees a squashed
boundary commit and settles Idle.

Rationale for a prompt-bearing state over an edge action: the message needs an
LLM, and gtd's only LLM channel is the prompt it prints for the external agent.
An edge action cannot generate prose. Because it is prompt-bearing but
non-stopping, the `squashing` prompt carries an **auto-advance tail** (re-run
gtd immediately after the squash), NOT a STOP tail.

### Squash mechanism: soft reset + single commit (no interactive rebase, no guard)

The agent (guided by the prompt) does a **non-interactive** squash of the whole
range — including any interleaved non-gtd commits (see Resolved Q3):

1. Compute the **squash base**: the parent of the first persisting `gtd:` commit
   of the current process cycle. The first `gtd: new task` commit is a
   commit-then-revert (`captureAndRevert` in `Events.ts`) and does NOT persist,
   so the first persisting cycle commit is `gtd: grilling`. That is exactly the
   Rule-1 review base already computed in `Events.ts` (parent of the first
   `gtd: grilling` in the current cycle). **Reuse the existing cycle detection**
   — the squash base is the parent of that commit.
2. Squash the ENTIRE range: `git reset --soft <base>` then
   `git commit -m "<generated message>"`. All commits in `<base>..HEAD` —
   `gtd: *` commits and any interleaved non-gtd commits alike — collapse into
   one commit whose tree equals HEAD's tree (no code change, pure history
   rewrite). **No all-gtd guard, no range-walk** — the simplification the user
   confirmed.

The generated commit subject is a real conventional-commits line (e.g.
`feat: add calculator`), NOT a `gtd:` subject — so it reads as a normal boundary
commit and the Idle gate settles cleanly on the next run.

### Why the re-trigger gate closes after the squash

The squash rewrites the `gtd: done` commit away (it is inside `<base>..HEAD`).
After the squash, HEAD is a single non-`gtd:` boundary commit and there is no
`gtd: done` in the cycle, so `lastDoneIdx` reverts to the previous cycle. But
the squashed commit sits at (or below) the review base, so
`hasCommitsAfterLastDone` + `reviewBase`/`refDiff` yield an empty reviewable
diff and the machine settles **Idle**, not Clean. Running gtd again does not
re-squash (the range is a single boundary commit — nothing to collapse):
idempotent (covered by the "already squashed" scenario).

### Files to change

- **`src/Machine.ts`**
  - Add `"squashing"` to the `GtdState` union.
  - No new `EdgeAction`: the squash is agent-driven (the agent runs
    `git reset --soft` + `git commit`); the machine just routes to the
    prompt-bearing `squashing` state. The `done` action already commits
    `gtd: done`.
  - Add a precedence rule: after the review lifecycle, when HEAD is `gtd: done`
    AND `squashEnabled` AND a `squashBase` is set, resolve `squashing`
    (prompt-bearing, `autoAdvance: true` — auto-advance, no STOP, per Resolved
    Q1) instead of falling through to Idle. The squash facts are computed at the
    edge and passed on `ResolvePayload`, mirroring
    `reviewBase`/`refDiff`/`hasCommitsAfterLastDone`.
  - Extend `ResolvePayload` + `ResolveContext` with `squashBase?: string`, the
    full-process `squashDiff?: string` (for the prompt), and
    `squashEnabled: boolean`. No `squashRangeAllGtd` flag — the
    interleaved-commit guard is dropped (Resolved Q3).
  - Extend `buildContext` to pass these through.
  - `isBoundary` already treats the resulting non-`gtd:` `feat:` subject as a
    boundary (`Machine.ts` `isBoundary`:
    `!subject.startsWith("gtd: ") || subject === "gtd: done"`), so Idle settles
    on the next run with no change to the boundary logic.

- **`src/Events.ts`**
  - In `gatherEvents`, compute `squashBase` reusing the existing cycle detection
    (`lastDoneIdx`, `currentCycle`, first `gtd: grilling` of the cycle — the
    Rule-1 review base). `squashBase` = parent hash of that first persisting
    cycle commit (its `EMPTY_TREE` fallback when it is the root, mirroring the
    review-base handling). Set `squashDiff` = `git diff <squashBase> HEAD` (NO
    workflow-file exclusion — the squash commit represents the whole feature;
    steering files like TODO.md/REVIEW.md are already deleted by `gtd: done`, so
    they don't appear). No range-walk / all-gtd check.
  - Gate: only set `squashBase`/`squashDiff` when HEAD is `gtd: done` (the
    squash trigger point) AND `squashEnabled`.
  - Read `squash` from `ConfigService` here and pass `squashEnabled` on the
    payload (per AGENTS.md "Config Values vs. Mode Flags": a per-resolve guard,
    not a cross-cutting IO mode → payload field, not a Context tag).
  - NOTE: the `done` action already leaves HEAD at `gtd: done`. On the
    auto-advance hop after `done`, `gatherEvents` re-runs and populates the
    squash facts.

- **`src/State.ts`** — `squashing` is prompt-bearing, so do NOT add it to
  `EDGE_ONLY_STATES`.

- **`src/Prompt.ts`**
  - Add `squashing` to `PromptState` (remove from the `Exclude` list — it is not
    edge-only).
  - Add a `SECTIONS.squashing = squashingMd` entry and a `MODEL_STATE.squashing`
    mapping to the **`planning` tier** (Opus) — reuse `clean`'s mapping
    (`"clean"`/`"decompose"` both resolve to the planning tier). Message
    generation from a diff mirrors Clean authoring REVIEW.md, so it wants the
    strongest tier (see Resolved Q4).
  - Inline the `squashDiff` into the prompt (like Clean inlines `refDiff`), plus
    the `squashBase`, so the agent has the full-process diff to summarize.

- **`src/prompts/squashing.md`** (NEW) — the task prompt:
  - Explain: the process is approved and done; author a single
    conventional-commits message summarizing the inlined full-process diff.
  - Give the exact squash commands (`git reset --soft <squashBase>` then
    `git commit -m "<message>"`), with the base value read from prompt context.
    The agent runs these itself — gtd's `src/` never runs the commit (matches
    how `clean.md` instructs the agent to run `gtd format` and re-run gtd; see
    Resolved Q5).
  - Squash the ENTIRE `<squashBase>..HEAD` range unconditionally (no guard, no
    abort-on-foreign-commit). Interleaved non-gtd commits are folded in too
    (Resolved Q3).
  - Conventional-commits format guidance (type(scope): subject; body optional).
  - **Auto-advance tail**: re-run gtd immediately after committing → machine
    sees the boundary commit and settles Idle. No STOP tail (Resolved Q1).

- **`src/Config.ts`** — add `squash: boolean`, **default `true` (opt-out)** per
  Resolved Q2. Mirror `agenticReview` exactly:
  - Schema field: `squash: Schema.optional(Schema.Boolean)` (next to
    `agenticReview`).
  - Default constant: `const DEFAULT_SQUASH = true`.
  - `ConfigOperations` field: `readonly squash: boolean`.
  - `toOperations` wiring: `squash: decoded.squash ?? DEFAULT_SQUASH`.
  - Read at the edge in `gatherEvents` and passed as
    `ResolvePayload.squashEnabled` (a per-resolve guard, not a Context-tag
    layer).

- **`STATES.md`** — add a `### Squashing` section (conditions: HEAD `gtd: done`,
  squashable all-gtd range present, `squash` enabled; actions: agent generates
  message + squashes; next: Idle). Update the precedence list (§ Precedence) and
  the states table.

- **`README.md`** — add Squashing to the 16-states table (it becomes 17), the
  precedence ladder / mermaid diagram, the "typical feature" walkthrough, and
  the Configuration section for the new flag. (Per user global rule: every
  significant change reflected in README.)

- **`tests/integration/features/squashing.feature`** (NEW) — cucumber scenarios
  (see below).

### Test scenarios (cucumber)

Reuse the composable `Given` steps (`a commit {string}`,
`a commit {string} that adds {string} with:`,
`the working tree is committed as {string}`). New scenarios in
`squashing.feature`:

- **Happy path**: a full `gtd: grilling … gtd: done` history on a branch → run
  gtd → stdout emits the Squashing prompt containing the full-process diff and
  the `git reset --soft <base>` instruction, with the auto-advance tail. (The
  prompt is what we assert; the agent action is external, matching how Clean
  scenarios assert the prompt, not the authored REVIEW.md.)
- **Interleaved non-gtd commit**: insert a `feat: coworker` commit between two
  `gtd: *` commits before `gtd: done` → the Squashing prompt still fires and its
  `git reset --soft <base>` range spans the coworker commit too (assert
  `squashBase` = parent of the first `gtd: grilling`, i.e. the coworker commit
  is INSIDE the range and gets folded in — Resolved Q3). No abort, no guard.
- **Squash disabled by config**: `squash: false` in `.gtdrc` → HEAD `gtd: done`
  settles Idle, no Squashing prompt.
- **Already squashed / no gtd range**: HEAD is a plain `feat:` boundary commit
  (already squashed) → Idle, not Squashing (idempotence — running again does not
  re-squash; `squashBase` unset because there is no `gtd: done` at HEAD).
- Add a `journeys.feature` extension OR note that the happy-path journey now
  ends with Squashing before Idle (update the existing happy-path scenario's
  expected tail if it asserts Idle immediately after `gtd: done`).

Also add unit-level machine tests in `src/Machine.test.ts` for the new
precedence rule (squashing vs idle) driven by the new payload fields, following
the existing `DEFAULT_PAYLOAD` spread-override pattern.

no open questions — run gtd to plan

## Resolved

**Q1 — STOP vs auto-advance for the squash step.** Should the squash be a STOP
(human confirms the generated message before the history is rewritten) or
auto-advance (squash immediately, then Idle)? **Answer:** Auto-advance. Squash
immediately and proceed to Idle — no human gate. The `squashing` prompt carries
an auto-advance tail (re-run gtd right after committing), not a STOP tail.

**Q2 — Config default: opt-in vs opt-out.** Should `squash` default to `false`
(opt-in) or `true` (opt-out)? **Answer:** Opt-out. `squash: true` by default.
Every finished gtd process is squashed unless the user sets `squash: false` in
`.gtdrc`.

**Q3 — Interleaved non-gtd commits.** When a non-gtd commit lands mid-process,
skip / partial-squash / rebase-preserve? **Answer:** Squash the in-between
commits along with the others. No guard, no skip, no `squashRangeAllGtd` flag —
just `git reset --soft <base> && git commit` over the ENTIRE `<base>..HEAD`
range, folding any interleaved commits into the one squashed commit.

**Q4 — Model tier for the squashing prompt (resolved by codebase exploration).**
Which model tier authors the squash message? **Answer:** The `planning` tier
(Opus), reusing `clean`'s `MODEL_STATE` mapping. Message generation from a
full-process diff mirrors Clean authoring REVIEW.md, which uses the planning
tier. `building`/`fixing` use the execution tier (Sonnet); Squashing wants the
stronger planning tier.

**Q5 — Commit taxonomy: does Squashing add a `gtd: squashing` prefix? (resolved
by codebase exploration).** **Answer:** No new entry. The `squashing` state is
prompt-bearing and produces a real conventional-commits commit (`feat: …`), NOT
a `gtd:` commit. The commit prefix → state map in `Events.ts` is unchanged. The
squash message is generated by the agent and the agent runs
`git reset --soft <base> && git commit` itself (gtd's `src/` never runs the
commit) — the same handoff pattern `clean.md` uses (agent runs `gtd format`,
then re-runs gtd). `isBoundary` in `Machine.ts` already treats the resulting
non-`gtd:` subject as a boundary, so Idle settles with no change to boundary
logic.

**Q6 — Squash base vs review base (resolved by codebase exploration).** Is the
squash base a new computation? **Answer:** No. `gtd: new task` is a
commit-then-revert (`captureAndRevert`) and does not persist, so the first
persisting cycle commit is `gtd: grilling`. The squash base = parent of that
commit = the Rule-1 review base already computed in `gatherEvents`. Reuse the
existing cycle detection; no separate first-commit scan needed.
