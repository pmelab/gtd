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

v3's `.gtdrc` has exactly one blessed top-level key:

- **`workflow`** (object, optional) — the whole machine definition, compiled by
  `src/PatternConfig.ts`. Absent = the bundled default workflow. See
  ["The `workflow:` key" below](#the-workflow-key) for its schema.
- **`$schema`** (string, optional) — stripped before validation, so it never
  counts as an unknown key. Point it at the published schema for editor-backed
  autocompletion. A `schema.json` is generated from `src/ConfigSchema.ts` at
  build time and ships with the package.

Any other top-level key is **rejected** (`onExcessProperty: "error"`) — v3 has
no `testCommand`, `fixAttemptCap`, `reviewThreshold`, `agenticReview`, `squash`,
`learning`, `decisionLog`, or `models` keys; all of that machinery is gone (see
[Upgrading](upgrading.md)). A check's command lives inline in its own `script:`
content — there is no blessed config key for it.

## The `workflow:` key

The `workflow:` key is the **only** definition source — there is no `extends`,
no merge-over-a-built-in; the bundled default workflow is itself a YAML asset
compiled through the exact same compiler (`src/workflows/default.yaml` →
`compileWorkflowConfig`). Its shape:

```yaml
workflow:
  vars: # optional — passed through to templates verbatim as `it.config`
    anyKey: anyValue
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

### `vars:` — the `config` template passthrough

A `vars:` key sibling to `states:` inside `workflow:` is passed through verbatim
(any shape, unvalidated) as the `config` template variable — see the table
below. It's the one place custom, workflow-specific values reach templates; gtd
never inspects it.

### Template variables

Every `script`/`prompt`/`message`/`commit` template is rendered as an Eta
template (`it.<name>`) with:

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
| `config`         | The `vars:` passthrough above (any shape, unvalidated; `undefined` for the bundled default).                                                                                                                                            |

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
- **Unknown top-level key** — anything besides `workflow`/`$schema` emits
  `Invalid gtd config: <field>: <reason>`.

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
commit — one prompt/message pair with a `vars:` passthrough and a `retry` cap
this example doesn't otherwise use:

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
        Reviewer of record: <%= it.config.reviewer %>.
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
