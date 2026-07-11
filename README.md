# gi[t]hings.**done**

> [!WARNING] This project is an experiment in unapologetic vibe coding. Code
> might be terrible, I don't even know 🤷‍♂️ But otherwise I wouldn't have built it
> in the first place. Now I have something that actually helps me.

A git-aware CLI that drives a turn-taking loop between a human and an autonomous
coding agent: capture an idea, grill it into a plan, decompose it into work
packages, execute with parallel subagents, test, agentically review each
package, and finally walk a human through a review — squashing the whole cycle
into one conventional-commits commit at the end.

Internally, gtd is a **pure fold** over git history. The decision core
(`src/Machine.ts`) is a single IO-free function, `resolve(events)` — **no
xstate, no actor, no Effect**. The Effect "edge" (`src/Events.ts`) does all the
git/filesystem IO: it reads the **first-parent** commit subjects since the
merge-base with the default branch (whole-history fallback when there is no
default branch, when HEAD equals the merge-base, or when there is no merge-base)
plus the working tree, turns them into a `COMMIT[]` + single terminal `RESOLVE`
event stream, and folds them through the machine. The fold lands on exactly
**one** of 16 states, plus which actor (human or agent) is awaited there. A
single call resolves to a single state.

Steering is entirely **machine-authored commit subjects** — there are no marker
files, sentinels, or auto-advance tails to parse. A turn commit looks like
`gtd(human): grilling` or `gtd(agent): building`; a routing commit (bookkeeping
the machine performs itself between turns) looks like `gtd: tests green`.
`src/Subjects.ts` is the closed grammar both the machine and the edge read.

All workflow state lives under **`.gtd/`**: the plan (`.gtd/TODO.md`), work
packages (`.gtd/01-…/`), review records (`.gtd/REVIEW.md`, `.gtd/FEEDBACK.md`),
and loop bookkeeping (`.gtd/ERRORS.md`, `.gtd/HEALTH.md`, `.gtd/SQUASH_MSG.md`).
One rule follows for every agent in the loop: **never touch `.gtd/`** except the
single file a prompt explicitly grants. A `TODO.md` or `REVIEW.md` at the
repository root is the project's own file — gtd never reads, consumes, or
deletes it. (Corollary: don't gitignore `.gtd/` — the workflow commits its state
through it.)

## Quick start: the two-beat loop

gtd splits what used to be one mutating command into three:

- **`gtd step`** — advance the workflow as the **human** actor, to fixpoint.
- **`gtd step-agent`** — advance the workflow as the **agent** actor, to
  fixpoint.
- **`gtd next`** — print the prompt for whichever actor is currently awaited,
  without mutating anything.

An agent loop is a two-beat protocol repeated forever:

1. Run `gtd step-agent` to advance any agent-owned bookkeeping to a fixpoint.
2. Run `gtd next --json` and read the `actor` field. If it is `"human"`,
   **halt** — the human owns the next move, and the agent's job is done for this
   turn. If it is `"agent"`, feed `prompt` (when non-null) to the agent, let it
   act, then go back to step 1; at a pending checkpoint (`prompt` is null) go
   straight back to step 1.

A human acts by editing files (answering questions in `.gtd/TODO.md`, annotating
`.gtd/REVIEW.md`, fixing code) and then running `gtd step` to capture the edit
as their turn and hand control back to the agent side of the loop.

```bash
gtd step-agent            # advance the machine's own bookkeeping
gtd next --json            # ask who's up and what they should do
```

