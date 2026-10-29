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
  `check`, `uncheck`, `install`, `summary`, `base`, `door`, `doors`, `strays`,
  `history list`, `history show`, `history metrics`, `history judges`,
  `history fetch`, `version`, `help`, `ui`, `lsp`, `judge`, `judge answer`,
  `judge run`), option and argument in [CLI reference](docs/cli.md), the
  `gtd doors --json` and `gtd history list --json` arrays (bare arrays with no
  `schema`), and `gtd history show --json`, `gtd history metrics --json`,
  `gtd history judges --json` and its `--jsonl` lines (no `schema`; not driver
  documents).
- **The error envelope and stream discipline** — `{ "state": "error", … }` on
  stderr with `--json`, stdout byte-empty on failure (`gtd ui` excepted). See
  [Error envelope](docs/cli.md#error-envelope).
- **Entrypoint exports** — every subpath of the one package, each export's name,
  type and behaviour, step functions' options included (`keep` among them, and
  the `kept()` and `mark()` helpers, which feature-detect an older engine rather
  than bumping `FLOWS_PROTOCOL`; see [Entrypoints](README.md#entrypoints)):
  - `@pmelab/gtd/flows`, including its `FLOWS_PROTOCOL` number
  - `@pmelab/gtd/wire`
  - `@pmelab/gtd/steering`
  - `@pmelab/gtd/workflow-kit`
  - `@pmelab/gtd/testkit`: `testRepo`, `runsItsScript` and `InMemRepo`, with
    their types and the `TestkitWorld` type
  - `@pmelab/gtd/testkit/gherkin`: its `TestkitWorld` and the wording of every
    step it registers (see [Testing a workflow](docs/testing.md#steps)), with
    its optional peers `vitest` and `quickpickle`
- **The `gtd.config.ts` shape** — every exported function and workflow factory
  (or call of one) is a workflow, and the reserved exports (`defaults`,
  `envDefaults`, `doors`, `skills`, `access`, `config`, …) keep their meaning.
  See [Shape](docs/configuration.md#shape).
- **The `config` export** — the keys `defineConfig` accepts (`modes`, `ui`,
  `skills`, `access`) and their values. See
  [The `config` export](docs/configuration.md#the-config-export).
- **Settings** — the `GTD_*` variables gtd itself reads (not `GTD_FLAG_*`, nor a
  `GTD_<NAME>` override of a workflow's setting), how a `flag_<name>` setting a
  workflow declares is pinned from `GTD_FLAG_<NAME>`, and the judge providers
  (`fixed`, `jev`, `llm`) with their variables and the user-level `judge.json`.

## No promise

Anything not listed above, e.g.:

- **Feature flags** — the `GTD_FLAG_*` variables; any feature flag may appear,
  flip or vanish in any release (see
  [Feature flags](docs/configuration.md#feature-flags)).
- **Prompts** — the text of `gtd install`.
- **Plain output** — `gtd next` without `--json`, help layout, every message,
  narration and remediation line. See
  [Plain output is not a parsing surface](docs/cli.md#plain-output-is-not-a-parsing-surface).
- **UI** — `gtd ui`, the Claude Code mod, and the example drivers in
  [Driver protocol](docs/driver.md).
- **LSP features** — everything `gtd lsp` offers an editor.

## Not gtd's to promise

**Workflows.** gtd ships none. A workflow's names, step names, the order its
steps are reached in, its settings, doors, prompts and steering files are not
gtd's public API: they belong to whichever repository the workflow comes from —
[gtd-workflows](https://github.com/pmelab/gtd-workflows) for `default`. gtd's
promise ends at the engine that replays them.

## Non-goals

- No CalVer, no return to `0.x`, no zero-padded versions.
- The package version never stands in for a format version: a stable surface is
  checked by its own number.
