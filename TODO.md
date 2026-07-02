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

### Where the squash triggers: a new `squashing` prompt-bearing state

Add a new state `squashing` that fires **after** `gtd: done` lands, before Idle.
It is prompt-bearing (the agent generates the message + performs the squash),
mirroring how Clean delegates REVIEW.md authoring to a subagent.

Flow: `done` (edge-only, commits `gtd: done`) → auto-advance → machine resolves
`squashing` (HEAD is now `gtd: done`, squashable range exists) → emits a prompt
telling the agent to (a) read the inlined full-process diff, (b) generate a
conventional-commits message, (c) run the squash. The agent squashes, then
re-runs; the machine now sees a squashed boundary commit and settles Idle.

Rationale for a prompt-bearing state over an edge action: the message needs an
LLM, and gtd's only LLM channel is the prompt it prints for the external agent.
An edge action cannot generate prose.

### Squash mechanism: soft reset + single commit (no interactive rebase)

The agent (guided by the prompt) does a **non-interactive** squash that is safe
with interleaved non-gtd commits:

1. Compute the **squash base**: the commit just before the first `gtd: *` commit
   of the current process cycle. "Current cycle" = commits after the previous
   `gtd: done` (or the branch merge-base / repo root if none). This is the SAME
   cycle logic already implemented in `Events.ts` for the review base — reuse
   it.
2. **Guard against interleaved non-gtd commits.** Walk the first-parent commits
   from the squash base to HEAD. If EVERY commit in that range has a `gtd: `
   subject, a plain `git reset --soft <base> && git commit` is safe. If any
   non-gtd commit is interleaved (a coworker/upstream commit landed
   mid-process), do NOT soft-reset the whole range (that would fold the foreign
   commit into the squash). Instead skip the squash for this run and report why
   (acceptance criterion: "should not squash those"). Interleaving mid-process
   is rare because gtd is single-writer/linear, but the guard is required by the
   AC.
3. Squash: `git reset --soft <base>` then `git commit -m "<generated message>"`.
   All the `gtd: *` commits collapse into one commit whose tree equals HEAD's
   tree (no code change, pure history rewrite).

The generated commit subject is a real conventional-commits line (e.g.
`feat: add calculator`), NOT a `gtd:` subject — so it reads as a normal boundary
commit and the Idle gate settles cleanly on the next run.

### Files to change

- **`src/Machine.ts`**
  - Add `"squashing"` to the `GtdState` union.
  - Add a new `EdgeAction` only if any pre-squash edge prep is needed — likely
    NOT needed since the squash itself is agent-driven; the machine just routes
    to the prompt-bearing `squashing` state. (The `done` action already commits
    `gtd: done`.)
  - Add a precedence rule: after the review lifecycle, when HEAD is `gtd: done`
    AND a squashable range exists (a `squashBase` is set + range is all-gtd),
    resolve `squashing` (prompt-bearing, `autoAdvance: false` or a STOP — see
    open question) instead of falling through to Idle. The squashable-range
    facts are computed at the edge and passed on `ResolvePayload`, mirroring
    `reviewBase`/`refDiff`/`hasCommitsAfterLastDone`.
  - Extend `ResolvePayload` + `ResolveContext` with `squashBase?: string`, the
    full-process `squashDiff?: string` (for the prompt), and a
    `squashRangeAllGtd: boolean` guard flag.
  - Extend `buildContext` to pass these through.

