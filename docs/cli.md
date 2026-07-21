# CLI reference

```
Usage: gtd [command] [options]

Commands:
  step <actor>     Advance the workflow as the named actor (to fixpoint);
                   the default workflow declares "human" and "agent"
  next             Print the prompt for whichever actor is awaited (no mutation)
  status           Predict the next commit and state from the working tree (no mutation)
  review <target>  Anchor an ad-hoc human review against a git ref or branch
  questions        List open questions from the active grilling/architecting doc
  changesets       List changesets/files from the active review doc
  format <file>    Format a markdown file in place

Options:
  --json           Output structured JSON instead of plain text
  --version, -v    Print version and exit
  --help, -h       Print this help and exit
```

`--version` (`-v`) and `--help` (`-h`) short-circuit before any git or
repository-state work — they run outside a repo and in any repo state. Bare
`gtd` (no subcommand) is a usage error: it prints the help text and exits 1
without touching the repository. Every other command must be run from the
**repository root** — gtd derives steering files, diffs, and pathspecs relative
to cwd, so it refuses with a clear error if invoked from a subdirectory.

`--json` is the only long option. Any other `--` option (including a typo like
`--jsn`) is rejected with a usage error rather than silently ignored, so a
mistyped flag can never degrade a JSON caller to plain-text mode.