See [The reference loop driver](#the-reference-loop-driver) for a full script
implementing this protocol, and [`skills/loop/SKILL.md`](skills/loop/SKILL.md)
for the agent-facing instructions that follow the same pinned contract.
`gtd-loop`, installed alongside `gtd` (see below), is the packaged, ready-to-run
implementation of that same script for anyone who doesn't want to drive the loop
by hand.

## Installation

```bash
npm install -g @pmelab/gtd
```

Or run without installing:

```bash
npx @pmelab/gtd
```

No config file, no setup subcommand — `gtd` auto-initializes a `.gtdrc.json`
schema stub on first run (see [Auto-init](#auto-init)).

## Command reference

```
Usage: gtd [command] [options]

Commands:
  step             Advance the workflow as the human actor (to fixpoint)
  step-agent       Advance the workflow as the agent actor (to fixpoint)
  next             Print the prompt for whichever actor is awaited (no mutation)
  status           Predict the next commit and state from the working tree (no mutation)
  review <target>  Anchor an ad-hoc human review against a git ref or branch
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

### `gtd step` / `gtd step-agent`

Both drive the **same fixpoint loop** — gather → resolve → perform the returned
edge action → repeat — differing only in which actor's turn they are allowed to
capture:

- **`gtd step`** captures the **human** turn at whichever gate is awaiting one.
- **`gtd step-agent`** captures the **agent** turn.

**Fixpoint advance.** A single invocation may author several commits: it authors
the awaited actor's turn commit, then keeps performing any further mid-chain
routing (a test run, a routing commit, a package close, …) until it reaches a
rest where a prompt would be shown, or a fixpoint where nothing changed.
`gtd step`/`gtd step-agent` never print a prompt themselves — that's
`gtd next`'s job.

**Idempotence.** Re-running the same command again once the tree is settled at a
rest authors **zero** new commits. It exits 0 while the rest still awaits that
command's actor (an inert empty agent turn, the idle health check); once the
rest awaits the _other_ actor, the re-run is an out-of-turn refusal — still zero
commits, but non-zero exit.

**Out-of-turn refusal.** Human and agent turns are strictly separated: the wrong
mutator always errors, at every state, on clean and dirty trees alike.
`gtd step-agent` while a human turn is awaited refuses with
`"<state> awaits a human turn — run \`gtd step\`"`; `gtd
step`while an agent turn is awaited refuses with`"<state> awaits an agent turn —
run \`gtd
step-agent\`"`— exit non-zero, zero commits either way. Human edits made while the agent is awaited (e.g. amendment notes in`.gtd/`package files after the`gtd:
planning` commit lands) stay pending in the working tree and ride along as input
to the agent's next captured turn; left unamended, the build proceeds.

**Red-test fixpoints exit 0.** A red test run below the fix-attempt cap (or the
health-fix cap) still writes its findings and commits — it is a normal,
successful step of the loop, not a failure of the `step`/`step-agent`
invocation. `step`/`step-agent` only exit non-zero for a genuine refusal or an
operational error (bad config, missing test binary, corrupted state).

**Output.** Plain mode prints one `committed: <subject>` line per commit this
invocation authored (oldest→newest), then a final `state: <state>` line:

```
committed: gtd(human): grilling
committed: gtd: grilled
state: grilled
```

`--json` emits `{state, actions, commits}` instead (see
[JSON schemas](#json-schemas)).

### `gtd next`

Pure prompt emitter — it **never mutates** the repository. It reports whichever
actor is currently awaited and, if the tree is at a genuine rest, the full
prompt for that actor.

**Purity.** No commits, no file writes, no test runs — `gtd next` only gathers
and resolves.

**Dirty-tree refusal.** If the working tree has pending changes outside the
steering-file set, `gtd next` refuses rather than guess at a prompt for a state
that hasn't been captured yet:

```
gtd next: working tree is dirty — run `gtd status` to inspect it, then advance with `gtd step` or `gtd step-agent` (whichever actor is awaited)
```

**Pending.** If HEAD is mid-chain — bookkeeping the next `step`/`step-agent`
invocation would perform before reaching a rest — `gtd next` reports
`pending: true` with no prompt. Mid-chain bookkeeping is invoker-agnostic, so
either mutator resumes it; the report names the actor whose chain it is. In
plain mode an agent-driven checkpoint prints `"mid-chain checkpoint — run \`gtd
step-agent\` to continue, then run \`gtd next\`
again"`, a human-driven one prints `"mid-chain checkpoint — run \`gtd step\` to
continue"`.

**Agent tail lines.** In plain-mode output, a prompt for the **agent** actor
ends with the pinned tail:

```
Finish your turn by running `gtd step-agent`. Then run `gtd next` and follow
its output — repeat this cycle as long as the output is addressed to you (the
agent); when it awaits the human, stop and hand off.
```

The first sentence closes the current turn; the second closes the outer loop —
it is what lets a plain-text agent chain multiple iterations (e.g. successive
test/fix cycles) without an external driver, until a human gate is reached.
Human-actor prompts carry no tail. `--json` output never embeds the tail into
`prompt` either — the structured `actor` field (see JSON schemas below) carries
the same information: `"agent"` means another agent round, `"human"` means stop
and hand off.

### `gtd status`

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
- **Predicted commit** — the subject `step`/`step-agent` would author next, or
  `(none)` at a fixpoint (e.g. idle with nothing to do).
- **Predicted state** — the state that commit would land in.

`gtd status` takes no arguments — extra positional args are rejected.

### `gtd review <target>`

A pure mutator that **anchors, then exits** — it never prints a prompt itself.
Use it to start an ad-hoc human review against an explicit git ref or branch,
independent of the automatic review base the workflow otherwise computes.

1. Refuses on a dirty tree.
2. Resolves `<target>` via merge-base semantics and computes the diff HEAD adds
   over `merge-base(<target>, HEAD)`.
3. Refuses if that diff is empty after filtering ("nothing to review").
4. Authors exactly one commit: `gtd: reviewing <full-hash-of-the-base>`.
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

### `gtd format <file>`

Unchanged from v1: formats a markdown file in place with a bundled prettier
(`parser: "markdown"`, `printWidth: 80`, `proseWrap: "always"`), ignoring the
host repo's own `.prettierrc` so `.gtd/TODO.md`/`.gtd/REVIEW.md` stay
consistently formatted regardless of the host project's toolchain. Rejects
`--json` (exit 1, `gtd format does not accept --json`) — it is a plain file
operation, not a v2 state command.

Errors (all exit 1, message on stderr):

- Missing path: `gtd format: missing file path argument`
- Extra arguments: `gtd format: too many arguments — expected one path, got: …`
- Non-markdown file:
  `gtd format: <file> is not a markdown file (expected .md or .markdown)`
- File not found: `gtd: skipped formatting <file>: not found`

## JSON schemas

Pass `--json` to `step`, `step-agent`, `next`, or `status` for machine-readable
single-line JSON output instead of plain text.

**`step` / `step-agent`** — `{state, actions, commits}`:

```json
{
  "state": "grilled",
  "actions": ["capture the human turn as \"gtd(human): grilling\""],
  "commits": ["gtd(human): grilling", "gtd: grilled"]
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
  `prompt` when present, then run `gtd step-agent`; at an agent-driven pending
  checkpoint (`prompt` is `null`, nothing to act on) just run `gtd step-agent`.
  `"human"` means halt and hand off (a human rest, whose prompt body already
  tells the human what to do, or a human-driven pending checkpoint resumed by
  `gtd step`).
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

**Error envelope** — every command, in `--json` mode, reports failures inside
the JSON object rather than as unstructured text, and still exits 1:

```json
{ "state": "error", "prompt": "<message>" }
```

There is no auto-advance flag anywhere in the wire format — `actor` replaces it.
The caller decides whether to keep looping based on `actor` (halt on `"human"`)
and `pending` (re-run `step`/`step-agent` first when `true`), not on a boolean
auto-advance flag.

## The reference loop driver

A minimal bash implementation of the pinned two-beat protocol, driving an agent
CLI (e.g. `claude -p`) against `gtd --json` output. This is the authoritative
reference for what a loop driver must do; keep any other implementation
(including `skills/loop/SKILL.md`) consistent with it rather than editing both
independently.

```bash
#!/usr/bin/env bash
set -euo pipefail

while true; do
  # 1. Advance the machine's own agent-owned bookkeeping to a fixpoint.
  gtd step-agent --json >/dev/null || true

  # 2. Ask who's up next. `actor` is the single "proceed" signal.
  next="$(gtd next --json)"
  actor="$(jq -r .actor <<<"$next")"
  prompt="$(jq -r .prompt <<<"$next")"

  if [[ "$actor" != "agent" ]]; then
    echo "Halting — the human owns the next move."
    break
  fi

  if [[ "$prompt" == "null" ]]; then
    # Agent-driven pending checkpoint: nothing to act on — loop back to
    # step 1, whose `gtd step-agent` resumes the mid-chain bookkeeping.
    continue
  fi

  # Agent's turn: feed the prompt to the agent, then let it finish with
  # `gtd step-agent` itself (the prompt's tail instructs it to).
  claude -p "$prompt" --dangerously-skip-permissions
done
```

The agent is expected to run `gtd step-agent` itself once it finishes acting on
the prompt (the plain-mode tail says exactly this) — the driver's own
`step-agent` calls exist to advance any bookkeeping the agent doesn't own
(routing commits, test runs) between agent turns.

The loop halts on `actor: "human"` alone: a human rest (`pending: false`, the
prompt body addresses the human) or a human-driven pending checkpoint
(`pending: true`, resumed by the human's own `gtd step`). Everything the agent
side can drive — agent rests and agent-driven checkpoints — reports
`actor: "agent"`, so multiple agent turns and commits (e.g. successive test/fix
cycles, a force-approved package close) chain without human involvement until an
actual human gate is hit.

`bin/gtd-loop`, installed as the `gtd-loop` binary, is the packaged
implementation of this exact script — kept in sync with it the same way
`skills/loop/SKILL.md` is. It additionally attempts `gtd step` (not just
`gtd step-agent`) every iteration, so a plain rerun after you've edited a file
at a human gate (no commit needed) picks up your edit and keeps going, and it
halts with a diagnostic if the same state and prompt repeat with no progress
(see `skills/loop/SKILL.md`'s "Stall detection").

### Using a different agent

`gtd-loop` defaults to
`claude -p "$GTD_LOOP_PROMPT" --dangerously-skip-permissions`, but the agent
invocation is swappable: set `GTD_LOOP_AGENT_CMD` to any shell command, and it
runs with the prompt available as `$GTD_LOOP_PROMPT` in its environment. For
example, to drive a different agent CLI:

```bash
GTD_LOOP_AGENT_CMD='my-agent-cli --prompt "$GTD_LOOP_PROMPT"' gtd-loop
```

## States & subjects overview

`resolve()` lands on exactly one of **16 states**: `grilling`, `grilled`,
`planning`, `building`, `testing`, `fixing`, `escalate`, `agentic-review`,
`close-package`, `review`, `await-review`, `done`, `squashing`, `idle`,
`health-check`, `health-fixing`. Each state has a fixed awaited actor (see
`awaitedActor` in `src/Machine.ts`): `idle`, `escalate`, and `await-review`
await the **human**; every other state awaits the **agent**.

For the full precedence ladder, illegal combinations, and the counter folds that
drive the fix loops, see [STATES.md](STATES.md) — this section is a summary.

### Turn commits — `gtd(<actor>): <gate>`

Authored by `gtd step`/`gtd step-agent` as the first commit of a fresh chain.
The closed set of gates:

| Gate             | Authored by                                                        |
| ---------------- | ------------------------------------------------------------------ |
| `grilling`       | human (answers) / agent (plan iteration)                           |
| `grilled`        | agent (converged, ready to decompose)                              |
| `building`       | agent (package work, or human feedback while agent is out of turn) |
| `fixing`         | agent (test-fix or review-fix round)                               |
| `agentic-review` | agent (writes .gtd/FEEDBACK.md verdict)                            |
| `review`         | agent (writes .gtd/REVIEW.md) / human (approves or gives feedback) |
| `squashing`      | agent (overwrites .gtd/SQUASH_MSG.md)                              |
| `health-fixing`  | agent (idle health-check repair)                                   |
| `escalate`       | human (deletes .gtd/ERRORS.md to resume)                           |

### Routing commits — `gtd: <phase>`

Bookkeeping the machine authors itself between turns, never a turn a human or
agent "wins": `gtd: grilled`, `gtd: planning`, `gtd: tests green`,
`gtd: errors`, `gtd: package done`, `gtd: awaiting review`,
`gtd: review feedback`, `gtd: done`, `gtd: squash template`,
`gtd: reviewing <hash>` (parameterized, from `gtd review`), `gtd: health-check`,
`gtd: health-fix`.

Everything else — any non-`gtd` subject, and any `gtd: *` subject outside this
closed set — is a **boundary commit**: inert as far as the machine's grammar is
concerned. See [Upgrading from v1](#upgrading-from-v1-breaking-change) for why
this matters on upgrade.

## Workflow walkthroughs

### Grilling

A dirty tree at a boundary HEAD (a fresh idea, sketched in a file or just left
as pending code) is captured in **one** human turn: `gtd step` commits
everything pending as `gtd(human): grilling` — nothing is reverted or seeded,
the captured files stay in history. `gtd next` hands the agent that turn's diff;
the agent develops `.gtd/TODO.md` into a concrete plan **in one turn**,
proposing a **suggested default** for every open question, and leaves
`.gtd/TODO.md` uncommitted for `gtd(agent): grilling`.

There are no markers to answer — the human either:

- **Accepts the suggested defaults**: runs a clean `gtd step` at the answer
  gate. An empty `gtd(human): grilling` turn plus routing `gtd: grilled` lands
  automatically, and `gtd next` emits the decompose prompt.
- **Edits `.gtd/TODO.md`** with real answers, then runs `gtd step`, which
  captures the edit as a fresh `gtd(human): grilling` turn and hands it back to
  the agent for another round.

### Build lifecycle: budgets

Once decomposed, `.gtd/` holds ordered work packages. `gtd next` at
`gtd: planning`/`gtd: package done` selects the lowest-numbered remaining
package and inlines only its task files. The agent builds it and leaves the work
**uncommitted**; the next invocation's edge action commits it (the
`gtd(agent): building` turn commit) and runs `testCommand`.

- **Green** → Agentic Review.
- **Red, below `fixAttemptCap`** (default 3) → write findings, commit
  `gtd: errors`, rest at **Fixing** for the agent.
- **Red, at/over the cap** → write `.gtd/ERRORS.md` instead, commit
  `gtd: errors`, rest at **Escalate** — a human gate. Deleting `.gtd/ERRORS.md`
  and landing that deletion as `gtd(human): escalate` resets the budget and
  re-tests from zero in the same invocation.

### Agentic review

A green test run always rests at **Agentic Review**: the agent reviews the
package's accumulated diff against its task specs and writes `.gtd/FEEDBACK.md`.
An **empty** `.gtd/FEEDBACK.md` is the approval signal — the same
`gtd(agent): agentic-review` turn closes the package (`gtd: package done`,
removing `.gtd/FEEDBACK.md` and the finished package directory) in one
invocation. Non-empty findings rest for the fixing prompt; fixing loops back
through the test gate and re-reviews. Once `reviewFixCount >= reviewThreshold`
(default 3) within a package, Agentic Review **force-approves** without ever
writing `.gtd/FEEDBACK.md` — so a package can never review-loop forever. The
findings round that crosses the threshold still gets its fixing round; the
force-approve close then fires at the next green re-test instead of another
review. (Any agentic-review turn that touches `.gtd/FEEDBACK.md` counts toward
the threshold — including the approval write itself; an approval that crosses
the threshold simply closes the package as usual.) Setting
`agenticReview: false` force-approves every package immediately.

A **do-nothing agent invocation** — `gtd step-agent` on a clean tree at ANY
agent-awaited rest whose move is a file artifact (`grilling`, `grilled`,
`building`, `fixing`, `agentic-review`, `review`, and `squashing` while
`.gtd/SQUASH_MSG.md` still holds the unmodified template) — is inert: zero
commits, no state consumed; `gtd next` re-emits the same prompt. This is
load-bearing for the loop protocol, whose every iteration opens with
`gtd step-agent` before the agent has acted: without the guard that opening beat
would author junk empty turns — and worse, consume workflow state (an empty
decompose turn would delete `.gtd/TODO.md` with no packages written; an empty
squashing turn would squash the cycle under the placeholder template). The same
guards hold at the classification layer for histories that already carry such
turns: a `gtd(agent): grilled` HEAD only routes to `gtd: planning` when packages
exist, a `gtd(agent): review` HEAD only routes to `gtd: awaiting review` when
`.gtd/REVIEW.md` exists, and a squashing turn only squashes once the template
has been overwritten. The one deliberate exception is `health-fixing`, whose
empty turn is meaningful (the failure may have been environmental — the machine
removes `.gtd/HEALTH.md` and re-tests). Human gates are unaffected: an empty
**human** turn stays a signal (accept-defaults at grilling, clean approval at
review).

### Human review gate

Once `.gtd/` is fully closed, the machine writes `.gtd/REVIEW.md` and rests at
**await-review**, awaiting the human. Approval is any of:

- A **clean** `gtd step` (nothing edited) — an empty `gtd(human): review` turn
  plus routing `gtd: done`.
- Flipping only `- [ ]` → `- [x]` checkboxes in `.gtd/REVIEW.md` — checkbox-only
  edits are also treated as clean approval.

Any **substantive** edit — to `.gtd/REVIEW.md` prose, or to the reviewed code
itself — is feedback: `gtd(human): review` plus routing `gtd: review feedback`,
`.gtd/REVIEW.md` removed, and `gtd next` re-emits a grilling prompt to the agent
that inlines the human's finding.

### Squash

With `squash: true` (the default), `gtd: done` is **not** a rest — the same
chain continues straight to `gtd: squash template`, writing and committing a
`.gtd/SQUASH_MSG.md` template. `gtd next` then emits the squashing prompt: the
agent overwrites `.gtd/SQUASH_MSG.md` with a real conventional-commits message
(drawing on grilling-round decisions from history) and finishes its turn.
`gtd step-agent` then performs the squash itself: `git reset --soft <base>` +
`git commit`, collapsing every intermediate `gtd: *` commit of the cycle into
one — including any review-feedback detours: the squash base is the cycle's
ORIGINAL start (the first grilling run since the previous `gtd: done` boundary,
or the `gtd: reviewing <hash>` anchor for an ad-hoc review cycle), not the most
recent re-grilling round — the collapse folds the whole cycle into one, using
the overwritten message's content verbatim (turn position, not message content,
triggers the squash). With `squash: false`, `gtd: done` is the resting boundary
and no template is ever written.

### Health check

Outside any process (idle, nothing to review, no steering files), `gtd step`
runs `testCommand` as a health check rather than settling immediately. Green
settles idle with zero commits. Red below `fixAttemptCap` writes
`.gtd/HEALTH.md` and rests at **Health Fixing** for the agent; the fixer's own
turn (`gtd(agent): health-fixing`) removes `.gtd/HEALTH.md` and re-tests in the
same chain — a green re-test continues to squash (if enabled) or idle; red
repeats the health-fix loop; red at the cap writes `.gtd/ERRORS.md` and
escalates.

### Escalate / budget reset

`.gtd/ERRORS.md` present is always a human gate, regardless of which loop wrote
it (test-fix or health-fix). Deleting `.gtd/ERRORS.md` and running `gtd step`
records the deletion as the human's `gtd(human): escalate` turn, which
**immediately re-tests in the same invocation** — this resets the relevant
fix-attempt budget to zero.

## States & subjects: overview table

| State            | Awaits         | Turn/routing subject at rest                                     |
| ---------------- | -------------- | ---------------------------------------------------------------- |
| `grilling`       | human or agent | `gtd(human): grilling` / `gtd(agent): grilling`                  |
| `grilled`        | agent          | `gtd: grilled`                                                   |
| `planning`       | agent          | `.gtd/` modified                                                 |
| `building`       | agent          | `gtd: planning` / `gtd: package done`                            |
| `testing`        | — (edge-only)  | mid-chain only                                                   |
| `fixing`         | agent          | `gtd: errors`                                                    |
| `escalate`       | human          | `.gtd/ERRORS.md` present                                         |
| `agentic-review` | agent          | `gtd: tests green`                                               |
| `close-package`  | — (edge-only)  | mid-chain only                                                   |
| `review`         | agent          | `gtd: package done` (no more packages) / `gtd: reviewing <hash>` |
| `await-review`   | human          | `gtd: awaiting review`                                           |
| `done`           | — (edge-only)  | `gtd: done`                                                      |
| `squashing`      | agent          | `gtd: squash template`                                           |
| `idle`           | human          | no steering files, green health check                            |
| `health-check`   | — (edge-only)  | mid-chain only                                                   |
| `health-fixing`  | agent          | `.gtd/HEALTH.md` present                                         |

See [STATES.md](STATES.md) for the full precedence ladder, the counter folds,
and every illegal steering-file combination.

## Configuration

gtd reads an optional `.gtdrc` config file via
[cosmiconfig](https://github.com/cosmiconfig/cosmiconfig). With no config, the
built-in defaults apply. Supported filenames (searched in this order):

- `.gtdrc`
- `.gtdrc.json`
- `.gtdrc.yaml`
- `.gtdrc.yml`
- `gtd.config.json`
- `gtd.config.yaml`

### Schema

- **`testCommand`** (string, default `npm run test`) — the command the edge runs
  after a build turn, and on the idle health-check path.
- **`fixAttemptCap`** (non-negative integer, default `3`) — the test-fix budget:
  how many `gtd: errors` attempts are allowed per sub-loop before the failure is
  escalated to `.gtd/ERRORS.md` (Escalate). `0` disables the cap (escalates
  immediately on the first red run). Also reused as the health-fix budget — no
  separate config key.
- **`reviewThreshold`** (integer ≥ 1, default `3`) — the review-fix budget: how
  many agentic-review findings rounds are allowed per package before Agentic
  Review force-approves.
- **`agenticReview`** (boolean, default `true`) — kill-switch for the
  per-package Agentic Review gate. Set `false` to force-approve every package
  and proceed directly to human review.
- **`squash`** (boolean, default `true`) — after `gtd: done`, collapse the
  cycle's `gtd: *` commits into a single conventional-commits commit. Set
  `false` to keep the granular history.
- **`models`** — model selection for the subagent-spawning states:
  - `planning` — high-reasoning tier (default `claude-opus-4-8`), used by
    `decompose` (the `grilled`/`planning` states), `grilling`, `agentic-review`,
    and `clean` (the `review`/`squashing` states).
  - `execution` — everyday tier (default `claude-sonnet-4-8`), used by
    `building` and `fixing`.
  - `states.*` — per-state overrides keyed by `decompose`, `grilling`,
    `building`, `fixing`, `agentic-review`, `clean`. Unknown `states` keys are
    **rejected**.
- **`$schema`** (string, optional) — stripped before validation, so it never
  counts as an unknown key. Point it at the published schema for editor-backed
  autocompletion. A `schema.json` is generated from the config schema at build
  time and ships with the package.

### Validation and errors

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

### Lookup and precedence

gtd walks from the current working directory **up to your home directory** (or
to the filesystem root when cwd is outside home), collecting every `.gtdrc` it
finds along the way. All found levels are **deep-merged**, with the **innermost
(cwd) config winning** on conflicts — so a shared `.gtdrc` in a worktree-parent
directory cascades to every checkout beneath it, while any individual checkout
can still override settings with its own `.gtdrc`.

### Auto-init

On every **state command** (`step`, `step-agent`, `next`, `status`, `review`)
that has passed the repo-root guard, if the cwd→root walk finds **no** config
anywhere, gtd creates and commits a starter `.gtdrc.json` at the repository root
containing only a `$schema` link. Auto-init never runs for `--version`/`--help`,
`format`, bare/unknown commands, or an invocation refused by the repo-root guard
— those perform no repository mutation of any kind. On a repo with no commits
yet, or whose HEAD is a plain (non-`gtd:`) commit, the stub is committed as its
own `chore: add .gtdrc.json`. If HEAD is already a `gtd:`-owned commit
(mid-workflow), the stub is instead **amended into HEAD** — stacking a fresh
boundary commit there would produce an unrecognized HEAD most workflow states
can't resolve past.

### Example

```yaml
# .gtdrc.yaml
testCommand: pnpm test
fixAttemptCap: 3
reviewThreshold: 3
agenticReview: true
squash: true
models:
  planning: claude-opus-4-8
  execution: claude-sonnet-4-8
  states:
    decompose: claude-opus-4-8
    building: claude-sonnet-4-8
```

## Repository requirements

- **Single writer, linear branch.** State is folded from **first-parent**
  history only. A merge commit at HEAD is unsupported (documented, not handled)
  — it degrades gracefully on the default branch rather than crashing, but do
  not rely on merge commits mid-cycle.
- **Test/build artifacts must be gitignored.** This is **load-bearing**, not a
  style preference: every fixpoint hop in `gtd step`/`gtd step-agent` detects
  "clean" via `git status --porcelain`, which silently omits anything matched by
  `.gitignore`. If your `testCommand` (or the build it triggers) writes
  tracked-but-untracked output — a `dist/`, a coverage report, a log file — into
  the working tree, the tree never goes clean after a green test run, and the
  fixpoint loop cannot converge: it will either loop forever re-detecting a
  "dirty" boundary or misclassify build output as the human's next feature
  capture. Gitignore every path your test/build toolchain writes before wiring
  gtd into a repo.
- **Repository root invocation.** Every subcommand except `--help`/`--version`
  must run from the git repository root — steering files and diffs are resolved
  against the process cwd.

## Build orchestration

### Decompose

The Grilled/Planning states spawn a planning-model subagent that breaks
`.gtd/TODO.md` into executable work packages under `.gtd/`:

```
.gtd/
  01-auth-module/
    01-define-types.md
    02-implement-login.md
  02-api-endpoints/
    01-create-routes.md
    02-add-middleware.md
```

Rules:

- **Packages are sequential, in ordinal dependency order** — `01-`, `02-`, …;
  the set is frozen once written. Package 02 cannot start until 01 is complete.
- **Each package is green on its own** — the test suite runs after every
  package, so none may leave the tree red for a later package to fix.
- **Tasks within a package are parallel and file-disjoint** — one subagent per
  task, no isolation; tasks that would touch the same file are merged into one.
- **Vertical slices, not horizontal** — each package is a thin, end-to-end
  slice; prefer many thin packages over a "set up infrastructure" package.
- **Task files are self-contained** — description, acceptance-criteria
  checkboxes, relevant file paths, constraints, and edge cases.

### Execute

Execution is **one package per cycle**. `gtd next` selects the single next
package itself, names it in the prompt, and inlines its task files' full
contents — the agent never browses `.gtd/` or picks a package itself. A single
cycle:

1. Spawn parallel execution-model workers for all tasks in the selected package.
2. Leave all changes **uncommitted**. Do not commit, do not delete the package
   directory, do not run tests.
3. Finish the turn with `gtd step-agent` — the next hop's edge action commits
   the work (`gtd(agent): building`) and runs `testCommand` to verify it.

## Upgrading from v1 (BREAKING CHANGE)

v2 ships as a **major** semantic-release bump (`2.0.0`) so the binary and the
loop-driving text (this README, `skills/loop/SKILL.md`) can never skew against
each other. There is **no backward compatibility with the v1 command surface**:
the single mutating `gtd` command, marker/sentinel files, the `autoAdvance` JSON
field, and the `gtd: transport` handoff commit are all gone. `gtd` bare now
errors rather than driving a loop; use `gtd step-agent` / `gtd next` /
`gtd step` instead.

**Commit-history compatibility is one-way.** Any repo with v1-taxonomy history
in it (`gtd: new task`, `gtd: grilling`, `gtd: transport`, a bare
`gtd: reviewing` with no hash, …) upgrades cleanly: those subjects fall outside
v2's closed turn/routing grammar and parse as inert **boundary commits** — they
are never mistaken for v2 workflow state and never error.

**Finish or clean up any in-flight v1 cycle first.** If a repo has an
**in-progress** v1 cycle — steering files present (root-level `TODO.md`,
`REVIEW.md`, `FEEDBACK.md`, `ERRORS.md`, or `.gtd/`) whose HEAD carries v1-only
commit subjects — the v2 binary does not know how to resume it: v1 steering
files have no v2 turn commit backing them, so a cold v2 invocation on that tree
can land in an unrecognized state. Either finish the v1 cycle to a clean
boundary with your existing v1 binary before upgrading, or manually clean up
(remove the steering files / `.gtd/`, commit the result) so the upgrade starts
from a plain boundary HEAD.

**Steering files moved into `.gtd/`.** Earlier v2 builds kept `TODO.md`,
`REVIEW.md`, `FEEDBACK.md`, `ERRORS.md`, `HEALTH.md`, and `SQUASH_MSG.md` at the
repository root; they now live under `.gtd/`. Upgrade at a clean boundary (idle,
post-squash): a repo at rest needs nothing. Mid-cycle repos should either finish
the cycle on the old build first or move the root-level steering files into
`.gtd/` by hand and commit. History classification is backward-compatible — the
counter folds recognize both the old root paths and the new `.gtd/` paths in
existing commits.

**Re-copy the loop skill.** If you vendor `skills/loop/` into a consuming repo
or agent harness, upgrading the `gtd` binary also means re-copying that skill
from this release — the v1 skill text still describes the old single-command
loop and will drive the new binary incorrectly.

For maintainers: this repo releases via `semantic-release` reading Conventional
Commits, and needs **no config change** for a major bump — but the release
commit/PR **must carry a `BREAKING CHANGE:` footer** (or a `!` after the type)
for `@semantic-release/commit-analyzer` to compute `2.0.0` rather than a
minor/patch bump.

## Development

```bash
npm install
npm run dev          # run from source, no build (node dev/run.mjs)
npm run build        # tsup → dist/gtd.bundle.mjs
npm test             # format:check, typecheck, lint, unit + e2e tests, fallow
npm run test:unit    # vitest unit tests (the pure resolver) — --project unit
npm run test:e2e     # gherkin e2e via vitest + quickpickle — --project e2e
npm run test:mutation # StrykerJS mutation testing (manual only, ~2 min)
npm run typecheck
npm run lint
```

### Pre-commit hook

A pre-commit hook is installed automatically via the `prepare` script when you
run `npm install` on a fresh clone — no manual setup needed. The hook runs
[lint-staged](https://github.com/lint-staged/lint-staged) with
[Prettier](https://prettier.io/), formatting every staged file before each
commit (`prettier --ignore-unknown --write`), mirroring the `format:check` step
enforced in CI (`prettier --check .`).

### Prompt templates

Each prompt-bearing state has a self-contained Eta template in
`src/prompts/*.md` that owns its full prompt — header, context, and body. Shared
fragments live as partials in `src/prompts/partials/`: `header`, the context
renderers (`diff`, `feedback`, `package`), and the single `agent-turn` tail
partial (the pinned "Finish your turn by running `gtd step-agent`. Then run
`gtd next` …" loop-closing instructions).

At module load, `src/Prompt.ts` registers every template on a single `new Eta()`
instance via `loadTemplate`. `readFile` and `resolvePath` are nulled afterward
so rendering resolves exclusively from the in-memory cache — the compiled ESM
bundle carries no runtime `fs` dependency.

`buildPrompt(result, resolveModel?, output?)` selects the state's template,
builds a view-model (model string, tail partial name, context), renders it,
collapses runs of three or more blank lines to two, and ensures exactly one
trailing newline. It throws for the five states that render no prompt at all
(`testing`, `planning`, `close-package`, `done`, `health-check`) — those are
performed entirely by the edge.

`npm run dev` runs `src/main.ts` directly via Node's native TypeScript
type-stripping (requires Node 22.6+). It registers `dev/hooks.mjs`, which fills
the two gaps the tsup build otherwise covers: resolving `./Foo.js` specifiers to
the on-disk `./Foo.ts`, and importing `*.md` prompt files as text. Pass CLI args
after `--`, e.g. `npm run dev -- format <file>`.

The decision core (`src/Machine.ts`) is pure and IO-free, so the whole 16-state
ladder and both counter folds are trivially unit-testable in isolation; all
git/filesystem IO is confined to the edge (`src/Events.ts`).

`npm run build` produces `dist/gtd.bundle.mjs`, which npm exposes as the `gtd`
binary via the `bin` field in `package.json`.

### Mutation testing

Run mutation testing on-demand with `npm run test:mutation` (StrykerJS, ~2 min)
— never run it as part of routine development; it is a deliberate,
manually-triggered check. The single `stryker.config.json` mutates six core
files:

```
src/Machine.ts  src/Prompt.ts  src/Config.ts
src/Format.ts   src/State.ts   src/Events.ts
```

`src/Git.ts` is excluded: the Cucumber harness stubs git at the Effect boundary,
so `Git.ts` mutants have zero in-memory coverage.

The HTML report lands in `reports/mutation/mutation.html` (git-ignored).

## Releasing

Releases are automatic. Push releasable Conventional Commits (`fix:`, `feat:`,
or breaking changes) to `main` and the Release workflow runs the tests, then
`npx semantic-release`. Semantic-release computes the next version, writes it
into `package.json`, builds the bundle, commits the bump back as
`chore(release): X.Y.Z [skip ci]`, tags `vX.Y.Z`, and creates the GitHub release
with `gtd.bundle.mjs` attached.

## License

MIT
