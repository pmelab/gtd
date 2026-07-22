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

### Template variables

Every `script`/`prompt`/`message`/`commit`/`model` template is rendered as an
Eta template (`it.<name>`) with:

| Variable         | Meaning                                                                                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startCommit`    | The hash the current process started from (before its first turn).                                                                                                                                                                      |
| `currentCommit`  | HEAD's hash at render time.                                                                                                                                                                                                             |
| `previousCommit` | The hash before the last transition (HEAD's parent, in-process).                                                                                                                                                                        |
| `state`          | The state whose content is being rendered.                                                                                                                                                                                              |
| `actor`          | The actor this render is for.                                                                                                                                                                                                           |
| `processDiff`    | `startCommit..HEAD` plus the pending working-tree diff.                                                                                                                                                                                 |
| `lastDiff`       | The diff of the last transition alone.                                                                                                                                                                                                  |
| `read(path)`     | Reads a working-tree file (pending contents, not HEAD's) by repo-relative path. Throws for a missing/unreadable path — for a `commit:` template, that throw refuses the step (see [STATES.md §8](../STATES.md#8-the-squash-lifecycle)). |
| `vars`           | The merged three-layer variable map, always a flat `Record<string, string>` — see ["Variables"](#variables) below.                                                                                                                      |

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