One nuance to "(no mutation)": `next` and `status` never author commits or
change workflow state, but while a human review is pending they do maintain the
review checkout window (closing it to read state, re-arming it on the way out —
see [Human review gate](workflow.md#human-review-gate)), which transiently moves
HEAD and the index. The working tree is never touched.

## `gtd step human` / `gtd step agent`

Both drive the **same fixpoint loop** — gather → resolve → perform the returned
edge action → repeat — differing only in which actor's turn they are allowed to
capture:

- **`gtd step human`** captures the **human** turn at whichever gate is awaiting
  one.
- **`gtd step agent`** captures the **agent** turn.

**Fixpoint advance.** A single invocation may author several commits: it authors
the awaited actor's turn commit, then keeps performing any further mid-chain
routing (a test run, a routing commit, a package close, …) until it reaches a
rest where a prompt would be shown, or a fixpoint where nothing changed.
`gtd step human`/`gtd step agent` never print a prompt themselves — that's
`gtd next`'s job.

**Idempotence.** Re-running the same command again once the tree is settled at a
rest authors **zero** new commits. It exits 0 while the rest still awaits that
command's actor (an inert empty agent turn, the idle health check); once the
rest awaits the _other_ actor, the re-run is an out-of-turn refusal — still zero
commits, but non-zero exit.

**Out-of-turn refusal.** Turns are strictly separated per actor: the wrong
mutator always errors, at every state, on clean and dirty trees alike.
`gtd step agent` while a human turn is awaited refuses with
`"<state> awaits a human turn — run \`gtd step human\`"`; `gtd step
human`while an agent turn is awaited refuses with`"<state> awaits an agent turn
— run \`gtd step
agent\`"`— exit non-zero, zero commits either way. Human edits made while the agent is awaited (e.g. amendment notes in`.gtd/`package files after the`gtd:
building` commit lands) stay pending in the working tree and ride along as input
to the agent's next captured turn; left unamended, the build proceeds.

**Red-test fixpoints exit 0.** A red test run below the fix-attempt cap (or the
health-fix cap) still writes its findings and commits — it is a normal,
successful step of the loop, not a failure of the `gtd step <actor>` invocation,
which only exits non-zero for a genuine refusal or an operational error (bad
config, missing test binary, corrupted state).

**Output.** Plain mode prints one `committed: <subject>` line per commit this
invocation authored (oldest→newest), then a final `state: <state>` line:

```
committed: gtd(human): grilling
committed: gtd: architecting
state: architecting
```

`--json` emits `{state, actions, commits}` instead (see
[JSON schemas](#json-schemas)).

## `gtd next`

Pure prompt emitter — it **never mutates** the repository. It reports whichever
actor is currently awaited and, if the tree is at a genuine rest, the full
prompt for that actor.

**Purity.** No commits, no file writes, no test runs — `gtd next` only gathers
and resolves.

**Dirty-tree refusal.** If the working tree has pending changes outside the
steering-file set, `gtd next` refuses rather than guess at a prompt for a state
that hasn't been captured yet:

```
gtd next: working tree is dirty — run `gtd status` to inspect it, then advance with `gtd step human` or `gtd step agent` (whichever actor is awaited)
```

**Pending.** If HEAD is mid-chain — bookkeeping the next `gtd step <actor>`
invocation would perform before reaching a rest — `gtd next` reports
`pending: true` with no prompt. Mid-chain bookkeeping is invoker-agnostic, so
either mutator resumes it; the report names the actor whose chain it is. In
plain mode an agent-driven checkpoint prints `"mid-chain checkpoint — run \`gtd
step agent\` to continue, then run \`gtd next\`
again"`, a human-driven one prints `"mid-chain checkpoint — run \`gtd step
human\` to continue"`.

**Agent tail lines.** In plain-mode output, a prompt for the **agent** actor
ends with the pinned tail:

```
Finish your turn by running `gtd step agent`. Then run `gtd next` and follow
its output — repeat this cycle as long as the output is addressed to you (the
agent); when it awaits the human, stop and hand off.
```

The first sentence closes the current turn; the second closes the outer loop —
it is what lets a plain-text agent chain multiple iterations (e.g. successive
test/fix cycles) without an external driver, until a human gate is reached.
Human-actor prompts carry no tail. `--json` output never embeds the tail into
`prompt` either — the structured `actor` field (see
[JSON schemas](#json-schemas) below) carries the same information: `"agent"`
means another agent round, `"human"` means stop and hand off.

## `gtd status`

Pure, read-only **dry-run prediction** — the same gather+resolve `gtd next`
runs, but reporting a prediction of the next turn rather than the actual prompt.
Performs no git mutation, no test run, no file write — guaranteed side-effect
free, including on a dirty tree.

Prints four fields:

```
State: grilling
Awaits: human
Predicted commit: gtd(human): grilling
Predicted state: grilling
```

- **State** — the currently resolved state.
- **Awaits** — the actor (`human` or `agent`) whose turn it is.
- **Predicted commit** — the subject `gtd step <actor>` would author next, or
  `(none)` at a fixpoint (e.g. idle with nothing to do).
- **Predicted state** — the state that commit would land in.

`gtd status` takes no arguments — extra positional args are rejected.

## `gtd review <target>`

A pure mutator that **anchors, then exits** — it never prints a prompt itself.
Use it to start an ad-hoc human review against an explicit git ref or branch,
independent of the automatic review base the workflow otherwise computes.

1. Refuses on a dirty tree.
2. Resolves `<target>` via merge-base semantics and computes the diff HEAD adds
   over `merge-base(<target>, HEAD)`.
3. Refuses if that diff is empty after filtering ("nothing to review").
4. Authors exactly one commit: `gtd: review <full-hash-of-the-base>`.
5. Prints a short confirmation pointing at `gtd next` — it does **not** print
   the review prompt itself.

```bash
gtd review main
# anchored review at <hash> — run `gtd next` to get the review prompt
gtd next --json
# {"actor":"agent", ...} — the review-record prompt scoped to that anchor
```

Errors (all exit 1, message on stderr):

- Missing target: `gtd review: missing target argument`
- Extra arguments:
  `gtd review: too many arguments — expected one target, got: …`
- Unresolvable ref: `gtd review: cannot resolve ref '<target>': <error message>`
- Empty diff:
  `gtd review: nothing to review (<target> diff is empty after filtering)`

## `gtd questions` / `gtd changesets`

Pure, read-only reporters — no dirty-tree check, no mutation — that parse the
structured content out of the active grilling/architecting and review documents,
for a future UI:

- **`gtd questions`** reads whichever of `.gtd/TODO.md` / `.gtd/ARCHITECTURE.md`
  is present and reports its `## Open Questions` list (see
  [Structured grilling/architecting and review files](workflow.md#structured-grillingarchitecting-and-review-files)).
  Reports an empty list when neither file exists.
- **`gtd changesets`** reads `.gtd/REVIEW.md`, if present, and reports its
  chunks/file-pointer list. Reports an empty list when the file doesn't exist.

Both take no arguments and always exit 0 — a malformed file is reported via the
`errors` field/lines rather than failing the command (the same diagnosis
`gtd step agent` would refuse the agent's next turn capture with).

```bash
gtd questions --json
# {"file":".gtd/TODO.md","questions":[{"question":"Which operations?","status":"suggested","text":"add and subtract."}],"errors":[]}
gtd changesets --json
# {"file":".gtd/REVIEW.md","shortHash":"abc1234","fullHash":"abc1234...","changesets":[...],"errors":[]}
```

## `gtd format <file>`

Formats a markdown file in place with a bundled prettier (`parser: "markdown"`,
`printWidth: 80`, `proseWrap: "always"`), ignoring the host repo's own
`.prettierrc` so `.gtd/TODO.md`/`.gtd/REVIEW.md` stay consistently formatted
regardless of the host project's toolchain. Rejects `--json` (exit 1,
`gtd format does not accept --json`) — it is a plain file operation, not a v2
state command.

Errors (all exit 1, message on stderr):

- Missing path: `gtd format: missing file path argument`
- Extra arguments: `gtd format: too many arguments — expected one path, got: …`
- Non-markdown file:
  `gtd format: <file> is not a markdown file (expected .md or .markdown)`
- File not found: `gtd: skipped formatting <file>: not found`

## JSON schemas

Pass `--json` to `step`, `next`, `status`, `review`, `questions`, or
`changesets` for machine-readable single-line JSON output instead of plain text.

**`step <actor>`** — `{state, actions, commits}`:

```json
{
  "state": "architecting",
  "actions": ["capture the human turn as \"gtd(human): grilling\""],
  "commits": ["gtd(human): grilling", "gtd: architecting"]
}
```

- `state` — the final resolved state after the fixpoint loop settled.
- `actions` — human-readable descriptions of every edge action this invocation
  performed, oldest→newest.
- `commits` — every commit subject this invocation authored, oldest→newest.

**`next`** — `{state, actor, pending, prompt}`:

```json
{
  "state": "building",
  "actor": "agent",
  "pending": false,
  "prompt": "..."
}
```

- `state` — the resolved state.
- `actor` — `"human"` or `"agent"`: who owns the next move. This is the single
  loop-driver signal: `"agent"` means proceed with another round — act on
  `prompt` when present, then run `gtd step agent`; at an agent-driven pending
  checkpoint (`prompt` is `null`, nothing to act on) just run `gtd step agent`.
  `"human"` means halt and hand off (a human rest, whose prompt body already
  tells the human what to do, or a human-driven pending checkpoint resumed by
  `gtd step human`).
- `pending` — `true` at a mid-chain HEAD (no prompt yet — resume with a mutator
  first); `false` at a genuine rest.
- `prompt` — the full prompt markdown when `pending` is `false`, else `null`.

**`status`** — `{state, actor, predictedCommit, predictedState}`:

```json
{
  "state": "grilling",
  "actor": "human",
  "predictedCommit": "gtd(human): grilling",
  "predictedState": "grilling"
}
```

`predictedCommit` is `null` when the next invocation would author nothing (e.g.
idle with a green health check).

**`questions`** — `{file, questions, errors}`:

```json
{
  "file": ".gtd/TODO.md",
  "questions": [
    {
      "question": "Which operations?",
      "status": "suggested",
      "text": "add and subtract."
    }
  ],
  "errors": []
}
```

`file` is `null` when neither `.gtd/TODO.md` nor `.gtd/ARCHITECTURE.md` is
present. `errors` lists any structural problems in the file — the same diagnosis
that would make `gtd step agent` refuse the agent's next turn capture.

**`changesets`** — `{file, shortHash, fullHash, changesets, errors}`:

```json
{
  "file": ".gtd/REVIEW.md",
  "shortHash": "abc1234",
  "fullHash": "abc1234def5678901234567890123456789abcd",
  "changesets": [
    {
      "title": "Add calculator",
      "description": "New add function for the calculator.",
      "files": [{ "path": "./src/calc.ts", "line": 1, "checked": false }]
    }
  ],
  "errors": []
}
```

`file` is `null` when `.gtd/REVIEW.md` doesn't exist. `errors` mirrors
`questions`' field above.

**Error envelope** — every command, in `--json` mode, reports failures inside
the JSON object rather than as unstructured text, and still exits 1:

```json
{ "state": "error", "prompt": "<message>" }
```

There is no auto-advance flag anywhere in the wire format — `actor` replaces it.
The caller decides whether to keep looping based on `actor` (halt on `"human"`)
and `pending` (re-run `gtd step <actor>` first when `true`), not on a boolean
auto-advance flag.

## Repository requirements

- **Single writer, linear branch.** State is folded from **first-parent**
  history only. A merge commit at HEAD is unsupported (documented, not handled)
  — it degrades gracefully on the default branch rather than crashing, but do
  not rely on merge commits mid-cycle.
- **Test/build artifacts must be gitignored.** This is **load-bearing**, not a
  style preference: every fixpoint hop in `gtd step human`/`gtd step agent`
  detects "clean" via `git status --porcelain`, which silently omits anything
  matched by `.gitignore`. If your `testCommand` (or the build it triggers)
  writes tracked-but-untracked output — a `dist/`, a coverage report, a log file
  — into the working tree, the tree never goes clean after a green test run, and
  the fixpoint loop cannot converge: it will either loop forever re-detecting a
  "dirty" boundary or misclassify build output as the human's next feature
  capture. Gitignore every path your test/build toolchain writes before wiring
  gtd into a repo.
- **Repository root invocation.** Every subcommand except `--help`/`--version`
  must run from the git repository root — steering files and diffs are resolved
  against the process cwd.
