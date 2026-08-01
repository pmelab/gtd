# Upgrading to v3 (BREAKING CHANGE)

## v3 is a clean break

v3 ("the pattern machine") deletes the entire v2 definition model — gates, guard
functions, actor kinds, interrupt/fallback ladders, capture rules, turn and
routing rules, `Gtd-Counters` trailers, conflicts, the review checkout window —
and replaces it with the much smaller pattern machine described in
[STATES.md](../STATES.md): named states, each with one content kind and an
ordered map of change-patterns to next states.

**All pre-v3 history is unrecognized and resolves to the initial state, by
design — v1 and v2 subjects alike.** v3's `resolveState`
(`src/PatternMachine.ts`) only recognizes its own `gtd(<actor>): <from> → <to>`
subject (or the bare `gtd(<actor>): <to>`) naming a state and an actor the
active workflow currently declares; everything else — a v1 `gtd: grilling`, a v2
`gtd(agent): building`, a plain `chore: …` commit, anything from a foreign repo
— parses as unrecognized and lands at the workflow's initial state (`idle` in
the unified template). There is no special-casing for "this looks like an old
gtd commit": the mechanism is exactly the same one that already made v1 history
inert to v2, and v2 history inert to a differently-configured workflow — v3 just
applies it uniformly to all prior history instead of drawing a v1/v2 line.

**Finish or squash any in-flight cycle first.** A repo mid-cycle on v1 or v2 has
no v3-shaped commit backing its steering files; upgrading mid-cycle lands cold
at the initial state with those files still pending, which the new workflow's
`on` patterns will classify as ordinary pending changes, not as the phase they
used to represent. Finish the cycle (or squash it) on the old binary first, or
manually clean up the steering files and commit a plain boundary, before
upgrading.

## What died

