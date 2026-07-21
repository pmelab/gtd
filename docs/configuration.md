# Configuration

gtd reads an optional `.gtdrc` config file via
[cosmiconfig](https://github.com/cosmiconfig/cosmiconfig). With no config, the
built-in defaults apply. Supported filenames (searched in this order):

- `.gtdrc`
- `.gtdrc.json`
- `.gtdrc.yaml`
- `.gtdrc.yml`
- `gtd.config.json`
- `gtd.config.yaml`

## Schema

- **`testCommand`** (string, default `npm run test`) — the command the edge runs
  after a build turn, and on the idle health-check path.
- **`fixAttemptCap`** (non-negative integer, default `3`) — the test-fix budget:
  how many `gtd: test-failed` attempts are allowed per sub-loop before the
  failure is escalated to `.gtd/ERRORS.md` (Escalate). `0` disables the cap
  (escalates immediately on the first red run). Also reused as the health-fix
  budget — no separate config key.
- **`reviewThreshold`** (integer ≥ 1, default `3`) — the review-fix budget: how
  many agentic-review findings rounds are allowed per package before Agentic
  Review force-approves.
- **`agenticReview`** (boolean, default `true`) — kill-switch for the
  per-package Agentic Review gate. Set `false` to force-approve every package
  and proceed directly to human review.
- **`squash`** (boolean, default `true`) — after `gtd: done` (or, once learning
  has run, `gtd: learning-applied`), collapse the cycle's `gtd: *` commits into
  a single conventional-commits commit. Set `false` to keep the granular
  history.
- **`learning`** (boolean, default `true`) — after `gtd: done` (or the
  health-fix path's green re-test), distill durable lessons from the cycle into
  `.gtd/LEARNINGS.md`, have a human review them, then integrate them into the
  project's own docs before the squash decision runs. Set `false` to skip the
  phase entirely — independent of `squash`.
- **`decisionLog`** (boolean, default `true`) — squashing records this cycle's
  resolved open questions as a `## Decisions` section in the squash commit
  message; grilling/architecting inline every past squash commit's section,
  oldest to newest, as prior-decision context. Set `false` to skip both.
- **`models`** — model selection for the subagent-spawning states:
  - `planning` — high-reasoning tier (default `claude-opus-4-8`), used by
    `decompose` (the `grilled`/`planning` states), `grilling`, `architecting`,
    `agentic-review`, and `clean` (the `review`/`squashing`/`learning`/
    `learning-apply` states).
  - `execution` — everyday tier (default `claude-sonnet-4-8`), used by
    `building` and `fixing`.
  - `states.*` — per-state overrides keyed by `decompose`, `grilling`,
    `architecting`, `building`, `fixing`, `agentic-review`, `clean`. Unknown
    `states` keys are **rejected**.
- **`$schema`** (string, optional) — stripped before validation, so it never
  counts as an unknown key. Point it at the published schema for editor-backed
  autocompletion. A `schema.json` is generated from the config schema at build
  time and ships with the package.

## Validation and errors

If a config file fails to load or is invalid, gtd **exits with code 1** and
writes a human-readable error to **stderr** (never stdout):

- **Parse errors** (malformed YAML/JSON) — message includes the offending
  filename.
- **Non-object top-level** — a YAML list or `null` at the root is rejected with
  the filename in the message.
- **Schema violations** — unknown keys or out-of-range values emit
  `Invalid gtd config: <field>: <reason>`.
- **Missing test binary** — if `testCommand` names an executable that cannot be
  found (`ENOENT`), gtd exits 1 with `gtd: test command not found: <command>` on
  stderr. A non-zero test _exit code_ is not an error — it drives the normal red
  path.

## Lookup and precedence

gtd walks from the current working directory **up to your home directory** (or
to the filesystem root when cwd is outside home), collecting every `.gtdrc` it
finds along the way. All found levels are **deep-merged**, with the **innermost
(cwd) config winning** on conflicts — so a shared `.gtdrc` in a worktree-parent
directory cascades to every checkout beneath it, while any individual checkout
can still override settings with its own `.gtdrc`.

## Auto-init

On every **state command** (`step`, `next`, `status`, `review`) that has passed
the repo-root guard, if the cwd→root walk finds **no** config anywhere, gtd
creates and commits a starter `.gtdrc.json` at the repository root containing
only a `$schema` link. Auto-init never runs for `--version`/`--help`, `format`,
bare/unknown commands, or an invocation refused by the repo-root guard — those
perform no repository mutation of any kind. On a repo with no commits yet, or
whose HEAD is a plain (non-`gtd:`) commit, the stub is committed as its own
`chore: add .gtdrc.json`. If HEAD is already a `gtd:`-owned commit
(mid-workflow), the stub is instead **amended into HEAD** — stacking a fresh
boundary commit there would produce an unrecognized HEAD most workflow states
can't resolve past.

## Example

```yaml
# .gtdrc.yaml
testCommand: pnpm test
fixAttemptCap: 3
reviewThreshold: 3
agenticReview: true
squash: true
learning: true
decisionLog: true
models:
  planning: claude-opus-4-8
  execution: claude-sonnet-4-8
  states:
    decompose: claude-opus-4-8
    building: claude-sonnet-4-8
```

## The `workflow:` key — the whole machine from config

The full state-machine configuration can be built up in the config file: the
`workflow:` key carries actors, states (prompts inline or `@`-references to
built-in templates), capture rules, turn and routing rules, interrupt/fallback
ladders, illegal-combination conflicts, entry gates, and agent-turn validation —
every field of the definition the interpreter runs. It is compiled and validated
at config load (`src/WorkflowConfig.ts`); an invalid reference fails the
invocation with a `workflow config:` error before anything touches the
repository. The commit grammar itself derives from the active definition, so
custom actors, gates, and states steer exactly like built-in ones — and subjects
outside the active vocabulary remain inert boundary commits.

- `extends: default` (the default) merges over the built-in machine: a state
  replaces its namesake wholesale, a turn rule replaces its `(actor, gate)` row,
  a routing rule replaces its phase's row, ladders/conflicts/entry replace
  wholesale when present.
- `extends: none` builds a machine from scratch (everything must be declared).

Guards are written in a closed declarative vocabulary — `{fact: <name>}`,
`{not: …}`, `{all: […]}`, `{any: […]}`,
`{counterAtLeast: {counter: testFix|reviewFix|healthFix, limit: <n> | fixAttemptCap | reviewThreshold}}`,
`{headIs: "<subject>"}`, `{lastTurnIs: {actor, gate}}`, `{forceApprove: true}`,
`{reviewable: true}`, `{packagesRemaining: true}`, `{noSteeringFiles: true}`,
`{healthFixBaseAnchored: true}`, `{squashOrLearningEnabled: true}` — and counter
stamps as `{set: {…}, add: {…}}` over the `Gtd-Counters` trailer vector.
Turn/routing-rule branches see the narrow classification flags; ladder rungs see
everything.

A from-scratch example (a two-state note machine):

```yaml
workflow:
  extends: none
  actors:
    - { name: human, kind: interactive }
  entry:
    - { gate: note }
  states:
    idle:
      kind: prompt
      awaits: human
      prompts: { human: "Nothing to note." }
    noting:
      kind: prompt
      awaits: human
      prompts: { human: "Write your note, then run gtd step human." }
      captureRules:
        - { label: note }
  turnRules:
    - actor: human
      gate: note
      branches:
        - to: { rest: { state: noting, actor: human } }
  fallback:
    - when: { noSteeringFiles: true }
      branches:
        - to: { rest: { state: idle, actor: human } }
```

An extends-default example (override one prompt inline, keep everything else):

```yaml
workflow:
  states:
    fixing:
      kind: prompt
      awaits: agent
      prompts:
        agent: "CUSTOM FIX PROTOCOL: <%~ it.context.feedbackContent %>"
      captureRules:
        - { label: fixing, consumeFeedback: true }
```