- **`src/Events.ts`**
  - In `gatherEvents`, compute the squash base and range facts reusing the
    existing cycle detection (`lastDoneIdx`, `currentCycle`, first `gtd:` commit
    of the cycle). Set `squashBase` = parent of the first process commit;
    compute `squashRangeAllGtd` by checking every first-parent subject in
    `<base>..HEAD` starts with `gtd: `; set `squashDiff` =
    `git diff <base> HEAD` (NO workflow-file exclusion — the squash commit
    represents the whole feature, including any code; but steering files like
    TODO.md/REVIEW.md are already deleted by the time we reach `gtd: done`, so
    they won't appear).
  - Gate: only set these when HEAD is `gtd: done` (the squash trigger point).
  - NOTE: the current `done` action already leaves HEAD at `gtd: done`. On the
    auto-advance hop after `done`, `gatherEvents` re-runs and can populate the
    squash facts.

- **`src/State.ts`** — `squashing` is prompt-bearing, so do NOT add it to
  `EDGE_ONLY_STATES`.

- **`src/Prompt.ts`**
  - Add `squashing` to `PromptState` (remove from the `Exclude` list — it is not
    edge-only).
  - Add a `SECTIONS.squashing = squashingMd` entry and a `{{MODEL}}` mapping if
    a subagent authors the message (reuse an existing tier, e.g. `clean` /
    `planning`).
  - Inline the `squashDiff` into the prompt (like Clean inlines `refDiff`), plus
    the `squashBase`, so the agent has the full-process diff to summarize.

- **`src/prompts/squashing.md`** (NEW) — the task prompt:
  - Explain: the process is approved and done; author a single
    conventional-commits message summarizing the inlined full-process diff.
  - Give the exact squash commands (`git reset --soft <squashBase>` then
    `git commit -m "<message>"`), with the base value read from prompt context.
  - Instruct the agent to VERIFY the range is all-gtd (or trust the prompt's
    guard) and to abort + report if a foreign commit is interleaved.
  - Conventional-commits format guidance (type(scope): subject; body optional).
  - Auto-advance tail (re-run gtd → Idle) OR stop tail (see open question).

- **`src/Config.ts`** — add an opt-out/opt-in flag (see open question on
  default). Suggested: `squash: boolean` (mirrors `agenticReview` kill-switch
  pattern — read at the edge in `gatherEvents`, passed as a `ResolvePayload`
  field `squashEnabled`, consumed by the `squashing` precedence rule per the
  AGENTS.md "Config Values vs. Mode Flags" rule: it is a per-resolve guard, not
  a cross-cutting IO mode). Add schema field + default constant +
  `ConfigOperations` field + `toOperations` wiring, mirroring `agenticReview`.

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

- **Happy path**: a full `gtd: new task … gtd: done` history on a branch → run
  gtd → stdout emits the Squashing prompt containing the full-process diff and
  the `git reset --soft <base>` instruction. (The prompt is what we assert; the
  agent action is external, matching how Clean scenarios assert the prompt, not
  the authored REVIEW.md.)
- **Interleaved non-gtd commit**: insert a `feat: coworker` commit between two
  `gtd: *` commits before `gtd: done` → the prompt/guard reports the range is
  not all-gtd and does not offer a full-range squash (assert `squashRangeAllGtd`
  behavior — e.g. stdout does NOT contain the squash instruction, or contains an
  abort note).
- **Squash disabled by config**: `squash: false` in `.gtdrc` → HEAD `gtd: done`
  settles Idle, no Squashing prompt.
- **Already squashed / no gtd range**: HEAD is a plain `feat:` boundary commit
  (already squashed) → Idle, not Squashing (idempotence — running again does not
  re-squash).
- Add a `journeys.feature` extension OR note that the happy-path journey now
  ends with Squashing before Idle (update the existing happy-path scenario's
  expected tail if it asserts Idle immediately after `gtd: done`).

Also add unit-level machine tests in `src/Machine.test.ts` for the new
precedence rule (squashing vs idle) driven by the new payload fields, following
the existing `DEFAULT_PAYLOAD` spread-override pattern.

## Open questions

Should the squash step be a STOP (human confirms the generated message before
the history is rewritten) or auto-advance (squash immediately, then Idle)? The
issue AC says "User is shown the generated message before squash is applied (or
can configure auto-squash)", implying a default STOP with an opt-in auto mode.
STOP is safer for a destructive history rewrite; auto-advance is more in the
spirit of gtd's hands-off loop. Which default?

no, squash immediately and proceed to idle

Should the config flag be opt-in (`squash: false` default — squashing only when
explicitly enabled) or opt-out (`squash: true` default — squash every finished
process unless disabled)? A history rewrite is destructive and surprising by
default, arguing for opt-in; but the feature's whole point is to clean up every
process, arguing for opt-out. Which default?

opt-out

When a non-gtd commit is interleaved mid-process (the AC's "upstream commits
interleaved" case), what is the desired behavior: (a) skip the squash entirely
and settle Idle with a note, (b) squash only the contiguous trailing run of
`gtd:` commits after the last foreign commit, or (c) attempt an
interactive-style `git rebase` that reorders/preserves the foreign commit?
Option (a) is simplest and safest and satisfies "should not squash those"
literally; (b) and (c) are more complex and risk conflicts. Confirm (a) is
acceptable.

squash in-between commits along with the others
