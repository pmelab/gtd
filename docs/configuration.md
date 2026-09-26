# Configuration reference

gtd reads two kinds of configuration, both optional:

- **`gtd.config.ts`** — the workflow itself: a TypeScript module that says which
  steps a process goes through. Without one, gtd runs its bundled default
  workflow, so every command works with no configuration at all.
- **`.gtdrc`** — per-repository tuning of whatever workflow is active: variable
  overrides (`vars`), steering-file modes (`modes`), and `gtd ui` settings
  (`ui`). Nothing else.

> **Trust: `gtd.config.ts` is code, and gtd runs it.** Because the workflow is a
> TypeScript module, every gtd command that resolves workflow state evaluates
> the repository's `gtd.config.ts` — including the read-only ones: `gtd next`,
> `gtd lsp`, `gtd validate`, `gtd judge`, not only `gtd land`. The lookup walks
> up from the current directory, so a `gtd.config.ts` in a parent directory
> counts too. Treat a repository's `gtd.config.ts` like any other code you run
> from it — a Makefile, a `package.json` script: **do not run gtd in a checkout
> you do not trust.** `.gtdrc` values end up on command lines too (`vars:`
> entries like `testCommand` are interpolated into the scripts gtd emits), which
> is the same trust decision.

## `gtd.config.ts`

### Lookup

gtd walks from the current directory **up to your home directory** (or to the
filesystem root when the current directory is outside home) and uses the
**innermost** `gtd.config.ts` it finds. There is no merging: one file is the
whole workflow, and a `gtd.config.ts` found nowhere means the bundled default. A
`.gtdrc` in the same directory still contributes `vars`, `modes` and `ui`.

`gtd init` never writes a `gtd.config.ts` — write one only to change the
workflow itself.

### Shape

The module default-exports one `workflow(...)` call from `@pmelab/gtd/flows`:

```ts
import { agent, human, run, workflow } from "@pmelab/gtd/flows"

export default workflow(
  {
    default: async () => {
      await human("idle", {
        message: "Sketch the change in .gtd/TODO.md.",
        file: ".gtd/TODO.md",
      })
      await agent(
        "plan",
        "Read the sketch in history and write .gtd/PLAN.md.",
        {
          file: ".gtd/PLAN.md",
        },
      )
      await run(
        "check",
        "npm test > .gtd/FEEDBACK.md 2>&1 && rm -f .gtd/FEEDBACK.md",
      )
    },
  },
  { vars: { testCommand: "npm test" } },
)
```