- **Counters.** `Gtd-Counters` trailers, `fixAttemptCap`/`reviewThreshold`
  config keys, and the counter-stamp machinery are gone. The only budget
  affordance left is a state's own `retry: { max, otherwise }`
  (§[STATES.md](../STATES.md#7-retry)) — a plain per-process entry cap
  redirected at write time, with no trailer to read back.
- **`.gtdrc` keys.** The old `testCommand`, `fixAttemptCap`, `reviewThreshold`,
  `agenticReview`, `squash`, `learning`, `decisionLog`, and `models` keys are
  all gone — `workflow:` and `vars:` are the only two blessed keys (see
  [Configuration](configuration.md)). A check's command now lives inline in its
  own `script:` content, reading a workflow-declared `it.vars` entry (the
  unified template's `testCommand`, overridable via the top-level `vars:` key or
  a `GTD_TESTCOMMAND` environment variable — see
  [Configuration's "Variables"](configuration.md#variables)) rather than a
  blessed `testCommand` config key; squashing is a `commit:` state instead of a
  boolean flag; there is no learning phase, no decision log, and no model
  tiering — a workflow author is free to build any of that shape back with
  states of their own, but gtd no longer bakes it in.
- **The review checkout window.** v2 rewound HEAD/index to the review base while
  a human review rested, so editors would show the diff directly. Dropped in the
  v3.0 rewrite, then RE-INTRODUCED as the explicit state property it was always
  meant to become: a state declaring `reviewWindow: true` opens the window while
  the machine rests there (base = the process start, or a state marked
  `reviewBase: true`). The unified template enables it on `await-review`. Unlike
  v2's hardwired gate, it is pure workflow DATA and the engine stays oblivious —
  see [STATES.md §11](../STATES.md) and the `file:`/`mode:` neighbours in
  [configuration.md](configuration.md).
- **`forceApprove`, content-inspection verdicts.** FEEDBACK.md emptiness,
  checkbox-only REVIEW.md diffs, and doc-structure validation are gone as ENGINE
  mechanisms — verdicts are now expressed purely by which file a turn writes or
  deletes, matched by an ordinary `on` pattern. The unified template's own
  checkbox-review verdict (`review-deciding`) is ordinary WORKFLOW data (an `on`
  pattern), not an engine hook: `D REVIEW.md` = approve, `M REVIEW.md` = route
  to the deterministic decider, in the unified template. Deterministic
  format-checking of the steering files is likewise no longer a pair of
  in-machine `check`/`script` states — the old `todo-validating`/
  `review-validating` states and their `.gtd/FORMAT.md` steering file are gone,
  replaced by the `gtd validate` command plus producing-agent self-validation
  (see
  [docs/design/steering-file-validation-command.md](design/steering-file-validation-command.md)
  and [STATES.md §12](../STATES.md)).
- **`gtd review <target>`.** Gone in the initial v3 rewrite, then RETURNED in
  this version with different, narrower semantics: it no longer inspects an
  arbitrary target the way v2 did — it starts a brand NEW review process at a
  workflow-declared `reviewEntry: true` state, reviewing `<target>..HEAD` (e.g.
  a colleague's PR branch with no gtd process of its own) by writing one empty
  entry commit with a `Gtd-Review-Base:` trailer and reusing the workflow's
  existing review/feedback machinery unmodified — see
  [STATES.md §11](../STATES.md#11-the-review-checkout-window) and
  [CLI reference](cli.md#gtd-review-commitish---json). The current command
  surface is `init` / `step` / `next` / `status` / `validate` / `review` /
  `lsp`.

- **`gtd mermaid` → `gtd visualize`.** The static Mermaid emitter has been
  replaced by `gtd visualize`, which serves an interactive diagram of the active
  workflow (main flow, sub-machines, per-state details) on a local web server —
  see [CLI reference](cli.md#gtd-visualize---portn---no-open---json). Both are
  read-only views of the active workflow; nothing in the machine changes.

- **`gtd format <file>`, and the bundled prettier with it.** gtd no longer
  formats anything on its own: a steering-file mode declares its own `format:`
  SHELL COMMAND, so a project brings whatever formatter it already uses. Adding
  four lines to `.gtdrc` restores (and improves on) the old auto-formatting for
  the unified template:

  ```yaml
  modes:
    qa:
      format: "npx prettier --write <%= it.file %>"
    review:
      format: "npx prettier --write <%= it.file %>"
  ```

  Validation is unaffected — `qa`/`review` remain gtd's own built-in validators.
  See
  [docs/design/pluggable-steering-modes.md](design/pluggable-steering-modes.md)
  and [Configuration](configuration.md#modes--pluggable-steering-file-modes).

- **Model tiers, the decision log.** No `models` config key, no `Gtd-Decisions`
  trailer scan, no grilling/architecting "prior decisions" context assembled
  from history.
- **LSP.** Deleted at the v3 rewrite, then resurrected file-format-keyed rather
  than state-keyed (`gtd lsp` — see
  [Development](development.md#the-lsp-server)). The `gtd.openSteeringFile`
  command is BACK (see
  [docs/design/state-file-association.md](design/state-file-association.md)) —
  config-driven rather than the v2 hardcoded state→file map: any state may
  declare a `file:` (an Eta template) and a `mode:` (the file's format — the
  built-in `qa`/`review`, or a workflow-declared `modes:` entry, though the LSP
  itself only understands the two built-ins), the LSP reads that same config the
  CLI does to build its path→mode dispatch, and `gtd.openSteeringFile` resolves
  the current state and shows its `file:`. No mapping declared at all (the
  bundled template's predecessor shape, or any workflow with no `file:`/`mode:`)
  falls back to basename dispatch (`TODO.md`/`REVIEW.md`), same as before this
  addition.

## How to adopt

`workflow:` is **optional** — gtd ships the bundled **unified** workflow as its
built-in default, so after upgrading a repo works with **no** config and no init
at all. The default forks on which steering file you create: `.gtd/TODO.md`
starts the **simple flow** (a `planning` ⇄ `plan-review` plan-iteration loop,
direct `building`, a `checking`/`fixing` loop), while `.gtd/REQUIREMENTS.md`
starts the **advanced flow** (two-phase grilling ⇄ grilling-answer /
architecting ⇄ architecting-answer / decompose / picking / per-package build
with an agentic spec-review gate). Both converge on the same `reviewing` →
`await-review` tail, and a full sign-off squashes the whole cycle into one
commit (see [STATES.md §10](../STATES.md#10-the-bundled-workflow-templates)).

`gtd init` is now optional and no longer writes a workflow — it seeds only a
minimal `.gtdrc.json` (a `testCommand` var and a Prettier formatting
suggestion). Run it if you want to tune those; otherwise nothing is required:

```bash
gtd init      # optional — seeds testCommand + a formatting suggestion
```

A repo that customized v2's `workflow:` key (actors, gates, guard vocabulary,
ladders) needs to rewrite it from scratch in the v3 schema — see
[Configuration](configuration.md) for the schema and a complete worked example.
There is no automatic migration: the two vocabularies don't map field-for-field
(guards become patterns, capture rules become `on` targets, counters become
`retry`), so a v2 `workflow:` config is simply invalid v3 config and fails
loudly at load time rather than silently misinterpreting.

**Re-copy the loop skill.** If you vendor `skills/loop/` into a consuming repo
or agent harness, upgrading the `gtd` binary also means re-copying that skill
from this release.

## Unreleased: bundled prompts no longer name `.gtd/`; a new `stateDir` var

The bundled template's agent prompts used to open with a sentence naming `.gtd/`
as the directory the agent must never touch except its own owned file. That
framing broke down once a project repointed a steering-file var (e.g.
`reviewFile`) outside `.gtd/`: the prompt still pointed the agent at a directory
that no longer held the file it was writing. Every prompt's opener now states a
path-agnostic principle instead — "this workflow steers itself through its own
state files — treat them as its private scratchpad, never as project code or
documentation" — and names only the specific file(s) its `vars:` entry owns.

The check scripts also gained a new `vars.stateDir` (default `.gtd`) —
independent of the per-file vars — naming only where they keep their own
scratch/bookkeeping (the `.check-output` temp file, `review-deciding`'s
exclusion of gtd's other state files). Each script now also creates its target
file's own parent directory (`mkdir -p "$(dirname "$feedback")"`, etc.), so a
per-file var repointed outside `stateDir` (or to a nested path with no existing
parent) no longer fails to write.

**Fully backward-compatible: no config change is needed.** Both `stateDir` and
every per-file var keep their existing `.gtd/…` defaults, so an unconfigured
repo renders byte-identical scripts and behavior to before. A repo that already
relocated a steering-file var outside `.gtd/` (working around issue #128 for
`reviewFile`) can keep its override as-is; nothing further to change.

## The var-override env prefix is now `GTD_<UPPERCASE-name>`, not `GTD_VAR_<name>`

The environment-variable layer of `it.vars` (see
[Configuration's "Variables"](configuration.md#variables)) changed its naming
scheme: the exact-case `GTD_VAR_<name>` prefix is gone, replaced by
`GTD_<UPPERCASE-name>` matched case-insensitively against each name already
declared by the workflow's own `vars:` or the top-level `.gtdrc` `vars:` key.
`GTD_VAR_testCommand` becomes `GTD_TESTCOMMAND`; `GTD_VAR_plannerModel` becomes
`GTD_PLANNERMODEL`.

This is also a narrowing, not just a rename: because an uppercased env key can't
round-trip back to an arbitrary camelCase name, the environment can no longer
introduce a var no config layer declared — a `GTD_*` env var matching no
declared name is now silently ignored, where it previously appeared verbatim
under its post-prefix name.

## 7.4: `gtd-loop` is gone — bare `gtd` and `gtd loop` run it directly

`gtd-loop`, the standalone loop-driver binary installed alongside `gtd`, no
longer exists. Its body now lives in `bin/gtd` itself, which is a bash entry
script that dispatches on its first argument:

| behavior                                               | before (≤ 7.3)                                 | from 7.4                                        |
| ------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------- |
| `gtd-loop`                                             | separate installed binary                      | removed                                         |
| bare `gtd` (no subcommand)                             | usage error, prints help, exits 1              | runs the loop driver immediately                |
| `gtd loop`                                             | not a recognized subcommand                    | runs the loop driver immediately                |
| any other subcommand (`step`, `status`, `validate`, …) | handled by `node dist/gtd.bundle.mjs` directly | same, now reached via `bin/gtd`'s hand-off/exec |

**Bare `gtd` is a behavior flip, not merely an addition** — the same kind of
change as the v1 → v2 label grammar below: previously it printed the help text
and exited 1 without touching the repository; from 7.4 it launches the loop
driver immediately, identically to `gtd loop`. A script that relied on bare
`gtd` failing fast (e.g. to detect a missing subcommand) now gets a running loop
instead of an error.

Because `bin/gtd` is a bash script for every invocation now, **running `gtd` at
all — including any subcommand — requires bash**. Before 7.4, only the loop
driver (`gtd-loop`) needed bash; a subcommand could be invoked directly via the
bundle (e.g. `node node_modules/.bin/gtd`) with no bash in between. This is
intentional and accepted, not an oversight: gtd's loop, its `script`-content
checks, and a steering-file mode's own `format:`/`validate:` commands already
run via `bash -c` (see
[Configuration](configuration.md#modes--pluggable-steering-file-modes)) — gtd
already assumes a unix/bash agent environment everywhere else, so the entry
point catching up removes an inconsistency rather than introducing a new
dependency.

**Migration:**

- Anyone invoking `gtd-loop` directly — in scripts, CI, or docs — should invoke
  `gtd` or `gtd loop` instead.
- Anyone relying on `node node_modules/.bin/gtd` resolving straight to the
  bundle should note `gtd` is now a bash script that execs the bundle for
  subcommands, so behavior for actual subcommands (`gtd step`, `gtd status`,
  etc.) is unchanged — only the underlying file changed.

## 7.2: the review checkout window is now per worktree

The review checkout window's two refs moved from the SHARED `refs/gtd/*`
namespace to git's PER-WORKTREE `refs/worktree/*` one:

| before (≤ 7.1)         | from 7.2                        |
| ---------------------- | ------------------------------- |
| `refs/gtd/review-head` | `refs/worktree/gtd/review-head` |
| `refs/gtd/review-base` | `refs/worktree/gtd/review-base` |

Nothing in a `.gtdrc` or a workflow definition references those names, so **no
config change is needed**. What changes is behaviour in a repository checked out
as several linked worktrees (`git worktree add`, one `.git` shared between
them): each worktree now has its own window, so a review resting in one no
longer "closes" from another — which, on the shared refs, mixed-reset that other
worktree's branch onto the reviewing worktree's saved head and left every
sibling refusing with "a process is already underway".

A window an OLDER gtd left open across the upgrade still closes from the legacy
refs, so an in-flight review in a single-worktree repo needs no attention. In a
multi-worktree repo gtd cannot tell which worktree a shared ref belongs to, so
it closes only when HEAD is contained in the saved head and otherwise refuses
with the exact recovery commands — run them in the worktree that owns the
window:

```bash
git reset --mixed refs/gtd/review-head
git update-ref -d refs/gtd/review-head
git update-ref -d refs/gtd/review-base
```

7.2 also adds [`gtd abandon`](cli.md#gtd-abandon---json), the supported way out
of a process that will never be finished (it closes the window, then rewinds
HEAD to the process's start parent, keeping everything the process produced as
uncommitted changes) — no hand-editing of refs required.

## Prior breaking change: the v1 → v2 label grammar (historical)

v2 replaced v1's undifferentiated turn labels with six labels carrying the
branch outcome at capture time, moved steering files under `.gtd/`, and
introduced `Gtd-Counters` commit trailers. All of that is itself now superseded
by v3's clean break above — a v1 or v2 repo upgrades to v3 the same way
(finish/squash any in-flight cycle, then upgrade from a settled boundary);
there's no reason to upgrade v1 → v2 → v3 in two hops.

For maintainers: this repo releases via `semantic-release` reading Conventional
Commits, and needs **no config change** for a major bump — but the release
commit/PR **must carry a `BREAKING CHANGE:` footer** (or a `!` after the type)
for `@semantic-release/commit-analyzer` to compute the next major version rather
than a minor/patch bump.
