# Configuration

gtd reads an optional `.gtdrc` config file via
[cosmiconfig](https://github.com/cosmiconfig/cosmiconfig). With no config, the
bundled default workflow applies (see
[STATES.md](../STATES.md#10-the-bundled-default-workflow)). Supported filenames
(searched in this order):

- `.gtdrc`
- `.gtdrc.json`
- `.gtdrc.yaml`
- `.gtdrc.yml`
- `gtd.config.json`
- `gtd.config.yaml`

## Schema

v3's `.gtdrc` has exactly two blessed top-level keys:

- **`workflow`** (object, optional) — the whole machine definition, compiled by
  `src/PatternConfig.ts`. Absent = the bundled default workflow. See
  ["The `workflow:` key" below](#the-workflow-key) for its schema.
- **`vars`** (object, optional) — a flat `name -> scalar` map, one layer of the
  merged `it.vars` every template sees — see ["Variables"](#variables) below.
- **`$schema`** (string, optional) — stripped before validation, so it never
  counts as an unknown key. Point it at the published schema for editor-backed
  autocompletion. A `schema.json` is generated from `src/ConfigSchema.ts` at
  build time and ships with the package.

Any other top-level key is **rejected** (`onExcessProperty: "error"`) — v3 has
no `testCommand`, `fixAttemptCap`, `reviewThreshold`, `agenticReview`, `squash`,
`learning`, `decisionLog`, or `models` keys; all of that machinery is gone (see
[Upgrading](upgrading.md)). The engine blesses no VARIABLE NAMES either —
`testCommand` (the bundled default workflow's own var, see
["Variables"](#variables)) is workflow-authored data like any other `it.vars`
entry, not a special key gtd interprets.

## The `workflow:` key

The `workflow:` key is the **only** definition source — there is no `extends`,
no merge-over-a-built-in; the bundled default workflow is itself a YAML asset
compiled through the exact same compiler (`src/workflows/default.yaml` →
`compileWorkflowConfig`). Its shape:

```yaml
workflow:
  vars: # optional — the workflow's own declared `it.vars` defaults (see "Variables" below)
    anyKey: anyScalarValue
  states:
    <name>:
      actor: <string> # forbidden on a commit state, required otherwise
      script: <string> # exactly one of script/prompt/message/commit
      prompt: <string>
      message: <string>
      commit: <string>
      on: # a mapping, DECLARATION ORDER PRESERVED
        "<pattern>": <targetState>
      initial: true # exactly one state across the whole workflow
      retry:
        max: <number>
        otherwise: <targetState>
      model: <string> # optional, opaque harness hint — forbidden on a commit state
      file: <string> # optional, an Eta template naming the state's steering file — forbidden on a commit state
      mode: qa | review # optional, requires "file" — forbidden on a commit state
```

See [STATES.md](../STATES.md#1-the-model) for what each field means to the
engine, and [§3](../STATES.md#3-pattern-grammar) for the pattern grammar.

### Content values: inline or a file reference

A `script`/`prompt`/`message`/`commit` value starting with `./` or `../` is a
**file reference** — resolved relative to the config file's own directory and
read at load time. A missing or unreadable file reference is a **load error**,
collected and thrown with every other config problem — never silently treated as
inline text. Any other string (including one that merely contains a `/`, or an
absolute path) is inline Eta template source, used verbatim.

```yaml
workflow:
  states:
    working:
      actor: agent
      prompt: ./prompts/working.md # read from alongside this .gtdrc
      on:
        "* **": done
```

A `vars:` key sibling to `states:` inside `workflow:` declares the workflow's
own defaults for `it.vars` — see ["Variables"](#variables) below for the full
three-layer picture.

### `model:` — the opaque harness hint, template-rendered

A state may declare `model: <string>` — an OPAQUE label (e.g. `smart`, `fast`,
or a concrete model id) gtd never interprets; it is only passed through so the
driving loop can map it onto whatever models its agent harness provides. Unset
means "use the harness's default." Forbidden on a commit state (never at rest,
emits nothing):

```yaml
workflow:
  states:
    working:
      actor: agent
      model: smart
      prompt: do the thing
      on:
        "* **": done
```

Like every content string, `model:` is rendered as an Eta template through the
exact same context as the state's content — a plain string with no Eta tags
(`smart` above) passes through unchanged, but
`model: "<%= it.vars.reviewModel %>"` resolves against the merged `it.vars` (see
["Variables"](#variables)). A render failure behaves exactly like a content
render failure at the same call site: `gtd next`/`gtd status` error out, nothing
committed.

`gtd next --json` and `gtd status --json` include a `"model"` key (the RENDERED
value) only when the resolved state declares one — it is **omitted entirely**,
never emitted as `null`, when unset.

### `file:`/`mode:` — the steering-file association

A state may additionally declare `file:` — an Eta template naming THE steering
file this state is about: the file a human/editor should look at while the
machine rests here (rendered through the same `it.vars`-carrying context as
content/`model`; must render non-empty). Forbidden on a commit state (never at
rest). Multiple states may share one `file:` (and, in the bundled default, do):

```yaml
workflow:
  vars:
    planFile: .gtd/PLAN.md
  states:
    working:
      actor: agent
      file: <%= it.vars.planFile %>
      mode: qa
      prompt: develop the plan
      on:
        "* **": done
```

`mode:` requires a sibling `file:` and names the file's FORMAT, from a closed,
documented vocabulary:

| `mode`   | Format                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `qa`     | The open-questions format (`## Open Questions`, one `###` sub-heading per question, `Suggested default: ...`/`Answer: ...`). |
| `review` | The checkbox review format (`# Review: <hash>` header, `<!-- base: <hash> -->` comment, `##` chunks, `- [ ]` pointers).      |

An unknown `mode` value is a load error naming the allowed values (typos must
not silently disable editor support) — like `model`, the ENGINE never branches
on `mode`; only `gtd lsp` (see
[docs/design/state-file-association.md](design/state-file-association.md))
interprets it, to decide which document symbols/code actions/diagnostics a file
gets.

`gtd next --json`/`gtd status --json` gain `"file"` (the RENDERED path) and
`"mode"` (verbatim) keys, each **omitted entirely** (never `null`) when the
resolved state declares none — exactly like `model`. Plain `gtd status` prints
`File:`/`Mode:` lines (right after `Model:`, when present) when set.

**Known limitation — `on` pattern keys are NOT Eta templates.** A workflow's
`on` patterns keep LITERAL `.gtd/…` paths, so repointing a filename var
(`.gtdrc`'s top-level `vars:`, or a `GTD_VAR_` override) without ALSO overriding
the workflow's `on` patterns desyncs the machine: `file:` (and any template
reading/writing that path) follows the var, but the `on` map that decides what a
change to that path MEANS keeps matching the old literal path. The vars are a
DRY mechanism inside templates and the state↔file association, not a rename
switch. (Making pattern keys var-aware at compile time is possible future work.)

### Template variables

Every `script`/`prompt`/`message`/`commit`/`model` template is rendered as an
Eta template (`it.<name>`) with:

| Variable         | Meaning                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `startCommit`    | The hash the current process started from (before its first turn).                                                                                                                                                                                                                                                                   |
| `currentCommit`  | HEAD's hash at render time.                                                                                                                                                                                                                                                                                                          |
| `previousCommit` | The hash before the last transition (HEAD's parent, in-process).                                                                                                                                                                                                                                                                     |
| `state`          | The state whose content is being rendered.                                                                                                                                                                                                                                                                                           |
| `actor`          | The actor this render is for.                                                                                                                                                                                                                                                                                                        |
| `processDiff`    | `startCommit..HEAD` plus the pending working-tree diff.                                                                                                                                                                                                                                                                              |
| `lastDiff`       | The diff of the last transition alone.                                                                                                                                                                                                                                                                                               |
| `processCost`    | The accumulated token cost of the current process — the sum of every `Gtd-Cost:` trailer recorded by `gtd step <actor> --cost=<n>` across its turn commits, plus the in-flight step's own `--cost` (so a `commit:` squash template sees the whole-process total). A number, `0` when none recorded. See ["Token cost"](#token-cost). |
| `read(path)`     | Reads a working-tree file (pending contents, not HEAD's) by repo-relative path. Throws for a missing/unreadable path — for a `commit:` template, that throw refuses the step (see [STATES.md §8](../STATES.md#8-the-squash-lifecycle)).                                                                                              |
| `vars`           | The merged three-layer variable map, always a flat `Record<string, string>` — see ["Variables"](#variables) below.                                                                                                                                                                                                                   |

### Token cost

A loop driver that knows how many tokens the invocation it just drove cost can
record it with `gtd step <actor> --cost=<n>` (a non-negative number). gtd
appends it to that turn's commit as a `Gtd-Cost: <n>` trailer — a blank line
then the trailer, below the untouched `gtd(<actor>): <state>` subject — so the
per-turn cost is persisted in the git log:

```
gtd(agent): reviewing

Gtd-Cost: 1450
```

`gtd status` shows the process's running total (a `Cost:` line / a `cost` key,
omitted when nothing has been recorded), and `gtd step --json` echoes the number
it recorded (`{ "state": …, "subject": …, "cost": 1450 }`).

Every template sees the running total as `it.processCost` (the table above): the
sum of the current process's turn-commit trailers, plus the in-flight step's own
`--cost`. Its intended use is a `commit:` squash template, which renders against
the pending tree as the process collapses — so the whole feature's total
(including the squashing step itself) lands in the squash message even though
the intermediate per-turn trailers are discarded with the turns they rode on:

```yaml
done:
  commit: |
    feat: ship it

    Total token cost: <%= it.processCost %>
```

`--cost` is accepted only by `gtd step` (a usage error on any other command),
and gtd never interprets the number's unit — tokens, cents, whatever the driver
records — it only sums and reports it.

## Variables

Every template — `script`/`prompt`/`message`/`commit`, and now `model` — sees
`it.vars`: a flat `Record<string, string>` assembled from three layers, **later
wins**:

1. **The workflow's own `vars:` key** (sibling to `states:`, shown above) — the
   workflow author's declared defaults. The bundled default workflow declares
   `vars: { testCommand: "npm test" }`, read by `checking`'s script as
   `<%~ it.vars.testCommand %>` (see
   [STATES.md §10](../STATES.md#10-the-bundled-default-workflow)).
2. **A top-level `.gtdrc` `vars:` key** (a sibling of `workflow:`, NOT nested
   inside it) — per-repo tuning without redefining the whole workflow. Subject
   to the same cwd→home deep merge as everything else in `.gtdrc` (innermost
   wins per-key).
3. **`GTD_VAR_<name>` environment variables** — highest precedence, checked at
   every invocation. The prefix is stripped and the REMAINING CASE matched
   exactly: `GTD_VAR_testCommand` sets `testCommand`, not `TESTCOMMAND` or
   `testcommand`. This is the only layer that may introduce a name neither
   config layer declared.

Values in layers 1–2 must be YAML scalars (string/number/boolean) — coerced to
strings at load time; an object or array value is a load error, collected
alongside every other config-shape finding (see
["Validation and errors"](#validation-and-errors)). Environment values are
already strings.

```yaml
# .gtdrc — overriding the bundled default's testCommand
vars:
  testCommand: npm run test:ci
```

```bash
# highest precedence — beats both the workflow default and the .gtdrc value above
GTD_VAR_testCommand="npm run test -- --bail" gtd run
```

A template reads any of it as `it.vars.<name>`:

```yaml
workflow:
  vars:
    reviewer: alice
  states:
    working:
      actor: agent
      prompt: "Assigned reviewer: <%= it.vars.reviewer %>"
      model: "<%= it.vars.reviewModel %>" # a GTD_VAR_reviewModel override, or a .gtdrc vars: entry
      on:
        "* **": done
```

No variable name is blessed by the engine — `testCommand` is workflow-authored
data like any other `it.vars` entry, not a special key gtd interprets; a custom
workflow is free to declare and read any names it likes.

## Validation and errors

Config-shape problems (unknown keys, wrong types, unreadable file references)
are collected together; if the shape is clean, the assembled definition is
additionally run through the engine's own `validateDefinition` (see
[STATES.md §9](../STATES.md#9-validation)). A bad config throws **one** error
listing every finding, at load time — before anything touches the repository —
never partially, and never deferred to step time:

```
workflow config:
  - state "idle": must declare exactly one of script/prompt/message/commit (found 2)
  - state "idle": "on" target "nowhere" is not a defined state
```

`validateDefinition`'s findings include the **semantic graph checks**: every
`on` target and `retry.otherwise` must name a defined state, and every state
must be **reachable** from the initial state by walking `on` targets and
`retry.otherwise` redirects — an unreachable state (typically a typo'd rename or
a leftover) is a load error like any other, since a workflow is bound to a
project and edited as a project-wide change.

Many of these problems never reach gtd at all if your editor validates against
the published schema: `schema.json` fully types the `workflow:` key (state
shape, content kinds, `on`/`retry` structure, the `mode` vocabulary), so a
yaml-language-server-style editor flags unknown keys and wrong types as you
type. The rules JSON Schema cannot express — exactly one content kind, exactly
one `initial: true`, targets naming defined states, reachability — remain the
compiler's job at load time.

Other load failures:

- **Parse errors** (malformed YAML/JSON) — message includes the offending
  filename.
- **Non-object top-level** — a YAML list or `null` at the root is rejected with
  the filename in the message.
- **Unknown top-level key** — anything besides `workflow`/`vars`/`$schema` emits
  `Invalid gtd config: <field>: <reason>`.
- **A bad top-level `vars:` entry** — an object/array value fails the same way
  as a bad workflow-level `vars:` entry (see ["Variables"](#variables)), one
  aggregated error:
  `gtd config:\n  - "vars.<name>" must be a string, number, or boolean, got <type>`.

All of these exit **1** and write to **stderr**, never stdout.

## Lookup and precedence

gtd walks from the current working directory **up to your home directory** (or
to the filesystem root when cwd is outside home), collecting every `.gtdrc` it
finds along the way. All found levels are **deep-merged**, with the **innermost
(cwd) config winning** on conflicts — so a shared `.gtdrc` in a worktree-parent
directory cascades to every checkout beneath it, while any individual checkout
can still override with its own `.gtdrc`.

## Auto-init

On every **state command** (`step`, `next`, `run`, `status`) that has passed the
repo-root guard, if the cwd→root walk finds **no** config anywhere, gtd creates
and commits a starter `.gtdrc.json` at the repository root containing only a
`$schema` link. Auto-init never runs for `--version`/`--help`, `format`,
bare/unknown commands, or an invocation refused by the repo-root guard — those
perform no repository mutation of any kind. On a repo with no commits yet, or
whose HEAD isn't a `gtd(actor): state` commit, the stub is committed as its own
`chore: add .gtdrc.json`. If HEAD is already a `gtd(actor): state` commit
(mid-process), the stub is instead **amended into HEAD** — stacking a fresh
boundary commit there would produce an unrecognized HEAD that resolves back to
the workflow's initial state.

## A complete example

A three-state note-taking machine: draft, revise-or-accept, and a squashed
commit — one prompt/message pair reading a workflow-declared `it.vars` entry:

```yaml
# .gtdrc.yaml
workflow:
  vars:
    reviewer: alice
  states:
    idle:
      actor: human
      initial: true
      message: |
        No active note. Write NOTE.md with what you want written up, then run
        `gtd step human`.
      on:
        "* **": drafting

    drafting:
      actor: agent
      prompt: |
        Read NOTE.md and draft a short write-up in DRAFT.md.
        Reviewer of record: <%= it.vars.reviewer %>.
        Leave DRAFT.md uncommitted and finish your turn.
      on:
        "* **": revising

    revising:
      actor: human
      message: |
        DRAFT.md holds the draft. Edit it for another round, or run
        `gtd step human` with no edits to accept it and write the commit
        message.
      on:
        "C": working
        "* **": drafting

    working:
      actor: agent
      prompt: |
        The draft is accepted. Write COMMIT_MSG.md with one conventional-
        commits message for the whole cycle, then finish your turn.
      on:
        "A COMMIT_MSG.md": done
        "M COMMIT_MSG.md": done

    done:
      commit: '<%~ it.read("COMMIT_MSG.md") %>'
```

A clean `gtd step human` at `revising` (the `C` event) accepts the draft and
moves to `working`; any other pending change loops back to `drafting`. Writing
`COMMIT_MSG.md` at `working` enters `done`, which squashes every commit since
`idle` into one, using `COMMIT_MSG.md`'s content as the message, and discards
the file.

## Recipe: a per-task builder loop without a script state

A `picking`-style queue arbiter (see
[docs/examples/advanced-workflow.md](examples/advanced-workflow.md)) is a
`script` state that turns a task-queue glob into a diff patterns can see. A
driver that can't run scripts can get the same per-task loop out of pure
prompt/`on` declarations instead, at the cost of trusting the agent to honor a
marker protocol rather than a deterministic `ls`: see
[docs/design/work-packages.md §3](design/work-packages.md) ("Option B —
agent-encoded verdict") for the worked example.

## A fuller example: two-phase planning, task decomposition, agent-prepared review

The bundled default above is deliberately small. For a heavier machine — Q&A
planning loops, an architecture phase, task decomposition, the deterministic
per-task `picking` arbiter, and agent-prepared `.gtd/REVIEW.md` review — see
[docs/examples/advanced-workflow.md](examples/advanced-workflow.md), a
copy-paste-ready `.gtdrc` recipe.
