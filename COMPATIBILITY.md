# Compatibility

gtd follows SemVer and cuts majors often. A major on its own says little, so
every user-facing surface sits in one of three tiers, and the tier decides what
counts as breaking.

| Tier                       | Breaking means                                                 |
| -------------------------- | -------------------------------------------------------------- |
| **Stable**                 | any change that bumps its own version (exit codes: any change) |
| **Follows package SemVer** | an incompatible change, shipped as a major                     |
| **No promise**             | nothing — it may change in any release, patch included         |

## Stable

These are read by programs you do not upgrade together with gtd: drivers, and
histories written by an older or newer gtd.

- **Exit codes** — the set in [Exit codes](docs/cli.md#exit-codes). No version;
  the set is frozen, and adding, removing or re-meaning a code is a major
  release.
- **Driver documents** — every JSON document carrying a top-level `schema`, in
  [Schema](docs/cli.md#schema). Versioned by that integer, bumped only when a
  field is removed or renamed. No read-back: gtd writes only the current
  `schema`, and a driver refuses one it does not read.
- **History format** — what replay reads back out of git, in
  [History format](docs/configuration.md#history-format). The retained
  `refs/gtd/history/<entry>` refs are part of it. Versioned by the `Gtd-Format`
  trailer on every commit gtd writes, bumped when an encoding replay reads
  changes incompatibly. Read-back covers the current format and, after a bump,
  at least the one before it; an unreadable format is refused with exit `1`. A
  new trailer is additive and does not bump `Gtd-Format` when an older gtd skips
  it as unknown and a newer gtd treats it as absent on older commits.
  `Gtd-Config:` is one: it only feeds a warning, never a step. `Gtd-Kept:` is
  another: only a step with the `keep` option writes it, and an older gtd
  refuses that workflow at load through its unknown-option check, so nothing is
  read wrongly. `Gtd-Approved:` is a third: only a `human` step with the
  `approve` option writes it, and an older gtd refuses that workflow at load the
  same way. `Gtd-Mark:` is a fourth: additive, no `Gtd-Format` bump, written
  only by a workflow that calls `mark()`, and replay never reads it. Replay
  reads the kept object it names to answer `kept()`, which lives under
  `refs/gtd/kept/<entry>/<step>/<hash>` in the clone that landed it: a kept ref
  is local and its object is part of what replay needs there.

## Follows package SemVer

- **CLI** — every command (`next`, `land`, `abandon`, `restore`, `validate`,
  `check`, `uncheck`, `install`, `summary`, `base`, `door`, `doors`, `slices`,
  `strays`, `history list`, `history show`, `history metrics`, `history fetch`,
  `version`, `help`, `ui`, `lsp`, `loop`, `context-hook`, `judge`,
  `judge answer`, `judge run`), option and argument in
  [CLI reference](docs/cli.md), the doors the bundled `fix`, `review`, `rollout`
  and `cleanup` build (`fix`, `review [base]`, `rollout <flag>`,
  `cleanup <flag>`), and the `gtd doors --json` and `gtd history list --json`
  arrays (bare arrays with no `schema`), and `gtd history show --json` and
  `gtd history metrics --json` (no `schema`; not driver documents).
- **The error envelope and stream discipline** — `{ "state": "error", … }` on
  stderr with `--json`, stdout byte-empty on failure (`gtd ui` excepted). See
  [Error envelope](docs/cli.md#error-envelope).
- **Entrypoint exports** — every subpath of the one package, each export's name,
  type and behaviour, step functions' options included (`keep` among them, and
  the `kept()`, `mark()` and `slice()` helpers, which feature-detect an older
  engine rather than bumping `FLOWS_PROTOCOL`; see
  [Entrypoints](README.md#entrypoints)):
  - `@pmelab/gtd/flows`, including its `FLOWS_PROTOCOL` number
  - `@pmelab/gtd/wire`
  - `@pmelab/gtd/steering`
  - `@pmelab/gtd/workflow-kit`
  - `@pmelab/gtd/workflows`, also resolvable as `@pmelab/gtd/workflow` (see
    [Reusing the shipped workflows](docs/configuration.md#reusing-the-shipped-workflows))
  - `@pmelab/gtd/workflows/feature`, `@pmelab/gtd/workflows/review`,
    `@pmelab/gtd/workflows/fix`, `@pmelab/gtd/workflows/rollout`,
    `@pmelab/gtd/workflows/cleanup`
  - `@pmelab/gtd/testkit`'s `testRepo`, `runsItsScript` and `InMemRepo`, with
    the `TestRepo` and `TestkitWorld` types and its optional peers `vitest` and
    `quickpickle`
- **The `gtd.config.ts` shape** — every exported function and workflow factory
  (or call of one) is a workflow, the shipped factories' options are the
  settings below, and the reserved exports (`defaults`, `envDefaults`, `doors`,
  `skills`, `access`, `config`, …) keep their meaning. See
  [Shape](docs/configuration.md#shape).
- **The `config` export** — the keys `defineConfig` accepts (`modes`, `ui`,
  `skills`, `access`) and their values. See
  [The `config` export](docs/configuration.md#the-config-export).
- **Bundled workflow and step names** — `feature`, `fix`, `review`, `rollout`,
  `cleanup`, and each step's full name, plus which steps a bundled workflow
  reaches and in what order: changing either strands every process resting on
  it. Adding `approve` to an existing step strands every process that already
  passed it.
- **The review hand-off** — what `review` leaves for `fix`: `.gtd/REVIEW.md`
  with the human's notes beside the reviewer's own `.gtd/REVIEW.orig.md`, read
  as review notes (see [Steering formats](src/steering/FORMATS.md)).
- **Settings** — the setting names the bundled workflows read (`testCommand`,
  `reviewBase`, …), the `GTD_*` variables (not `GTD_FLAG_*`, nor the `flag_*`
  settings that pin them), and the judge providers (`fixed`, `jev`, `llm`) with
  their variables and the user-level `judge.json`.

## No promise

Anything not listed above, e.g.:

- **Feature flags** — the `GTD_FLAG_*` variables; any feature flag may appear,
  flip or vanish in any release (see
  [Feature flags](docs/configuration.md#feature-flags)).
- **Prompts** — the text of every `prompt` beat and of `gtd install`.
- **Plain output** — `gtd next` without `--json`, help layout, every message,
  narration and remediation line. See
  [Plain output is not a parsing surface](docs/cli.md#plain-output-is-not-a-parsing-surface).
- **Workflow internals** — lens briefs, judge questions and thresholds, the
  skills a prompt names. (Lens names are step names, so they follow SemVer.)
- **UI** — `gtd ui`, the Claude Code mod, and the example drivers in
  [Driver protocol](docs/driver.md).
- **LSP features** — everything `gtd lsp` offers an editor.
- **testkit's engine seams** — every other `@pmelab/gtd/testkit` export: the git
  contract suites, the fake git and workspace operations and the capturing CLI
  io gtd's own tests run on.

## Non-goals

- No CalVer, no return to `0.x`, no zero-padded versions.
- The package version never stands in for a format version: a stable surface is
  checked by its own number.
