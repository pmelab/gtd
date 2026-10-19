# Driver protocol

## Driving the loop

gtd itself is not a loop — it decides and prints, full stop; driving a loop is a
driver's job. The minimal driver below (see
[A complete minimal driver](#a-complete-minimal-driver)) is that driver: save it
as `~/.local/bin/gtd-build`, `chmod +x` it, and run it from a repository root —
it takes no arguments and runs the loop until it's your turn. It drives the
autonomous steps (agent turns, check runs) and stops at the first non-autonomous
one: reaching a human gate it prints the gate's message and exits. You act by
editing files (answer a plan question, tick a review box, fix code) and
re-running it — your pending edit arrives as the loop's first beat
(`kind: "capture"`, landed immediately), so you never run `gtd land` by hand.

Some gates could accept by INACTION instead: a workflow may declare a human step
with `acceptClean: true`, so changing nothing there means "accept as-is" rather
than nothing happening. That reaches the driver as `kind: "message"` either way,
which no inspection can tell apart from a gate you have not read yet — so the
driver treats its OPENING beat as yours regardless and lands it: you re-ran it
while resting there, and that invocation IS the decision. Every later beat halts
as usual, because a gate the driver produced mid-run is one you have not seen.
An approval gate (`approve: true`; the shipped flow rests at none, and a
refactor's review sign-off is not one) is the strictest case: a workflow's
`seamGate` rests at it with a `message` that is a seam report listing the strays
the judge saw, and it asks you to land a clean tree with `gtd land` to approve,
or `gtd abandon` to stop. Any edit makes the landing refuse with exit `1`, so
the gate stays. An edit made after `gtd land` printed its script but before the
script ran makes the script itself fail with nothing committed: revert the edit
and land again. Re-running a driver that lands its opening beat approves the
gate — read the report first; the commit records who approved it in a JSON
`Gtd-Approved:` trailer. Git hooks do not run on the approval commit;
`commit.gpgSign` still applies, so a failing signer refuses the approval.
`gtd next --json`'s `approvals` lists them for the current process (`[]` when
none): `{ step, name, email, commit }`, oldest first. Landing an opening beat at
a gate without `acceptClean` is harmless — a benign no-op (see `gtd land`'s exit
codes below) — and the gate then prints on the next beat. A mid-process restart
simply resumes driving from whatever beat is actually next.

Anything richer at that boundary — opening your editor, desktop notifications,
terminal-multiplexer status — is the job of an outer wrapper around the driver,
not of the loop itself; see
[Terminal-multiplexer status: a herdr wrapper](#terminal-multiplexer-status-a-herdr-wrapper)
below for a worked example.

A workflow step can declare an optional `label` — a human-readable display name
surfaced in `gtd next --json`/plain `gtd next`. The driver uses it for its
per-beat progress lines; an outer wrapper (a terminal multiplexer, a notifier)
can use it the same way.

An agent step may also carry `model` and `system` (set on the step, or for a
whole group of steps with `scope({ model, system }, fn)`). `system` is passed to
the agent CLI as (in the reference driver's case) `--system-prompt`, which
**replaces** the harness's own default system prompt outright rather than
appending to it (contrast with an `--append-system-prompt`-shaped flag) — so a
step declaring `system` loses not only the harness's own tool-use instructions
but also its dynamic per-turn sections: current working directory, environment
info, memory-path information, git status. A workflow author reaching for
`system` for the first time is therefore writing a complete replacement system
prompt, not a tweak on top of the harness's own. Every agent step in one memory
scope (below) must run with the same `model` and `system` — one scope is one
conversation, and a conversation has one identity. The bundled workflow ships
six such personas — design, architect, reviewer, builder, finisher and
escalation. Each carries only its role paragraph; a shared block of agent
conduct (tool-use conduct, orienting with git since there is no injected status
block, and inspecting what the turn's own message names) is appended after it
everywhere, so the identities differ only in role, never in how they're told to
behave.

Memory follows the step name. A step's **memory scope** is its name up to the
last dot — the `scope()` prefixes around it — so `build.fix` and
`build.review.reviewing` are in scopes `build` and `build.review`, and a step
with no prefix is in `root`. An agent rest's `memory` key — surfaced in
`gtd next --json`'s `memory` field, and as a `Memory: <key>` line in plain
`gtd next` — is `<scope>#<hash7>`, where `<hash7>` anchors to the commit the
CURRENT unbroken run inside that scope started FROM. Dipping into a
**descendant** scope (from `build` into `build.health`) does not break the
parent's run — an agent turn in `build.health`, then back to `build`, still
resumes the SAME `build` conversation; entering a **sibling or unrelated** scope
does start a fresh one. The bundled workflow's review tail is a worked example:
it sits inside `build` (as `build.review.*`) so that a `gtd --workflow fix` run
— `build.fix` → `build.health.check` → `build.review.*` — stays inside one
subtree. (An actionable review round breaks the run on purpose instead: it
leaves `build` through the root-level `re-unwind` step and a full re-plan, since
a hand-edit made during review is a sketch to reconsider, not a fix to build
on.) The same steps placed under two different prefixes (`build.health` and
`packages.item.health`) gets two different scopes, so a reviewer's turn never
resumes an implementer's session as long as the two live in different scopes.

`gtd` itself stores NOTHING to make this work: `session.id` is
`UUIDv5(<fixed gtd namespace>, <memory key>)` — a deterministic hash of the
computed `<scope>#<hash7>` key above — so the same scope-run always re-derives
the exact same id, and there is no table, no file, no write to keep in sync.
`session.resume` is `true` iff a prior `prompt` turn already landed within that
same scope-run. Because nothing is written, calling `gtd next --json` twice in a
row — a driver's own opening peek, a status poll, a curious human — derives
IDENTICAL `session.id`/`session.resume` values both times, since there is
nothing to poison: looking is free, and there is no separate claiming form to
protect. The per-scope survival story (a child scope's own excursion doesn't
disturb the parent's session) falls out of the key itself, not out of a
per-scope row: the parent's anchor commit is unaffected by whatever the child
scope does in between. A driver maps `session.id`/`session.resume` straight onto
the agent CLI's own session flags — the minimal driver below passes them as
`--session-id <id>`/`--resume <id>` to `claude -p`, but treats `resume` as a
HINT rather than a contract: it tries the flag `resume` points at first and
falls back to the other on failure. That fallback is what recovers BOTH
mismatches that would otherwise need manual intervention — a crashed prior turn
that minted an id but landed no commit (so the next lap re-derives the SAME id
with `resume: false`, and `--session-id` on an already-used id fails, so the
driver falls back to `--resume`), and the inverse (`resume: true`, but the
remembered session is gone — retention expired, `~/.claude/projects` wiped — so
`--resume` fails and the driver falls back to `--session-id`). There is no file
to delete and nothing to restart.

### The bundled driver: `gtd loop`

`gtd loop` is this protocol, shipped with gtd: run it from anywhere inside a
repository and it drives the process until it rests on you. It reads one
`gtd next --json` document per beat, refuses any document whose `schema` it does
not speak, runs the agent turn or script the beat demands, and lands the result
through `gtd land --json`'s script. It always drives the gtd it was started
from, never another one on `$PATH`.

- **At a human gate** it prints one line naming the step (and its `label`) and
  exits 0; the gate's own message goes to the log. The opening beat is yours, as
  above: it lands even at a clean gate.
- **At idle, or when a landing settles,** it exits 0.
- **On a stall, a failed turn or landing, or validation still failing after
  three fix turns,** it exits 1.
- **Agent turns** run `claude -p` (or `pi -p`) in the repository root with the
  prompt on stdin, the beat's session id behind `--session-id`/`--resume`
  (trying the `resume` hint's flag first, then the other), its `model` and
  `system`, and background tasks disabled. A turn's reported cost is recorded on
  the landing with `--cost`/`--model`, failed and fix turns included.
- **The log** is the file `gtd next --json=log` names: truncated when the run
  starts, then every turn's output, script output and gate message. The terminal
  carries only beat headers, landed subjects and the final line.

- **At a judge gate** it pipes the beat's `judge` document through
  `gtd judge run` — whose own settings pick the provider, see
  [The `judge:` key](./configuration.md#the-judge-key) — and lands the verdict
  through `gtd judge answer --json`'s script. If either command fails, or the
  same gate comes back on the very next beat, it stops there with the reason in
  the log — on the opening beat too, landing nothing, so the conservative
  default is never taken unseen. **That document's evidence, diffs included,
  goes to the provider**: with `TYPESAFE_API_KEY` exported that is TypeSafe's
  API unless something picks another — `GTD_JUDGE_PROVIDER` or your user-level
  `judge.json`.

**Per-machine settings.** Which agent CLI runs a turn and which real model a
workflow hint means are your machine's business, never the repository's. Each
setting is read from an environment variable first, then from an optional JSON
file, then from the default:

| Setting            | Environment variable    | File key        | Default                                |
| ------------------ | ----------------------- | --------------- | -------------------------------------- |
| Agent CLI          | `GTD_LOOP_AGENT`        | `agent`         | `claude`                               |
| Model for `<hint>` | `GTD_LOOP_MODEL_<HINT>` | `models.<hint>` | none                                   |
| Model for `smart`  | `GTD_LOOP_MODEL_SMART`  | `models.smart`  | `opus` with `claude`, none with `pi`   |
| Model for `base`   | `GTD_LOOP_MODEL_BASE`   | `models.base`   | `sonnet` with `claude`, none with `pi` |

`<HINT>` is the hint in upper case, with every character other than a letter or
digit replaced by `_`. An unmapped `smart` or `base` is dropped, so the agent
runs its own default model; any other unmapped hint is passed through unchanged,
so a workflow may name a real model outright. An empty variable counts as unset.
`GTD_LOOP_AGENT` accepts `claude` or `pi`.

The file is `$GTD_LOOP_CONFIG` when set, else `$XDG_CONFIG_HOME/gtd/loop.json`,
else `~/.config/gtd/loop.json`. A missing file is fine; an unreadable or invalid
one, or an unknown key, stops the loop before its first beat:

```json
{ "agent": "claude", "models": { "smart": "opus", "base": "sonnet" } }
```

### Terminal-multiplexer status: a herdr wrapper

[herdr](https://herdr.dev) shows a per-pane status in its sidebar. This wrapper
reports `gtd`'s own lifecycle to that status without any herdr-specific
knowledge in `gtd` itself: `working` while the loop drives, `blocked` when it
comes to rest on a human (a gate, a stall, a non-zero exit), and `idle`
(rendered as "done" once the pane's tab is unfocused) when a run ends without
anything owed. It needs nothing from `gtd` beyond `gtd next --json=actor` — a
strictly read-only orientation peek.

Save this as `~/.local/bin/gtdh`, `chmod +x` it, and run `gtdh` in place of
`gtd-build` — it's a plain bash file, so it works from fish or any other shell.

```bash
#!/usr/bin/env bash
# Report gtd's own lifecycle to the herdr pane it runs in: working while the
# loop drives, blocked when it rests on you, idle (shown as "done") otherwise.
# Needs nothing from gtd but `gtd next --json=actor`. Outside herdr it is a
# plain passthrough.
set -uo pipefail

pane="${HERDR_PANE_ID:-}"

# `--agent gtd` is deliberate: herdr only lets screen detection (or a visible
# approval prompt) override a reported state when the reported label names a
# KNOWN agent. "gtd" names none, so the loop's `claude -p` turns can never move
# this pane's status.
report() { # report <state>
  [ -n "$pane" ] || return 0
  herdr pane report-agent "$pane" \
    --source custom:gtd --agent gtd --state "$1" >/dev/null 2>&1 || true
}

report working
trap 'report blocked; exit 130' INT TERM

# HERDR_PANE_ID is unset for the loop: herdr's Claude Code hook needs it, and
# without it no `claude -p` turn reports a claude SESSION identity for this
# pane. That is load-bearing, not cosmetic — a pane that owns one rejects every
# later state report, so the report below would be dropped.
env -u HERDR_PANE_ID gtd-build
rc=$?

# Whose turn is it now? `gtd next --json=actor` is a strictly read-only peek —
# every gtd command is, including `gtd next` (its prompt session id is
# derived, never minted/stored) — only the emitted scripts a driver runs
# actually touch git. An ALLOWLIST, not a denylist: only `agent`/`check` mean
# this driver just handed off and nothing is owed; every other actor this
# driver doesn't recognise — human, judge, a future workflow's own invention,
# or an empty/failed read — means someone is owed a turn, so it reports
# blocked rather than guessing idle on a name it has never seen.
actor="$(gtd next --json=actor 2>/dev/null)" || actor=""

if [ "$rc" -eq 0 ] && { [ "$actor" = agent ] || [ "$actor" = check ]; }; then
  report idle
else
  report blocked
fi

exit $rc
```

A few things to know before relying on it:

- **Give `gtd` its own pane.** Run an interactive `claude` (or any agent whose
  herdr integration reports session identity) in the same pane and that pane
  owns a `herdr:claude` session until the process exits; while it does, the
  wrapper's reports are silently ignored and the sidebar stops tracking `gtd`.
- **`blocked` covers the resting `idle` state too** — gtd's own `idle` is a
  human gate (it waits for you to write a steering file), so a finished process
  reads as "your turn", which is what it is.
- **A judge gate reports `blocked`, same as a human gate** — this wrapper
  doesn't know the word `judge` and isn't supposed to guess; see
  [Judge gates](#judge-gates-an-aware-drivers-env-var-mapping) for the same
  allowlist rule stated for a driver author.
- The status **persists after the wrapper exits** — that's the point: the
  sidebar keeps showing which worktree is waiting on you. Hand the pane back to
  ordinary detection with
  `herdr pane release-agent "$HERDR_PANE_ID" --source custom:gtd --agent gtd`.
- A non-zero exit (a stall, a refusal, an error) reports `blocked`: herdr has no
  failure state, and those all need a human.
- Ctrl-C reports `blocked` rather than leaving a stale `working`.

Optionally,
`herdr pane report-metadata "$HERDR_PANE_ID" --source custom:gtd-display --token summary=<text>`
sets a value renderable as `$summary` in an Agent sidebar row, if you want more
than the state itself.

### Inside Claude Code: the gtd mod

The gtd repository is also a Claude Code plugin marketplace, and the
`@pmelab/gtd` npm package is its `gtd` plugin: a mod that drives this same
protocol from an interactive session, with no `claude -p`. It needs Claude Code
2.1.287 or later and `node` and `npm` on your `PATH`:

```sh
claude plugin marketplace add pmelab/gtd
claude plugin install gtd@gtd
```

The plugin runs the gtd of its own package version, so mod and CLI always match.
The first `/gtd` after an install or update fetches gtd's runtime dependencies
into the plugin's folder, once. Inside the session the plugin's `gtd` comes
first on `PATH`, so agent beats and scripts run that same version; a global
`npm install -g @pmelab/gtd` is only for your own terminal. An update to a
version whose workflow changed can strand a process already underway, as with
any gtd upgrade: finish or ship it before updating.

To try a checkout instead, build it (`npm run build`) and load the repository
for one session: `claude --plugin-dir /path/to/gtd`. A checkout without a build
falls back to the `gtd` on your `PATH`.

- `/gtd <requirements>` starts a new process: the requirements are written to
  the top of the steering file the idle rest names (`.gtd/TODO.md`), above
  whatever it already holds — deferred review notes stay — and the opening beat
  captures them. It refuses while another process is underway. A long,
  multi-line paste works too; if Claude Code did not expand it, the mod says it
  could not read it: add the requirements to the top of `.gtd/TODO.md` and run
  `/gtd`.
- `/gtd` drives beats until the process rests on you, exactly as the minimal
  driver below does: the opening beat lands, a later gate stops. At idle with
  nothing pending it only tells you how to start.
- At every rest that needs you (a human gate, a judge gate its judge could not
  decide, a stuck or failed step, a finished process with a pull request to
  open) the mod hands the session's own model one prompt: the step's label, its
  steering file, and gtd's message for it, verbatim. The model helps you through
  it in plain words. At a question gate it walks the open questions one at a
  time as Claude Code's question dialog (herdr marks the pane as waiting on you,
  and Collie shows tappable answers) and records each answer in the steering
  file the way the message describes. It answers your own questions read-only,
  and offers to file one as a thread for gtd's agent when the answer should
  change the plan. At a review gate it walks you through the diff and records
  your notes. At an undecided judge gate it puts each judge question to you. A
  stop you asked for (`/gtd stop`, a hand-off) wakes nothing.
- The model moves gtd only through tools the mod serves, never through `gtd`
  itself: `continue` (only after you said to; it refuses once gtd has left that
  rest, and runs the step's `gtd validate` first, sending any findings back
  instead of landing), `note`, `handoff`, `ship` and `browser`. A review gate
  you leave untouched signs off, from every driver. `ship` and `handoff` refuse
  while a step runs (`ship` also while gtd waits on you) and leave the rest
  open, so `continue` still works.
- While a step runs, the session's model may not edit files (Bash is not
  checked): ask questions and it answers read-only, or ask for a change and it
  is kept as a note for the next rest. At a question gate it may write only that
  gate's steering file; at a review gate, code edits count as review feedback.
- `gtd ui` starts only on request: ask Claude for the browser view, or run
  `/gtd ui`. Its exit never moves the process on.
- The band above the prompt keeps a **Continue** button at every rest, which
  does what `continue` does without the model.
- While a step runs, the band above the prompt reads like Claude Code's own
  spinner, `✳ gtd ▸ Checking the baseline… (3m · step 3)`, so herdr shows the
  pane as working, even while the session itself waits on a test run. Each step
  also prints one line to the transcript and the status line. A rest, a finish
  or a failure raises Claude Code's push notification, which it sends only while
  you are away from the terminal.
- Saving the plugin's own files reloads it. A reload in the middle of an agent
  step waits for that agent and lands its work instead of starting it again,
  unless the agent failed or was killed: then the step runs again. A reload in
  the middle of a script stops the loop, since the script may have partly run;
  check the tree, then **Continue** runs it again. A reload at a gate leaves it
  as it was.
- `/gtd <door> [args]` starts a process through one of the doors `gtd doors`
  lists, runs the script `gtd door` prints, then drives like `/gtd`. The bundled
  doors are `fix` (repair a red baseline as its own reviewed commit),
  `review [base]` (a pure review of everything since the merge-base with `base`,
  the default branch unless named), and, only where the config exports them from
  `@pmelab/gtd/workflows/rollout` and `@pmelab/gtd/workflows/cleanup`,
  `rollout <flag>` (turn a release flag default-on) and `cleanup <flag>` (remove
  it). `/gtd <verb> …` enters a door only when one by that name exists and the
  word count fits its args; otherwise the text, bare `/gtd rollout` included,
  starts a process as requirements.
- `/gtd stop` stops after the current beat. `/gtd status` prints `gtd next`.
  `/gtd ui` starts the browser view of the rest it waits at.
- `/gtd throw`, `/gtd ship [-n]` and their tools (`handoff`, `ship`) answer at
  once and run in the background, one at a time; progress shows on the status
  line. While one runs or is queued, `/gtd catch`, `/gtd <door>`,
  `/gtd <requirements>`, `/gtd ui` and bare `/gtd` refuse with "wait for its
  report"; `/gtd throw` and `/gtd ship` refuse for themselves on the same
  grounds, and only `/gtd status` and `/gtd stop` always work. When the job ends
  it reports by waking Claude, a toast, a transcript line and a push
  notification. A failed `git push` or `gh` call reports as a failure naming the
  step; a failure after the squash keeps the squash, and `/gtd ship` again
  pushes the already-squashed branch.
- `/gtd throw [@user]` hands the process to someone else. It needs a clean tree:
  proceed or stash a half-made answer first, and refuses when `origin` holds
  commits your branch lacks. It pushes the branch (moving the process to a new
  `gtd/<timestamp>` branch when you are on the default one), opens a draft pull
  request for the hand-off, or refreshes a thrown one (a pull request already
  open for review keeps its description and stays ready), and assigns it to
  `@user` in place of its previous assignees. Without a user it is left for
  anyone. At any gate you can also ask Claude to hand it off.
- `/gtd catch <pr|branch>` checks the thrown branch out with `gh pr checkout`,
  assigns it to you, and Claude helps you through the gate it waits at; it never
  lands that gate before you have seen it. Agent conversations do not travel:
  each memory scope starts fresh for the catcher.
- `/gtd ship` squashes the finished process, one commit per slice (the process's
  turns are already kept under `refs/gtd/history/`, written before the squash by
  the landing that finished it), pushes that process's history ref before the
  squash by force, so a retry after the tip changed replaces origin's copy of
  that one ref (another clone shipping the same process replaces it), and
  records it as a `Gtd-History: <ref>` trailer on every slice commit (a failed
  history push fails the ship with nothing squashed; a push that did not finish
  says so, and retrying is safe), pushes the branch, and opens its pull request,
  or appends to the open one's description when something changed at the level
  of its motivation, solution or decisions. A subagent writes each slice's
  commit message (from `gtd summary --slice=<name>`) and the pull-request text;
  nothing reviews them before they are published. Ship refuses while the process
  is still underway. The commit message keeps a `BREAKING CHANGE:` footer when
  the change is breaking, and the process's last commit keeps a `Closes #N`
  footer when the process was started for an issue (its capture or
  `.gtd/REQUIREMENTS.md` names it). Ship copies every `Closes`, `Fixes` or
  `Resolves #N` line of a pull request's commits into its description, new or
  open, so the top pull request links the issue (GitHub links a stacked one once
  it targets the default branch); in a stack the top pull request takes every
  slice's lines and a lower one none, since it merges first. The writer may run
  only read-only `git` commands and write only its own answer, since it reads
  commit messages anyone on the branch wrote. `/gtd ship -n` prints each slice's
  commit message and what would happen to its pull request, and writes nothing.
  It needs `gh`, a clean tree, and a branch other than the default. When a
  process finishes on such a branch, Claude offers to open the pull request. On
  a thrown draft, ship writes the title and description properly and marks the
  pull request ready for review. `GTD_SHIP_MODE` picks how a multi-slice process
  ships: `stack` (the default) puts each slice's commit on its own branch,
  `<branch>-<slice>` (the last slice keeps `<branch>`), and opens one pull
  request per slice, each on the one below it and opening with
  `Stacked on #N — merge that first` (the lowest targets the default branch);
  `commits` keeps every slice commit on `<branch>` under one pull request, which
  needs a rebase merge to stay one commit per slice (ship warns when it cannot
  confirm that; a squash merge still collapses it). Any other value is refused.
  A single slice on a branch without a recorded stack ships as one commit and
  one pull request; in `stack` mode a single slice on a stacked branch lands on
  the top branch and keeps the stack, and `GTD_SHIP_MODE=commits` ships it
  alone. A slice that changed only `.gtd/` lands nothing, and a slice still open
  refuses the ship. A pull request that is merged or closed, or an existing
  `<branch>-<slice>` branch the stack did not build, refuses before anything
  changes: for a lower slice's pull request of a fresh multi-slice stack, use
  `GTD_SHIP_MODE=commits` (a resume or a single-slice re-ship skips a lower
  slice merged into the default branch instead); a merged or closed top pull
  request, or a branch the stack did not build, needs a renamed branch. A fresh
  multi-slice stack ship on a branch whose recorded stack is still live refuses
  too, naming `GTD_SHIP_MODE=commits` or unsetting `branch.<branch>.gtdStack`
  and `gtdStackTop` and deleting or renaming the old slice branches (a record
  that no longer chains to HEAD is dropped, not refused; a hand-restacked record
  is live). A `gh pr view` failure other than "no pull request" refuses before
  that step's writes. Slice commits keep `commit.gpgSign` but run no
  `commit-msg` hook. A failure part-way keeps what landed and names the slice
  and step; run `/gtd ship` again to resume, and once a lower slice's pull
  request has merged, a resume skips it and targets the default branch.
  Squash-merging or rebase-merging a lower stacked pull request rewrites its
  commit, so run `/gtd ship` again: it fetches the default branch and rebases
  the remaining slice branches onto `origin/<default>` in one
  `git rebase --update-refs` (git 2.38 or newer; the local default branch is not
  touched), pushes each moved branch with a lease on origin's own commit,
  retargets the lowest remaining pull request to the default branch and shrinks
  the recorded stack to the remaining slices (it ends when only the top branch
  remains). The restacked branches keep their pull requests, and the merged
  slice's `<branch>-<slice>` branch is left alone, locally and on origin. With
  new work at HEAD the ship squashes it first, then restacks, in the same
  `/gtd ship`; `-n` prints the planned rebase, pushes and retarget from the last
  fetch of `origin/<default>` and writes nothing. A merge commit keeps the
  slice's commit in the default branch, so that case only retargets. If origin's
  copy of a branch the restack moves holds commits the local branch lacks, the
  ship refuses before changing anything: pull or reconcile that branch first. A
  conflicting rebase is aborted, leaving the tree and refs as before the ship
  (if the abort itself fails the failure says the repository is mid-rebase and
  to run `git rebase --abort` by hand), and the failure names the slice and the
  step and prints the
  `git rebase --update-refs --onto origin/<default> <commit> <branch>` line to
  run by hand (after a squash in that same `/gtd ship` the squash is kept, and
  the failure prints the `git reset --soft` to undo it). The restack refuses,
  with nothing changed, when a pull request merged anywhere but the default
  branch, unless into a lower slice branch before that one merged into it (ship
  the branch alone with `GTD_SHIP_MODE=commits`) or when a remaining lower slice
  branch is checked out in another worktree, where `--update-refs` would skip it
  (`-n` shows that refusal too; free the branch with `git switch --detach`
  there). If the rebase still leaves such a branch unmoved (a worktree
  mid-rebase, say), the slice branches and HEAD are restored and the ship
  refuses, with nothing pushed or recorded; if that restore itself fails, the
  refusal prints the `git update-ref` and `git reset --keep` lines to run by
  hand. The same rollback runs when the rebase exits non-zero after it moved
  HEAD or a slice branch, and when a remaining slice is left with no commit of
  its own because its change is already in `origin/<default>` (the refusal names
  the slice; ship the branch alone with `GTD_SHIP_MODE=commits`). The restack
  also refuses, under `-n` too and with nothing changed, when another local
  branch points into the commits being rebased, since `--update-refs` would move
  it as well: move or delete it. Each moved branch's lease (origin's commit
  before the restack) is kept in `branch.<branch>.gtdLease` until a push of that
  branch succeeds, so a push rejected because a collaborator pushed first is
  still refused when you fetch and ship again; to overwrite origin's copy on
  purpose run `git config --local --unset branch.<branch>.gtdLease` first. The
  next `/gtd ship` spots a hand restack (the lowest remaining slice branch no
  longer holds the merged slice's commit and sits on a commit of
  `origin/<default>`; when only the top branch remains, which may span several
  commits, its first commit above `origin/<default>` must be a copy of the
  recorded top's first commit, same author, date and message), pushes each with
  a lease on origin's own commit (refusing if origin holds a commit the local
  branch has no copy of, same author, date and message), retargets the lowest
  remaining pull request and keeps the stack; a rebase that does not fit that
  shape drops the record and ships the branch alone. A commits-mode re-ship of a
  stacked branch retargets its pull request to the default branch and leaves the
  lower slices' pull requests open; close them by hand. A pull request on a base
  that is not a slice branch keeps its base, a thrown draft in a stack is
  retargeted like any other, and a missing slice branch is rebuilt from the
  commits the stack was built at while the branch still contains them, otherwise
  the ship refuses and names `GTD_SHIP_MODE=commits` to ship the branch alone.
- Each `prompt` beat runs as a subagent. Beats in the same memory scope continue
  the same subagent for as long as the session lives; a new session starts the
  scope fresh, as the minimal driver does when a remembered session is gone. A
  change to that scope's skills or system starts a fresh subagent on the next
  beat, losing the scope's earlier conversation, and says so in the transcript.
  When a scope's subagent is gone mid-step, a validator's findings or an access
  refusal go to a fresh subagent together with the step's prompt, and the gone
  subagent's task is stopped, rather than failing the step; the transcript says
  so.
- A step's `system` becomes the subagent's whole system prompt, and its `model`
  the subagent's model. Each subagent sees only its scope's `skills`.
- **The mod's subagents run with `bypassPermissions`**, the equivalent of the
  minimal driver's `--dangerously-skip-permissions`. Shell commands they run are
  kept in the foreground, with a 10-minute timeout.
- A subagent's hand-back is dropped before it reaches the session, so the main
  conversation never takes a turn because a beat finished.
- A judge gate is answered with `gtd judge run` when `GTD_JUDGE_PROVIDER` names
  `fixed` or `jev`, or when `TYPESAFE_API_KEY` (or `TYPESAFE_AI_KEY`) is set and
  `GTD_JUDGE_PROVIDER` is not `llm`. Otherwise a small subagent answers it with
  the same prompt gtd's `llm` provider sends, on `GTD_JUDGE_MODEL` (haiku by
  default, while `gtd judge run --provider llm` defaults to `sonnet` — the two
  judge on different models), with no `claude -p`. Only when neither produces a
  complete verdict does Claude ask you — on the opening beat too, where nothing
  lands unanswered. Your answers land as the verdict; continuing without
  answering lands it unanswered, which routes the workflow its cautious way.
- Script and check beats append to the log `gtd next --json` names.
- The mod checks the [`schema`](./cli.md#schema) of every document it reads and
  stops on one it does not read, naming which side to upgrade: the plugin when
  gtd is newer, gtd when the plugin is.

## Writing your own driver

Run `gtd install` to print this whole chapter's protocol as a complete,
self-contained briefing — paste it into an agent's context (or read it yourself)
to build a driver without leaving your terminal. The briefing ends by directing
the agent to INTERVIEW you first — which agent CLI runs the turns, under what
permission model, how you want to invoke the loop, what should happen at a human
gate — and to build the driver your answers describe rather than copying the
reference sh. It writes nothing: "install" means installing knowledge into the
calling agent's context, and the briefing it prints is always exactly as current
as the `gtd` that printed it.

The minimal driver below is gtd's own reference driver, not a privileged one —
the engine itself is a supported public surface, and anything below holds for
any driver you write against it. gtd decides and prints; it never commits, never
moves HEAD or a ref, and never writes the git index — every git write is in a
script the driver runs. The five commands that change anything — `gtd land`,
`gtd --workflow <name>` (and `gtd door`), `gtd abandon`, `gtd restore`, and
`gtd judge answer` — perform no git write when run: each one's `--json=script`
form carries ONE POSIX sh script for YOU to execute — a leading comment ("gtd
emitted this and did NOT run it — pipe it into `sh` to land the turn"), then the
REQUIRED half verbatim, then, only when there's a presentation-only follow-up, a
second comment ("presentation only — safe to skip") and the OPTIONAL half
wrapped in a subshell whose own non-zero exit is swallowed (reported to stderr
as a warning, never turning a landed turn into a failing one). Plain `gtd land`
(and plain `gtd judge answer`) is the one exception: it prints a human-readable
sentence, never a script (see below) — a driver reads the script from
`--json=script` instead. Printing gtd's output and never running it is not
driving anything; a driver must pipe or execute what gtd prints — e.g. the
capture-then-pipe form the reference driver below uses, via
`gtd land --json=script`.

Every script gtd emits — `gtd land --json=script`, `gtd --workflow <name>`,
`gtd door <name>`, `gtd abandon`, `gtd restore`,
`gtd judge answer --json=script`, and the format/validate script `gtd validate`
prints — is POSIX `sh`, portable to `dash`: a driver may run any of them with
any POSIX-compliant shell, not specifically bash. The same convention extends to
the bundled workflow's `testCommand` environment setting (what its checks run
through `sh -c`): it is expected to be POSIX sh-compatible too, but this is a
DOCUMENTED CONVENTION only — gtd never inspects or validates `testCommand`'s
shell dialect itself.

A `script` beat's content is the whole script, rendered from values the flow
already decided — for the bundled workflow, its checks (which run
`testCommand`), `unwind` and `re-unwind` (which reverse-apply patches to the
working tree), and a few `rm`/`mv` bookkeeping steps. gtd itself runs none of
them and writes nothing but `gtd uncheck`'s and `gtd ui`'s steering-file edits;
what a script leaves is landed like any other check turn, by `gtd land`'s
script, whatever its exit code.

- **The required half** is everything that decides what lands in git — the
  commit itself (`gtd land`, `gtd --workflow <name>`, `gtd door`, and
  `gtd judge answer`, the last carrying one `Gtd-Judge:` trailer per answered
  question alongside its ordinary commit), or the ref update and reset that undo
  a process (`gtd abandon`, `gtd restore`) — and, last, a printed line naming
  what just landed: a transition or capture's changed-file rows, or the
  abandon/restore prose, resolved from the repository AFTER the write above it.
  Its own exit code IS the printed script's exit code — skipping it means the
  turn never lands, and you never see what it did. A resting step's own
  steering-mode `format:`/`validate:` commands are NOT part of this script —
  they're a separate driver contract via `gtd next --json`'s own `validate`
  field (see `gtd install`'s obligation 6).
- **The optional half** is presentation only, wrapped in a subshell whose own
  failure is swallowed (a warning on stderr, nothing more) — skip it (or let it
  fail) and the workflow is still driven correctly either way. No command
  currently populates it; it is kept as a stable slot for a future
  presentation-only follow-up.

`gtd next --json` carries two more fields worth a custom driver's attention:

- **`log`** — the per-worktree loop log path, always present. It's derived from
  the worktree's own git dir, so two worktrees looping concurrently never share
  one file; set `$GTD_LOOP_LOG` to override it verbatim, or `$GIT_DIR` to name
  the git dir directly (both honored the same way every git subprocess already
  honors them — an inherited `$GIT_DIR` moves the log path along with it). gtd
  itself neither creates nor truncates this file — a driver appends subprocess
  output to it and truncates once at the start of a run, exactly like the driver
  above does.
- **`skills`** — the skill names of the turn's memory scope, only ever carried
  at `kind: "prompt"` (absent means none). A driver that can restrict a turn's
  skills SHOULD pass exactly this list — restricting the agent to it is the
  recommended use — or preload the named skills, pass them as flags, or route
  the turn to a subagent that has only them loaded. Reading it is still not
  required: a driver that ignores it drives correctly, because the preamble in
  `content` already names what the turn needs and does not depend on `skills`
  being read.
- **`access`** — `{ "read": string[] | null, "write": string[] | null }`, only
  ever carried at `kind: "prompt"`, always present there. Globs in the
  `glob()`/`changes()` dialect (`*` within a path segment, `**` across), already
  including the step's own steering file; `null` means that side is
  unrestricted. `read` and `write` are independent — a `write` glob grants no
  read. A driver that can restrict file reads SHOULD pass `read` to its agent;
  gtd cannot check reads. `write` is enforced by gtd itself: `gtd land` refuses
  a turn that changed a path outside it (exit 1, nothing lands, the process
  stays put) and its message names the offending paths and the allowed globs —
  revert them and land again. gtd runs no fix turn for this, so a driver treats
  the refusal like any other failed landing. `--json=access.write` prints
  nothing for an unrestricted side.

  **Mapping `access` onto Claude Code.** The reference driver below enforces
  nothing: reads are unrestricted, writes rely on the landing check alone, and
  on a violation `gtd land` exits 1 and the driver stops. A driver that wants
  more can build on these documented Claude Code facts
  ([permissions](https://code.claude.com/docs/en/permissions),
  [permission modes](https://code.claude.com/docs/en/permission-modes),
  [sandboxing](https://code.claude.com/docs/en/sandboxing)):
  - `permissions.deny` rules block in every mode, including `bypassPermissions`
    (what `--dangerously-skip-permissions` selects).
  - `Read(<glob>)` and `Edit(<glob>)` deny rules cover Claude's file tools and
    the file commands it recognizes in Bash (`cat`, `sed`, `tee`, redirections),
    not arbitrary subprocesses such as a script that opens files itself. A
    `Read` deny also blocks Edit and Write on that path. Rule paths are
    gitignore-style (`//path` absolute, `/path` project-relative), and a `!`
    deny entry carves paths out of earlier relative rules in the same settings
    source. Two documented limits: a `!` pattern is read relative to the current
    directory and cannot reach a rule anchored with `/`, `~/` or `//`, and a
    carve-out cannot reopen a file inside a directory that a rule blocks as a
    whole. Permission rules therefore cannot express "deny everything outside
    these directory globs"; a driver that needs that checks paths in a hook
    instead, as the bundled mod does.
  - `sandbox.filesystem` limits Bash and its subprocesses at the OS level, not
    the file tools: `allowWrite`/`denyWrite` for writes, `denyRead` with a
    narrower `allowRead` re-opening part of it for reads. Sandbox paths use `~/`
    and plain relative conventions, unlike the `//`-style rule paths.

  The gtd mod does the tool-level part: it denies Read, Edit, Write and
  NotebookEdit calls (and Glob/Grep roots) outside a turn's `access` and leaves
  Bash open, so its enforcement is best effort and `gtd land` stays the backstop
  for writes. After a refused landing it re-prompts the turn once with the
  refusal text and lands again. For any other driver, that recovery is its own
  job; gtd runs no fix turn for it.

  **`read` is not a security boundary unless the driver enforces it at the OS
  level** (the sandbox's `denyRead`). Writes to gitignored paths escape the
  landing check, since gtd only sees changes git reports.

Even a genuine no-op `gtd land` (a clean landing that completes nothing) has a
PRINT-ONLY script under `--json=script`: no git write, just the same
`nothing to do at "<state>"` line the script prints when a driver runs it —
running it is never optional. Plain `gtd land` at the same no-op prints that
identical line directly, with no script wrapper at all. The `--json=script`
script is self-contained and safe to run standalone, in sequence, or not at all
— paste it into a terminal and it does exactly what it says, printed output
included. Its output is plain ASCII with no colour codes, so it reads the same
in a terminal, a pipe, and a log file.

A driver has no opening move. It does not need to know whose turn it is before
it starts — `gtd next --json=kind` tells it, and a human's pending edit arrives
as an ordinary `kind: "capture"` beat that the driver lands like any other. The
rule this replaces: never `gtd land` outside a beat you dispatched. A stray land
at a clean `prompt` rest authors an empty attempt on purpose (that IS the stall
bookkeeping), so an unconditional opening land would manufacture a stall out of
a fresh start. The one EXCEPTION is the run's very first beat: land it before
trusting `idle` there too, so a workflow whose first step is a human step with
`acceptClean: true` still gets a chance to advance on a human's bare
re-invocation, rather than the driver concluding "nothing owed" without ever
giving that edge a turn (see the reference driver's own comment on this).

Exit code carries none of this any more — every command, `next`/`land` included,
exits `0` on success (see [Exit codes](./cli.md#exit-codes)). Whose turn is
next, and whether a landing settles, are both PLAIN FIELDS on
`gtd next --json`/`gtd land --json`: `next`'s own `kind`
(`capture`/`message`/`script`/`prompt`/`stalled`) and `idle`; `land`'s own
`settled` and `idle`. Read `--json=settled`/`--json=idle` alongside
`--json=script` — one round of reads tells the driver both what to run and
whether to stop, with no second read needed to decide, as long as every value is
read BEFORE the script is piped to `sh` (see the reference driver below, which
reads `settled`/`idle` first for exactly this reason). A no-op at a `script`
rest settles right where it rests (stop immediately, nothing more to read); an
ordinary landing that finishes the whole process instead resolves `idle` on the
FOLLOWING `gtd next` — the reference driver below reads once more only to
DISPLAY that gate's message, never to decide whether to stop. A run step settles
only when replaying its clean landing leads straight back to the same step; a
flow that moves on after a clean run advances instead.

### Drivers other than sh

The protocol above is JSON in (from `gtd next --json` alone), subprocesses out —
sh is one convenient shape, not the only one. A **program** parses
`gtd next --json`, switches on `kind`, and runs `gtd next`'s (plain-text) output
and `gtd land --json=script`'s (POSIX sh) output as subprocesses — no sh
anywhere in it. A **human** runs plain `gtd next` (there is no JSON form of it
at all), does what it says, then plain `gtd land`, which names the commit
subject in one sentence — no script to paste, no shell to pipe into. An
**agent** gets `gtd install` as its instructions — the same protocol, in a form
built to be pasted into a context window rather than read. A **CI job** is the
program case with the `prompt` arm pointed at a headless agent CLI, and
`kind: "message"`/`kind: "stalled"` mapped onto "stop and report".

### What the minimal driver actually reads

`gtd next --json` emits 25 keys (21 of them outside `kind: "prompt"`, which is
the only kind that ever carries `session`/`validate`/`skills`/`access`); a real
driver reads 9 of the 25. The minimal driver below is the reference for exactly
which: `kind`, `idle`, `content`, `log`, `session` (read as its two sub-paths,
`session.id`/`session.resume`), `model`, `system`, `validate`, and `judge` —
every `--json=<path>` selector its `case` arms touch. The remaining 16
(`schema`, `initial`, `state`, `actor`, `workflow`, `label`, `memory`, `file`,
`mode`, `changes`, `next`, `cost`, `costByModel`, `skills`, `access`,
`approvals`) are read only by a human looking at plain output, or by a driver
author deciding what to log or preload — no `case` arm in THIS reference driver
branches on them. This is a property of what a driver NEEDS, not a smaller wire:
every key stays on every `gtd next --json` line, unconditionally, so
`--json=<path>` keeps resolving the same way for a human poking at one field as
for the reference driver reading nine of them in a loop.

(`gtd land --json` is a separate command with its own eight-key document —
`schema`/`script`/`settled`/`idle`/`state`/`subject`/`cost`/`model` — never a
`gtd next` key; see the driver's landing step below for the two of those,
`settled` and `idle`, it actually reads before piping `script` to `sh`.)

### A complete minimal driver

This is the whole protocol described above, compressed into a loop small enough
to paste from this page and own outright — save it as `~/.local/bin/gtd-build`
(`chmod +x`) and it's the ready-to-run driver
[Driving the loop](#driving-the-loop) above points at; swap the `claude` line
for any agent CLI and it keeps working.

This exact fenced block is extracted and executed by
`tests/integration/features/driver-doc.feature` — renaming the heading above or
splitting the block into more than one fence breaks the build.

**Pipe the prompt to the agent CLI on stdin — never pass it as a command-line
argument.** A `prompt` beat's content embeds a full diff, and argv is capped:
roughly 1 MB on macOS, and POSIX guarantees only 4 KB (`ARG_MAX`). Both are
reachable by an ordinary diff, so a driver that passes the prompt as an argument
works in testing and then fails on the first large change, in a way that looks
like an agent error rather than a driver bug. The driver below pipes plain
`gtd next`'s own output into `claude -p` over stdin for exactly this reason — at
a `prompt` rest that plain output IS the bare content (no status header), so no
separate `--json=content` read is needed, and the diff is rendered once instead
of twice.

```bash
#!/usr/bin/env sh
set -eu

# A turn ends when `claude -p` returns, so work it backgrounds dies unread
# and stalls the process. Keep every command in the foreground, with room to
# finish a long suite (Claude Code's defaults: 2 min, capped at 10).
export CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1
export BASH_DEFAULT_TIMEOUT_MS=1800000
export BASH_MAX_TIMEOUT_MS=7200000

beat=1
while :; do
  # One value per invocation: `gtd next --json=<path>` is a pure read (peek
  # or dispatch, indistinguishable, always safe to call again), so nothing is
  # lost by reading `kind`/`idle` as two separate calls rather than one
  # combined document.
  kind="$(gtd next --json=kind)"
  idle="$(gtd next --json=idle)"

  # `idle` (true iff the initial state, clean tree) is the one shape that
  # means the process is genuinely done — EXCEPT on the run's opening beat:
  # land it anyway, so a workflow whose first step accepts a clean landing
  # (acceptClean) still gets a chance to fire.
  if [ "$beat" -gt 1 ] && [ "${idle:-}" = true ]; then
    gtd next
    exit 0
  fi

  case "$kind" in
    stalled)
      gtd next --json=content >&2
      exit 1 ;;
    # you re-ran us resting here: you either edited something or accepted by
    # editing nothing, so land the opening beat either way. Later beats are
    # gates we just produced and you have not read yet — hand off. A judge
    # gate's own `--json=judge` is non-empty here: pipe it through
    # `gtd judge run` and land the verdict via `gtd judge answer`. POSIX sh has
    # no pipefail, so each step is captured first and only piped on when it
    # succeeded; if `gtd judge run` fails or `gtd judge answer` rejects the
    # verdict, its stderr reaches you and we fall through to the human hand-off.
    message)
      if [ -n "$(gtd next --json=judge)" ] &&
        verdict="$(gtd judge --json | gtd judge run)" &&
        script="$(printf '%s\n' "$verdict" | gtd judge answer --json=script)"; then
        printf '%s\n' "$script" | sh
        beat=$((beat + 1))
        continue
      fi
      [ "$beat" = 1 ] || {
        gtd next
        exit 0
      } ;;
    capture) ;; # the human already acted — just land it
    script)
      # A `script` rest's plain output is prose, not pipeable into `sh` — the
      # raw script comes from `--json=content` instead.
      content="$(gtd next --json=content)"
      log="$(gtd next --json=log)"
      sh -c "$content" >>"$log" 2>&1 || true ;;
    prompt)
      session_id="$(gtd next --json=session.id)"
      resume="$(gtd next --json=session.resume)"
      model="$(gtd next --json=model)"
      system="$(gtd next --json=system)"
      validate="$(gtd next --json=validate)"
      log="$(gtd next --json=log)"
      # `model` is a hint, not a model name — the bundled workflow ships
      # `smart` and `base`, which `claude --model` rejects. Resolve them
      # with the variables `gtd loop` reads; unset, the hint is dropped and
      # the agent runs its own default. Any other value is a real model name.
      case "$model" in
        smart) model="${GTD_LOOP_MODEL_SMART:-}" ;;
        base) model="${GTD_LOOP_MODEL_BASE:-}" ;;
      esac
      # The prompt embeds a full diff, so it goes to the agent over stdin,
      # never as an argv positional — argv is capped (~1 MB on macOS, and
      # POSIX guarantees only 4 KB, ARG_MAX), and a diff crosses that far
      # sooner than you'd expect. Piping plain `gtd next` (not
      # --json=content) means the diff is rendered once, for this input,
      # rather than twice.
      agent_turn() { gtd next | claude -p "$1" "$session_id" \
        ${model:+--model "$model"} \
        ${system:+--system-prompt "$system"} \
        --dangerously-skip-permissions >>"$log" 2>&1; }
      if [ "${resume:-}" = true ]
      then agent_turn --resume || agent_turn --session-id
      else agent_turn --session-id || agent_turn --resume
      fi
      n=0
      while [ -n "${validate:-}" ] && ! fix="$(sh -c "$validate" 2>&1)"; do
        n=$((n + 1)) && [ "$n" -gt 3 ] && { printf '%s\n' "$fix" >&2; exit 1; }
        # $fix IS the fix prompt, verbatim — piped for the same reason the
        # agent's own turn above is. Whether `claude --resume` re-applies the
        # original session's model/system prompt is a harness detail gtd
        # cannot verify from outside, so this passes the identical
        # $model/$system on both calls rather than assume it does —
        # otherwise this fix turn might silently fall back to Claude Code's
        # own defaults while the turn that produced the file ran under the
        # workflow's own model and persona.
        printf '%s' "$fix" | claude -p --resume "$session_id" \
          ${model:+--model "$model"} \
          ${system:+--system-prompt "$system"} \
          --dangerously-skip-permissions >>"$log" 2>&1
      done ;;
  esac

  # Read every value the landing needs BEFORE piping the script to `sh`:
  # `gtd land` itself never mutates — it only plans and prints — so
  # `settled`/`idle`/`script` planned against the same untouched tree all
  # agree, whatever order they're read in, as long as all three are read
  # before the script runs and changes the tree out from under them.
  settled="$(gtd land --json=settled)"
  idle="$(gtd land --json=idle)"
  gtd land --json=script | sh
  if [ "${settled:-}" = true ]; then
    [ "${idle:-}" = true ] && gtd next
    exit 0
  fi
  beat=$((beat + 1))
done
```

Line by line it is the protocol described above:
`kind="$(gtd next --json=kind)"` and `idle="$(gtd next --json=idle)"` are two
independent, idempotent reads — each a pure `gtd next --json=<path>` call, safe
to make as often as needed, with no `eval` and no shared preamble to keep them
consistent with each other. The very first beat lands even when `idle` is
already true, so a workflow whose first step is a human step with
`acceptClean: true` still gets a chance to fire before the driver calls it done.
`kind: "stalled"` prints `gtd next --json=content` (the diagnosis) to stderr and
stops; `message` halts unless it is the opening beat, which the human's own
re-invocation authored and which therefore lands like any other decision (see
[Driving the loop](#driving-the-loop) above — this is the one place the driver,
not gtd, decides, because "has the human read this gate" is run-scoped knowledge
gtd deliberately does not keep). A judge gate is a `message` rest whose own
`--json=judge` is non-empty — this reference driver pipes it through
`gtd judge run` and `gtd judge answer` (see
[Judge gates](#judge-gates-an-aware-drivers-env-var-mapping)), with the verdict
captured first because POSIX `sh` has no `pipefail`; if `gtd judge run` fails,
the driver falls back to the human hand-off, leaving the gate to you. `capture`
lands a human's already-made edit outright, no display needed; `script` reads
its content off `--json=content` (the raw script, not plain `gtd next`'s prose)
and runs it; `prompt` pipes plain `gtd next`'s own output to the agent over
stdin, with `session.id`/`session.resume`/`model`/`system`/`validate` read as
separate `--json=<path>` calls — `model` resolved from a hint to a real model
name first — and mapped onto the agent's session flags — trying `resume`'s
hinted flag first and falling back to the other on failure, since the session id
is derived, not remembered (see [Driving the loop](#driving-the-loop) above) —
and its own `validate` script's output re-prompted verbatim on failure (the
driver owns only the retry cap). Every optional value (`model`, `system`,
`validate`, `session.resume`, `idle`, `settled`) is read into a shell variable
that command substitution always assigns — even to the empty string when the
field is absent — so `set -u` never aborts on it; the guards
(`${var:-}`/`${var:+...}`) still matter for VALUE, not for `set -u`: an absent
field prints nothing, so an unguarded `--model "$model"` on an absent field
would pass `--model ""` and silently override the harness's own default, which
`${model:+--model "$model"}` avoids by omitting the flag entirely when `model`
is empty. Every landed turn is executed — and reported — by the emitted script
itself, read off `gtd land --json=script`, captured then piped to `sh`;
`settled`/`idle` are read from the same untouched tree first, per the ordering
rule above. `settled` ends a run that has nothing left to do: a no-op at a
`script` rest settles right where it rests (stop immediately, nothing more to
read), while an ordinary landing that finishes the whole process instead
resolves `idle` on the FOLLOWING beat's own `gtd next --json=idle` read — the
reference driver reads once more (a plain `gtd next`) only to DISPLAY that
gate's own message, the decision to stop already made from `settled`/`idle`
alone.

This paste passes `$system` on argv, and POSIX guarantees only 4 KB of argv
(`ARG_MAX`) — real systems are far higher (roughly 1 MB on both macOS and
Linux), and the bundled personas are only a few KB each, so this works
everywhere in practice. A driver shipping much larger system prompts, or
targeting a platform sitting at the POSIX floor, should write the string to a
file and pass that instead: gtd's own contract ends at emitting `system` as a
string, and how a driver hands that string to its agent CLI — argv, a temp file,
or something else — is the driver's own call, since it alone knows its
platform's argv limit and whether it has a writable temp directory; gtd adds no
flag, no file, and no mechanism of its own for this. (The doc-test below only
proves this paste parses and runs against a `claude` shim — not that the flag is
spelled or placed correctly; that's a `claude --help` check plus one live run,
not something the green suite can catch.)

### Judge gates: an aware driver's env var mapping

A judge gate is a `judge()` step (actor `judge`) and a `kind: "message"` rest
whose `--json=judge` field is non-empty — the rendered JSON document
`{ schema, state, questions: [...] }` the pending judgment asks about. The gtd
engine never calls a model — `gtd judge run` is an answerer a driver chooses to
pipe through. The reference driver above is an aware driver: it reads
`--json=judge` and, when non-empty, pipes `gtd judge --json | gtd judge run`
into `gtd judge answer --json=script | sh`, with no `--provider` (auto
selection, below). If `gtd judge run` fails it stops at the gate for you, as for
any message. A driver that wants a different judgment model pipes the same
document to it and the verdict it gets back into
`gtd judge answer --json=script` on stdin.

Whose-turn-is-it status reporting (like the herdr wrapper above) should treat
`actor` as an ALLOWLIST, not a denylist: stand down — report the run as resting
on someone, same as any ordinary human gate — on any actor the driver doesn't
specifically know how to advance, rather than assuming idle/done on everything
that isn't `human`. `judge` is exactly such a case: a driver that only
recognises `agent`/`check` halts there correctly with no edit, while a driver
that special-cased `!== "human"` as "nothing owed" would silently skip past a
pending judgment.

The scriptable answerer is `gtd judge run --provider fixed`: it reads the
`gtd judge --json` document on stdin and writes a verdict on stdout, answering
from `--answers <path>` or, when that is absent, the `GTD_JUDGE_ANSWERS`
environment variable — a JSON array of `{ id, answer, p }` in the shape
`gtd judge answer` decodes. Entries for questions the judgment did not ask are
dropped, so one file serves every gate; a question the file does not cover is
left out of the verdict, which a workflow routes to its conservative branch. A
malformed entry (`answer` not a string, number or boolean; `p` not a number in
`[0, 1]`) exits 1 with nothing on stdout.

```sh
gtd judge --json | gtd judge run --provider fixed --answers answers.json \
  | gtd judge answer --json=script | sh
```

`gtd judge run --provider jev` answers by calling TypeSafe's System One API
(`https://api.typesafe.ai/v1/systemone`) directly. It reads the key from
`TYPESAFE_API_KEY` only; `JEV_BASE_URL` replaces the full endpoint URL. Each
verdict's `p` is the confidence in the answer given: a `noul` at 0.1 is `"no"`
at `p` 0.9. On any failure — no key, a non-200, an unreadable response, a
question it cannot translate, or a verdict missing some questions — it exits 1,
prints why on stderr and writes nothing on stdout, so the judgment stays yours.

`gtd judge run --provider llm` answers by running `claude -p` (the Claude Code
CLI, on `PATH`), reusing its existing login — no key to configure. The model
defaults to `sonnet`; `--model <name>` overrides it. Failure follows the same
contract: exit 1, why on stderr, nothing on stdout.

With no `--provider`, `gtd judge run` picks `jev` when `TYPESAFE_API_KEY` is set
and non-empty — the keyed speed-up — and `llm` otherwise. It never falls back
from one to the other: a failing jev does not retry through `claude`. A machine
can pin the choice without editing the driver: a user-level
`~/.config/gtd/judge.json` `{ provider, model }`, overridden per field by the
`GTD_JUDGE_PROVIDER` / `GTD_JUDGE_MODEL` environment variables, with the
`--provider` / `--model` flags winning over both.

**Calibration risk: the `llm` provider's `p` is self-reported by the model, not
a measured probability.** Workflows gate on `p` floors (0.9 / 0.7), and a model
that states `p` 0.95 on a wrong answer clears them. Because the reference driver
answers gates with auto selection, every user of the paste has `sonnet` or jev
answering judge gates unattended out of the box; if a wrong verdict skipping a
human gate is unacceptable, route judge gates to yourself instead.

If your environment carries the key under `TYPESAFE_AI_KEY` (a name some setup
flows use), map it yourself — e.g. `export TYPESAFE_API_KEY="$TYPESAFE_AI_KEY"`.
The gtd engine never reads either variable; only `gtd judge run --provider jev`
reads `TYPESAFE_API_KEY`. It's written here as prose, not as a runnable snippet,
on purpose — naming either variable inside a fenced script would make it an
environment dependency of `driver-doc.feature`, which extracts and runs the
single fence in [A complete minimal driver](#a-complete-minimal-driver) above
with only `$PATH` (a shim directory first) and `$HOME` on its process
environment; a judge-answering driver that needs more than that is, correctly, a
different paste from the reference one.

### The self-validation gate

After an agent turn at a step that declares `file` and `mode`, run the script:
either `gtd next --json`'s own embedded `.validate` field (present at every
`prompt` beat that hands over a validatable file), or, standalone,
`gtd validate`'s own plain-text output — both resolve the exact same script from
one shared resolver. This field is now populated even at a FIRST-WRITE beat,
before the steering file exists at all: the script itself carries a leading
`[ -f <file> ] || exit 0` guard rather than gtd checking existence ahead of
time, so a driver's `while [ -n "$validate" ]` repair loop is armed from the
very first turn at a step, not just the second and later ones. Exit 0 means the
file is well-formed (or genuinely doesn't exist yet) — proceed to `gtd land`. A
non-zero exit usually means the script's own captured output IS a complete,
ready-to-send fix prompt (an instruction plus the findings): send it back to the
same agent session verbatim, and cap how many fix attempts you allow yourself —
the driver owns that retry count, not gtd. `gtd land` does NOT re-check for you:
its emitted script carries no format/validate step of its own, so a steering
file you never validated lands exactly as written, malformed or not. Running the
validate script before `gtd land` is the driver's obligation, not gtd's.

A non-zero exit can ALSO mean something the fix loop cannot fix: a mode whose
`format:` command breaks its own validator, a config bug gtd detects by
formatting a canonical sample and re-checking it before the real file's own
findings are ever reported. That message is unmistakably different — it says
this is a CONFIGURATION BUG, not the steering file, and tells the agent to stop
and end its turn rather than edit anything. gtd's exit-code contract stays
closed at five numbers (below), so nothing distinguishes the two cases at the
process level — a driver's fix loop is still the CORRECT thing to run in both
cases, it just can never win a contradiction: its 3-attempt cap is what ends
one, not a fix. Reading the message text before re-prompting is what keeps an
agent from thrashing on a document it cannot fix.

### Failure taxonomy and recovery

Several different things can go wrong, and they mean different things — and most
non-zero-looking exits are not a failure at all:

- **`gtd` itself exits 1.** Nothing was attempted — this is a refusal (a guard
  rejected the turn, or the resolved rest is not a judge step, for
  `gtd judge`/`gtd judge answer`). No script was ever produced.
- **`gtd` itself exits 2.** A usage error — nothing was even attempted, the
  invocation itself was wrong: unknown option/command, bad arity, a scope
  violation, an unknown `--json=<path>` selector, or (for `gtd judge answer`
  specifically) a verdict that fails to DECODE off stdin — malformed JSON, or
  one naming a question id the pending judgment never declared. All of these are
  caller-input errors, not a judgment about the rest itself, so retrying with a
  corrected invocation (or a corrected verdict) is the right move — unlike an
  exit-1 refusal, which means the turn itself was rejected.
- **`gtd land` succeeds (exit 0) but doesn't settle.** This is NOT a failure:
  whose turn is next lives in the FOLLOWING `gtd next`'s own `kind` field, not
  in `gtd land`'s exit code (see [Exit codes](./cli.md#exit-codes)) — and
  `gtd land --json=script` still carries a script (a print-only note, or an
  ordinary commit) that a driver must still run.
- **`gtd judge answer` succeeds (exit 0) after a verdict decodes cleanly.** Like
  `gtd land`, this is not itself the failure signal — a clean decode always
  produces a script (a print-only no-op, or a real commit carrying its
  `Gtd-Judge:` trailer) via `gtd judge answer --json=script`, which a driver
  must still run.
- **An emitted script exits non-zero when YOU run it.** Something may have
  partially happened — e.g. one git write landed but a later step in the same
  script failed. Nothing is retried on your behalf: git's own error is what you
  see.

Recovery is the same in every case: **ask gtd again** (`gtd next`, then land).
It re-reads the real repository state fresh every time — never a cached plan —
and emits whatever still needs to happen from there. **Emitted scripts are
re-runnable**: this is the single most important property for a driver's
recovery logic. Re-running a script that already fully applied is a no-op (its
git writes are `--allow-empty` commits and idempotent ref updates), and
re-running one that only partially applied resumes correctly, because gtd's next
invocation reads the new real state and emits a fresh script for what remains. A
driver never needs its own retry/resume logic beyond "if the script failed, ask
gtd again."

**A script carries no expiry check.** It does not verify that HEAD is still
where it was when gtd generated it, so a stale script — one held across a commit
someone else made, a checkout, a rebase — applies its write to whatever HEAD it
finds. Run a script promptly, against the repository state you asked gtd about;
do not queue it, store it, or hand it to another worktree.

### Prerequisites

- **A POSIX `sh`** (dash, ash, bash's own POSIX mode, etc.) — gtd's own emitted
  scripts (`gtd land`, `gtd --workflow <name>`, `gtd door`, `gtd abandon`,
  `gtd restore`) are POSIX sh; captured, then piped into it (see
  [Writing your own driver](#writing-your-own-driver) above).
- **`gtd` on `PATH`** — a mode's seeded `validate:` command (the one gtd fills
  in for the built-in `qa`/`review` formats) is literally the string
  `gtd check <mode> '<file>'`, invoked by NAME from inside an emitted script,
  not by absolute path. This is a deliberate trade: a readable, overridable,
  copy-pasteable command in exchange for depending on shell name resolution at
  the moment the script runs. The sharp edge: if the `gtd` binary you invoked to
  GENERATE the script differs from the `gtd` that resolves on `PATH` when the
  script later RUNS (a locally-built dev binary vs. a globally-installed
  release, say), you can get version skew between the two — the command that
  validates may not be the command that decided. Keep the two in sync (one `gtd`
  on `PATH`, consistently) if you care about that gap.
- **`GTD_LOOP_MODEL_SMART` / `GTD_LOOP_MODEL_BASE`** (optional) — the real model
  names the paste passes to `claude --model` for the workflow's `smart` and
  `base` hints, the same variables `gtd loop` reads. Unset, the hint is dropped
  and `claude` runs its own default model.