The first argument maps **entry names** to **flows**. A flow is an `async`
function that awaits steps. `default` is required: it is where a process starts
when nothing else is asked for, and its first step is where a finished process
waits (the bundled workflow calls it `idle`). The second argument is optional:
`vars` (the workflow's own variable defaults, see [Variables](#variables)) and
`summary` (the prompt `gtd summary` prints, see [Summary](#summary)).

gtd resolves `@pmelab/gtd/flows` itself, so a `gtd.config.ts` needs no
`package.json` or install. Add `@pmelab/gtd` as a dev dependency only if you
want editor type-checking for it.

### Steps

A step is one position a process can rest at. Each step function takes a
**literal string name** first, and resolves once that step's turn has landed.

| Step                                      | Actor   | What the rest asks for                                                                                                                   |
| ----------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `agent(name, prompt, opts?)`              | `agent` | An agent turn. `prompt` is printed as the beat's content; the driver hands it to an agent and lands whatever the agent left in the tree. |
| `human(name, opts?)`                      | `human` | A person. The process waits until someone edits and lands. `opts.message` is what gtd shows.                                             |
| `run(name, body, opts?)`                  | `check` | A script. `body` is a POSIX `sh` string the driver runs verbatim, or a callback (below).                                                 |
| `judge(name, questions, evidence, opts?)` | `judge` | A judgment. A `message` rest carrying typed questions; `gtd judge answer` records the verdict. See [Judges](#judges).                    |
| `restart(name)`                           | —       | Ends the episode from any depth (see [Episodes](#episodes-replay-and-divergence)). Never rests.                                          |

A `run` body written as a callback receives `{ sh, fs }`: `sh(command)` runs a
shell command and resolves to `{ ok, code, output }`; `fs.read`, `fs.write`,
`fs.rm` and `fs.exists` work on repository paths. The beat for such a step is a
one-line script that runs `gtd exec`, which runs the callback in the repository
root. A callback that throws makes `gtd exec` exit 1 — the tree it leaves still
lands like any other run. Either way, **the outcome of a run is what it leaves
in the tree**: flow code reads it back through the helpers, never through a
return value.

The step name is the `<to>` in the commit subject the landing writes,
`gtd(<actor>): <from> → <to>`, and every step landing carries a
`Gtd-Step: <name>#<n>` trailer (`<n>` counts how often that name was reached in
the episode). Other trailers a landing may carry: `Gtd-Judge:` (one per answered
judge question), `Gtd-Payload:` (the judge's evidence was cut to fit its
budget), `Gtd-Var:` (an `--entry --var` value), `Gtd-Cost:` (a
`gtd land --cost`), and `Gtd-Review-Base:` (an entry's fixed diff base).

### Step options

Every step takes an options object; all keys are optional.

| Option            | Steps                  | Meaning                                                                                                                                            |
| ----------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label`           | all                    | Display name shown by `gtd next` and viewers.                                                                                                      |
| `file`            | all                    | The step's steering file, a repository path under `.gtd/`.                                                                                         |
| `mode`            | all, requires `file`   | The steering file's mode: `qa`, `review`, or a name declared under `.gtdrc` `modes:`. An unknown name is a load error.                             |
| `message`         | `human`, `judge`       | The text shown to the person at this rest.                                                                                                         |
| `model`           | `agent`                | An opaque model hint passed through to the driver.                                                                                                 |
| `system`          | `agent`                | A system prompt passed through to the driver — a full replacement for the harness's own, not an addition.                                          |
| `skills`          | `agent`                | Skill names prepended to the prompt through the `skillsPreamble` var. Blank means no preamble.                                                     |
| `allowEmpty`      | `agent`                | An agent turn that changes nothing completes the step. Without it, such a turn is an **attempt** (see [Landing rules](#landing-rules)).            |
| `acceptClean`     | `human`                | A landing that changes nothing completes the gate — "accept as-is". Without it, a clean landing is a no-op and the gate keeps waiting for an edit. |
| `requireProgress` | all, needs `file`      | Refuse a turn whose only change deletes `file`.                                                                                                    |
| `answerGate`      | all, needs `qa` `file` | Refuse a turn that edits anything while a question in `file` is still unanswered. A turn that changes nothing is accepted.                         |
| `requireRevert`   | all, needs `file`      | Refuse a turn that did not revert the human's review-round edit.                                                                                   |
| `reviewBase`      | all                    | The commit that enters this step becomes the review window's diff base (`gtd base`, `refs.reviewBase`).                                            |
| `minP`            | `judge`                | The probability an answer must reach to count. An answer below it reads as `undefined`.                                                            |

### Branching: helpers read the tree the last step left

Flow code decides what happens next with ordinary `if`/`while`/`for` over pure
helpers. Every helper reads **the commit replay stands on** — the tree the last
landed step left — never the live working tree:

- `exists(path)`, `read(path)` (`undefined` when absent), `glob(pattern)` (`*`
  stays inside one path segment, `**` crosses them)
- `changed(glob?)`, `added(glob?)`, `modified(glob?)`, `deleted(glob?)` — paths
  the last step's commit touched, optionally filtered by a glob
- `sections(pathOrText)` — the top-level `## ` headings of a markdown file (or
  of literal text when no such path exists)
- `tail(pathOrText, share)` — the end of a file, cut on a line boundary and
  bounded to `share` (a fraction, `0 < share <= 1`) of the `judgeBudgetBytes`
  var. All `tail` calls between two steps share one budget; asking for more than
  the whole of it fails the step
- `history.previous(path, { since: step })` — `path` as the previous completion
  of `step` left it, `undefined` before a second completion
- `vars` — the merged variables (see [Variables](#variables))
- `refs` — commit hashes a prompt can name for an agent to inspect itself:
  `refs.start` (the process's diff base), `refs.head` (the commit the process
  rests on), `refs.reviewBase` (the review window's base), `refs.processBase`
  (the parent of the process's first commit)

```ts
await agent("build", "Implement .gtd/PLAN.md.")
while (true) {
  await run(
    "check",
    `${vars.testCommand} > .gtd/FEEDBACK.md 2>&1 && rm -f .gtd/FEEDBACK.md`,
  )
  if (!exists(".gtd/FEEDBACK.md")) break
  await agent("fix", "Fix what .gtd/FEEDBACK.md reports, then delete it.", {
    file: ".gtd/FEEDBACK.md",
  })
}
```

### Composition

- `scope(prefix, fn)` — prefixes every step name reached inside `fn` with
  `prefix.`, so `scope("build", () => agent("fix", …))` is the step `build.fix`.
  Scopes nest. The prefix is also the step's **memory scope**: agent steps in
  one scope share one agent conversation (a driver resumes it through
  `gtd next --json`'s `session`), and every agent step in one scope must run
  with the same `model` and `system` — a mismatch fails the process, since one
  scope is one conversation. Steps with no prefix share the `root` scope.
- `persona({ model, system }, fn)` — every agent step inside `fn` gets this
  `model`/`system` unless it sets its own.
- `refuse(message)` — refuse the pending landing: nothing lands, `gtd land`
  exits 1 with `message`, and the process stays where it rests. Use it when a
  turn left something none of the flow's branches explains.
- `stepName(name)` — the full name `name` gets where it is called, with every
  enclosing scope applied (useful in a script that greps commit subjects).

Plain TypeScript functions that await steps compose like any other code — this
is how the reusable fragments below are written.

### Fragments

`@pmelab/gtd/flows` also exports the building blocks the bundled workflow is
made of. Each takes its texts, caps and callbacks as arguments and never reads
`vars` itself. The step names a fragment declares are part of gtd's versioned
API: a fragment never renames them outside a major release, because a rename
strands every process resting on the old name.

| Fragment                          | Steps it declares                                                                                                                              | Resolves to                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `green(name, check)`              | `name`                                                                                                                                         | `true` unless the run wrote `.gtd/FEEDBACK.md` |
| `healthy({ texts, fix, cap, … })` | `health.check`, `health.judge`, plus `escalation`'s                                                                                            | once the suite is green                        |
| `escalation(texts)`               | `health.escalate`, `health.describe`, `health.stop`, `health.exhausted`                                                                        | once a person has handled the escalation       |
| `entryGate(texts)`                | `check`, `blocked`                                                                                                                             | once the suite is green                        |
| `questionGate(texts)`             | `gate.check`, `gate.answer`                                                                                                                    | `true` when a person answered open questions   |
| `designLoop(name, author, gate)`  | `name`, plus `questionGate`'s                                                                                                                  | once no open question is left                  |
| `specReview(texts)`               | `spec.pre`, `spec.scoping`, `spec.review`                                                                                                      | `true` when the package is approved            |
| `packageQueue(texts, options)`    | `picking`, `item.building`, `item.fix-suite`, `item.fix-spec`, `item.closing`, …                                                               | once `.gtd/packages/` is drained               |
| `qualityLap(texts)`               | `quality.seeding`, `quality.picking`, `quality.reviewing`                                                                                      | `"clean"` or `"findings"`                      |
| `reviewTail(texts)`               | `review.reviewing`, `review.await-review`, `review.deciding`, `review.review-missing`, `review.triage`, `review.triaging`, `review.collecting` | `"signoff"` or `"feedback"`                    |
| `noMatch(name, expected)`         | —                                                                                                                                              | refuses the landing, naming what was expected  |

Call a fragment inside `scope()` to place it: the bundled workflow's
`scope("build", …)` around `healthy` is what makes `build.health.check`.

### Judges

`judge(name, question, evidence, opts)` asks one question and resolves to its
recorded answer (a string) or `undefined`.
`judge(name, [q1, q2], evidence, opts)` asks several and resolves to
`{ [id]: { answer, p } }` holding every answer that cleared `opts.minP`. A
question is `{ id, primitive, instructions, criteria }`, where `primitive` is
`noul` (yes/no, read back as `"yes"`/`"no"`), `choice`, or `score` (read back as
its decimal string). `evidence` is any JSON value the judge sees as its `state`
— build it from `read`/`tail`/`sections`, never from anything the working tree
holds uncommitted.

gtd never calls a model. The rest is a `message` whose `gtd next --json` `judge`
field carries the questions; `gtd judge answer` records a verdict as
`Gtd-Judge:` trailers (see [the CLI reference](./cli.md#commands)). Landing with
no verdict resolves every answer to `undefined`, so write the flow so that
`undefined` takes the conservative branch.

### Landing rules

What a `gtd land` does depends on the step and on whether the tree changed:

- **Agent, tree changed** — the step completes; the commit carries the
  `Gtd-Step:` trailer.
- **Agent, nothing changed** — an **attempt**: gtd records an empty commit
  `gtd(agent): <step>` and the process stays at the step. Dispatching again
  after an attempt is a **stall** (`kind: "stalled"`), which clears only when
  something changes. Set `allowEmpty: true` on a step where "nothing to change"
  is a legitimate outcome.
- **Human, nothing changed** — a no-op (nothing lands), unless the step sets
  `acceptClean: true`, in which case the clean landing completes the gate.
- **Run, nothing changed** — the step completes. If replaying that landing
  brings the flow straight back to the same step, the landing is a **settled**
  no-op (`gtd land --json`'s `settled: true`): there is nothing more a driver
  can do by running it again.
- **The flow calls `refuse(message)`** while replaying the pending turn — the
  landing is refused, `gtd land` exits 1, and nothing lands.
- **A guard option says no** (`requireProgress`, `answerGate`, `requireRevert`)
  — refused the same way.

### Entries

Every key other than `default` in the entries object is an **entry** a person
starts with `gtd --entry <name>`; `default` itself cannot be entered by name. An
entry is a flow, or `{ flow, base }`, where `base(vars)` returns a commitish
that fixes the new process's diff base (`refs.start`):

```ts
export default workflow({
  default: mainFlow,
  "review-only": {
    flow: reviewFlow,
    base: (vars) => vars.reviewBase ?? "",
  },
})
```

```bash
gtd --entry review-only --var reviewBase=main
```

`--var <name>=<value>` is repeatable and only valid with `--entry`; the name
must already be declared by the workflow's `vars` or a `.gtdrc` `vars:`. The
values are recorded as `Gtd-Var:` trailers on the process's first commit and
stay in force for the whole process.

The bundled workflow declares three entries: `fix-precheck` (repair a red
baseline through the build tail), `review-gate.check` (a pure review of
everything since `--var reviewBase=<commitish>`), and `start-gate.check` (skip
the unwind and start at the baseline check).

### Episodes, replay and divergence

gtd keeps **no state outside git**. To find where a process rests, it
**replays** the flow over the current **episode**: the first-parent commits
since the episode began, each answering the step it names, until a step has no
commit left — that step is the rest. Replaying the same history always reaches
the same rest, which is why flow code has to be pure (below).

An episode ends when its flow returns or calls `restart()`. The next episode
starts over at the `default` entry's first step — for the bundled workflow,
`idle`.

**There is no migration.** A process's commits are only meaningful to the
workflow that made them. If you change `gtd.config.ts` (or upgrade gtd, and the
bundled workflow changed) while a process is underway and its history no longer
replays to the steps its commits name, gtd refuses loudly with a **divergence**
error and tells you to run `gtd abandon`. Finish or abandon an in-flight process
before changing the workflow under it.

### Rules for flow code

Flow code is re-run on every gtd command, replaying the process's history, so it
must reach the same steps every time it sees the same history. A `run()` body
and code at the module's top level are exempt — they may do anything.

- **No IO or nondeterminism**: no clock, randomness, environment, network or
  filesystem access in flow code. Read the tree through the helpers; do IO
  inside a `run()` body. gtd cannot see this mistake up front: a flow that
  branches on something other than history shows up later as a divergence.
- **Await only steps**: a flow may `await` a step, `scope()`, `persona()`, or a
  function that itself awaits steps. Awaiting anything else fails the replay:
  `the flow awaited something that is not a step`.
- **Unique names**: one step name per call site; call a shared helper from two
  places inside two different `scope()`s. Two call sites sharing a name read as
  the same step to replay.
- **No try/catch around a step**: `restart()` and a refused step travel as
  exceptions, and a catch would swallow them.
- **Known options only**: a step option gtd does not accept — a typo, or the
  retired `memory` — fails the replay naming the step and the key, since
  `gtd.config.ts` is evaluated without a type check.
- **Shape**: the default export must be a `workflow(...)` call, and the
  `default` entry must reach a step — that step is where a finished process
  waits. A default entry that reaches none fails the load.

### Summary

`workflow(entries, { summary })` sets the prompt `gtd summary` prints: a
function receiving
`{ entryCommit, processBase, processTip, humanCommits, processCost, processCostByModel, vars }`
and returning a string. `humanCommits` lists every human-authored commit of the
process as `{ hash, state }`. Without `summary`, `gtd summary` refuses.

Authoring a workflow with a coding agent? `skills/authoring/SKILL.md` is the
agent-facing guide.

## `.gtdrc`

gtd reads an optional `.gtdrc`, discovered on the same walk as `gtd.config.ts` —
from the current directory up to your home directory — but **merged**: every
level found is deep-merged, the innermost winning on overlap. A shared `.gtdrc`
in a worktree-parent directory cascades to every checkout beneath it, and any
checkout can still override it with its own.

Supported filenames (searched in this order):

- `.gtdrc`
- `.gtdrc.json`
- `.gtdrc.yaml`
- `.gtdrc.yml`
- `gtd.config.json`
- `gtd.config.yaml`

### Schema

`.gtdrc` has exactly these top-level keys:

- **`vars`** (object, optional) — a flat `name -> scalar` map, one layer of the
  merged variables (see [Variables](#variables)).
- **`modes`** (object, optional) — steering-file modes (`format:`/`validate:`
  shell commands) a step's `mode` may name, layered over gtd's built-in `qa` and
  `review` modes.
- **`ui`** (object, optional) — `gtd ui`'s own settings. See
  [The `ui:` key](#the-ui-key).
- **`$schema`** (string, optional) — ignored by gtd. Point it at the published
  schema for editor autocompletion (this is what `gtd init` writes):

  ```
  https://cdn.jsdelivr.net/npm/@pmelab/gtd/schema.json
  ```

  That URL serves `schema.json` straight out of the published npm tarball, so it
  always matches the latest release. Pin it to a major with
  `@pmelab/gtd@8/schema.json`, or point at your own install
  (`./node_modules/@pmelab/gtd/schema.json`) to work offline.

Any other top-level key is **rejected**. A `workflow:` key in particular is a
load error pointing at `gtd.config.ts` — workflows are no longer read from a
`.gtdrc`.

`gtd init` writes a minimal `.gtdrc.json`: the `$schema` line, the one variable
most projects change (`vars.testCommand`, defaulting to `npm test`), and a
`modes:` block suggesting Prettier as the steering-file formatter
(`npx prettier --write <%= it.file %>` for `qa` and `review` — format only, so
gtd still validates them). Edit or drop any of it, then review and commit the
file before your first `gtd land`. `gtd init` takes no argument and refuses to
overwrite an existing config; it may also run in a plain parent directory (not a
git repository) to seed a shared config a nested repository picks up.

### Modes

A mode is a pair of shell commands over one steering file, both optional:

```yaml
modes:
  adr:
    format: npx prettier --write <%= it.file %>
    validate: adr-lint <%= it.file %>
```

Each command is an Eta template that sees `it.file` (the steering file's path)
and `it.vars` (the merged variables) — nothing else. `format:` normalizes the
file in place; `validate:` reports findings, and exits zero only when there are
none. A step names a mode with `{ file, mode }`.

#### Built-in steering formats are ordinary modes

`qa` and `review` are gtd's two built-in steering-file formats (parsed and
validated in-process, because `gtd lsp` needs the same parsers for live
diagnostics), but their `validate:` is not hidden: every workflow's modes are
seeded with `qa`/`review` entries whose `validate:` is the command
`gtd check <mode> '<file>'`. That seeded command is overridable the same way —
declare `modes: { qa: { validate: "your-own-command" } }` and your command
displaces the seed; declaring only a `format:` for `qa`/`review` composes with
the seeded `validate:` rather than replacing it.

The `qa` format also checks section order: `## Open Questions` must come before
every other `##` section in the file, and `## Answered Questions` must come
after every other `##` section — a file that gets this backwards fails
`gtd check qa` / `gtd validate`. A `###` question heading or a `- [ ]` option
indented 4 or more spaces stops counting as one (it is Markdown indented code,
or a lazy continuation of the line above it) and fails `gtd check qa` /
`gtd validate` naming the exact line; 2 or 3 spaces of indent are still fine.

Both formats also understand **footnotes** — your own comment attached to an
exact spot in the file, for the next agent turn to read as a mandatory note
rather than as an instruction. Mark the spot with `[^name]` (any name, no
whitespace or `]` — the same name may mark more than one spot), then define it
anywhere below — on its own line, at the start of the line — as
`[^name]: explain what you mean here`; a definition's own name must be unique in
the file. Indent a longer comment's continuation lines so they stay part of the
same definition. The next agent turn folds the comment into its own work and
deletes both the marker and the definition — a footnote is never carried forward
or left for a later turn to re-read. `gtd check`/`gtd validate` flag four things
about a footnote: a marker with no matching definition, a definition with no
matching marker, the same name defined twice, and a definition still holding the
literal seeded placeholder text `your comment` unedited — each fails the file
until fixed.

#### The normalization-only contract on `format:`

`gtd land`'s own emitted script never runs a mode's `format:`/`validate:` pair —
it is only the HEAD assertion and the commit. Formatting and validating a
steering file is a driver contract instead: run it explicitly, ahead of
`gtd land`, off `gtd next --json`'s own `validate` field (or `gtd validate`,
which prints the same script). A driver that skips this can land a malformed or
unformatted steering file — `gtd land` itself does not stop it.

A mode's `format:` command may reformat a steering file — whitespace, wrapping,
reordering — but must NEVER change what a landing guard would decide. gtd's
guards (`requireProgress`, `answerGate`, `requireRevert`, and the review-file
checks) decide once, against whichever bytes are on disk at the moment
`gtd land` runs — which may be before OR after a driver's own separate `format:`
run. That is only safe because every built-in guard judges only the content it
explicitly cares about, not incidental formatting around it. If you plug in your
own `format:` command, the same rule binds it: a formatter that also changes
meaning — stripping a paragraph a guard reads — makes the guard's decision and
the file's actual content disagree, and gtd will not catch that for you.

#### A missing binary in `format:`/`validate:` fails loudly, before it runs

The emitted script checks a mode's `format:`/`validate:` command against `$PATH`
before running it, whenever that command is a single unambiguous leading word
(e.g. `adr-lint <%= it.file %>`): a typo'd or uninstalled binary exits 127 with
a `gtd:`-prefixed message naming the mode, the `format`/`validate` key, the
binary, and the resolved `$PATH` it was looked up in, instead of a raw shell
error. A command gtd cannot reduce to one binary — a `VAR=x`-prefixed command, a
pipeline, anything with a shell metacharacter — gets no such check and fails
exactly as it always has.

### The `ui:` key

`gtd ui`'s five settings, all optional — a flat struct, so an unknown sub-key is
rejected the same way any other unknown config key is. `gtd ui` serves exactly
the ONE worktree it is invoked in — there is no roots/discovery setting, because
there is no fleet to discover:

- **`port`** (integer, optional) — with neither this key nor `host` given, the
  port `gtd ui` publishes through `tailscale serve`, walking 8443, then 10000,
  then 443 until one publishes. When `host` (or `--host`) opts out of serve,
  this is the bind port instead — with neither this key nor `--port` given, the
  OS picks a free one. `0` (like `--port 0`) means the same auto-pick as leaving
  it unset entirely.
- **`host`** (string, optional) — opts out of the default `tailscale serve`
  front door and binds this address directly instead, showing it in the printed
  URL — the same effect as `--host`. With neither this key nor `--host` given,
  `gtd ui` publishes through `tailscale serve` and falls back to binding a
  Tailscale interface (a CGNAT `100.64.0.0/10` address, auto-detected) directly
  whenever serve isn't available — it never refuses.
- **`cert`** / **`key`** (strings, optional) — paths to an existing certificate
  and private key, used as-is. `--self-signed` always overrides these with a
  freshly generated throwaway pair, even when both are configured.
- **`format`** (string, optional) — a shell command run after every write
  `gtd ui` makes to the steering file, before the phone's request resolves (an
  Eta template; `it.file` is the written file's absolute path). Absent means no
  command runs at all. gtd ships no formatter — bring your own (`oxfmt`,
  `prettier`, a script). A non-zero exit or a missing binary never reverts the
  write or refuses it — the phone is told which command ran and what it exited
  with, and the bytes it already wrote stay on disk either way.

Flags (`--host`, `--port`, `--self-signed`) always override the matching `ui:`
value; see `docs/cli.md`'s `ui` row for the full flag list.

### Validation and errors

Config problems — an unknown `.gtdrc` key, a wrong type, a `gtd.config.ts` that
fails to evaluate or whose default entry reaches no step — are collected
together. A bad config fails **once**, listing every finding, at load time —
before anything touches the repository — never partially. Each line names the
file it came from and, for `.gtdrc`, the config path:

```
gtd config:
  - /path/to/repo/.gtdrc.json: vars.testCommand: "vars.testCommand" must be a string, number, or boolean, got array
```

A step naming a mode no layer declares fails the same way, as soon as the
process rests at it:

```
gtd config: step "idle": mode "adrs" is not a mode this workflow knows (qa, review)
```

The same problem carried by several `.gtdrc` layers prints one line per file: a
nearer layer overriding the value does not silence the outer layer's line,
because each is a separate edit in a file you own. All load failures exit **1**
and write to **stderr**, never stdout.

gtd requires a repository with **at least one commit** before any state command
(`land`, `--entry`, `next`, `abandon`, `restore`, `validate`, `summary`) will
run — there is no workflow state to derive from an empty history. `gtd init`,
`gtd install`, `gtd lsp`, and `gtd check` are unaffected, since none of them
needs a process history (`gtd lsp` still loads `gtd.config.ts`).

## Variables

Flow code reads `vars` — a flat `Record<string, string>` assembled from four
layers, **later wins**:

1. **The workflow's own `vars`** (`workflow(entries, { vars })`) — the author's
   declared defaults.
2. **A `.gtdrc` `vars:` key** — per-repository tuning without touching the
   workflow.
3. **The current process's entry `--var` overrides**, if it was started with
   `gtd --entry <name> --var <name>=<value>`. Each name must already be declared
   by layer 1 or 2; an undeclared name is a usage error.
4. **`GTD_<UPPERCASE-name>` environment variables** — checked at every
   invocation, case-insensitively against each name already declared by layers
   1–3: `GTD_TESTCOMMAND` overrides `testCommand`. The environment can only
   OVERRIDE a declared name — a `GTD_*` var matching no declared name is
   ignored.

Values in layers 1–2 must be scalars (string/number/boolean), coerced to
strings; an object or array value is a load error. A `--var` value is always a
single-line string as given on the command line. gtd itself blesses no variable
names — `testCommand` is the bundled workflow's data like any other.

```yaml
# .gtdrc — overriding the bundled workflow's testCommand
vars:
  testCommand: npm run test:ci
```

```bash
# highest precedence — beats both the workflow default and the .gtdrc value above
GTD_TESTCOMMAND="npm run test -- --bail" gtd next
```

**`skillsPreamble`** is the one variable gtd itself reads: an Eta template
(seeing `it.skills`, the agent step's own `skills` value, and `it.vars`)
rendered into a preamble PREPENDED to that step's prompt whenever `skills` is
non-blank. Blanking it (`GTD_SKILLSPREAMBLE=""` or
`vars: { skillsPreamble: "" }`) switches the mechanism off repo-wide. A template
you write for it must carry three clauses, or the field is unsafe: load only
what your harness has and skip the rest silently; THE STEP'S OWN FILE FORMAT AND
COMPLETION CONDITION OUTRANK ANYTHING A SKILL SAYS; never turn the turn
interactive, because no one is at a keyboard. The precedence clause is
load-bearing — the preamble sits above the step's own format prose, so a skill
that reflows the steering file changes which branch the flow takes next.

### The bundled workflow's variables

Every value below is an ordinary variable, overridable through `.gtdrc` `vars:`
or `GTD_<NAME>`:

- **`testCommand`** (`npm test`) — the suite every health check and baseline
  gate runs. It is interpolated into a POSIX `sh` script, so keep it
  sh-compatible.
- **`plannerModel`** (`smart`) / **`coderModel`** (`base`) — the `model` hints
  of the planning/reviewing steps and of the building/fixing steps.
- **`*Skills`** — the skill names each agent step loads; see
  [Setup](./setup.md#using-a-different-skill-set).
- **`judgeIdenticalMinP`** (`0.7`) — the confidence an "identical failure"
  verdict at `health.judge` needs before a red streak escalates early. Blank,
  non-numeric or non-finite means it can never be cleared, so the early
  escalation is off.
- **`specPreJudge`** (`0.9`) — `spec.pre`'s floor for skipping a package's
  review turn on a section already judged satisfied. Blank disables the skip.
- **`reviewNoteActionable`** (`0.7`) — `build.review.triage`'s floor for
  treating a review-note chunk as non-actionable (folded into a sign-off) rather
  than spending a `build.review.collecting` turn on it. Blank disables the
  dismissal: every chunk counts as actionable.
- **`architectureSkipMinP`** (`0.85`) — the confidence `architecture-pre`'s "no
  architecture pass needed" answer needs before a plan skips straight to one
  package. Blank means the full architecture pass always runs.
- **`judgeBudgetBytes`** (`32768`) — the total byte budget `tail()` divides
  across one step's inlined judge evidence. Must be a positive integer; blank,
  zero, negative or fractional values fail the step rather than disabling the
  bound.
- **`qualityReviews`** (`owasp-security, code-simplification`) — the quality lap
  `build.quality` runs ahead of the human review, one comma-separated skill per
  turn. Every round pays for it, so extend the list only as far as that is worth
  paying for; blanking it disables the lap. See
  [Setup](./setup.md#extending-the-quality-review-lap).
- **`reviewBase`** (empty) — the commitish `--entry review-gate.check` reviews
  from.

Several more exist only to dedup wording shared by several prompts, and can be
overridden or blanked like any other: `styleBlock` and `styleFormatContract`
(the voice, below), `agentConduct` (tool-use conduct shared by every agent
step), the six role paragraphs `designPersona`, `architectPersona`,
`reviewerPersona`, `specReviewerPersona`, `builderPersona`, `finisherPersona`
plus `escalationPersona` (each step's `system` prompt), `stateFileRules`,
`questionBar`/`questionBarReturn` (how the planners raise and fold in open
questions), `fixFeedbackPrompt` (the shared body of the fix turns),
`footnoteRules`/`footnoteFoldIn`.

#### The voice

gtd ships its own writing voice for the files it generates — the default, not an
opt-in. It is a specialisation of the "Spartan" output style from
[alexgreensh/attention-span](https://github.com/alexgreensh/attention-span)
(AGPL-3.0), written from a reading of that project's version `0.6`: gtd's own
prose stating the same density discipline, rewritten for deliverables (files
that run as long as the work needs) rather than chat replies. No upstream text
ships in gtd's bundle. This is a point-in-time derivation with no refresh
mechanism — it will silently go stale as upstream moves on.

- **`styleBlock`** — the voice itself, injected into every agent step that
  writes a deliverable: the package files, `.gtd/SPEC_FEEDBACK.md`,
  `.gtd/REQUIREMENTS.md`, `.gtd/ARCHITECTURE.md` and `.gtd/REVIEW.md`. Blanking
  it strips the voice from all of them.
- **`styleFormatContract`** — the structural override for machine-read files:
  the format contract (headings, checkbox rows, marker lines) outranks the
  voice, and a violation refuses the turn. Injected right after `styleBlock` at
  the steps whose output a parser reads (`design.triage`, `architecture.author`,
  `build.review.reviewing`, `build.review.collecting`).

Files a script writes carry no injected voice: `.gtd/FEEDBACK.md` (verbatim test
output plus a HEAD stamp), `.gtd/NEXT.md` (a bare path), and
`.gtd/REVIEW_RAW.md`.

### Escalation

A red suite that stays red past three fix turns — or that `health.judge` calls
"identical" to the previous round — escalates instead of retrying forever. The
`health.escalate` script counts escalation rounds from git history:

- **Under 2 rounds** — an agent turn at `health.describe` reads
  `.gtd/FEEDBACK.md`, `.gtd/PRIOR_FEEDBACK.md` when present, and the code the
  earlier attempts touched, then writes `.gtd/ESCALATION.md`: what is failing,
  why the attempts did not resolve it, and concrete approaches to try next. The
  process then waits at the human gate `health.stop`: edit the file or land it
  untouched — either way it becomes the next fix turn's primary instruction.
- **At 2 or more rounds** — no third document is written. The last
  `.gtd/ESCALATION.md` is restored and the process waits at `health.exhausted`,
  naming both that file and `.gtd/FEEDBACK.md`. Editing the document there is
  what gives the next attempt anything new to try; landing it untouched tries
  the same analysis again.

A round is one landed `health.describe` turn since the last green check (the
only thing that deletes `.gtd/ESCALATION.md`); editing the file at the human
gate never spends one. Both gates release straight into the caller's fix step
(`build.fix` or `packages.item.fix-suite`), so the turn that consumes the
document is the very next one. `.gtd/ESCALATION.md` is free-form prose with no
mode of its own.
