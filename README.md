# gi[t]hings.**done**

> „Fix all the tests." „✅ All tests pass!" „The E2E suite is red." „Ah, you
> mean _those_ tests."

**Chat is a terrible source of truth. Git isn't.**

**gtd** is a git-aware CLI that derives the entire agentic workflow — capture,
plan, build, check, review — from your repository state, and prints the next
prompt for whatever agent you point at it. Every turn is a commit. The test
command is printed for your driver to run, and the branch is decided by what the
run leaves in the tree — so the agent never grades its own homework.

No chat scrollback. No lost sessions. No infinite fix loops. Just git.

## Why

- **Durable & replayable.** The workflow state _is_ your git history — a pure
  fold over commit subjects and the working tree. Kill the session, reboot, come
  back next week: run the driver and it resumes exactly where it stopped.
- **Shareable.** Push the branch, and the workflow travels with it — the state
  lives in the commits, so another machine (or another person) picks up exactly
  where you left off.
- **Files, not chat.** Plans live in `.gtd/` steering files (`REQUIREMENTS.md`,
  `ARCHITECTURE.md`, the package files under `.gtd/packages/`). Request changes
  by editing them, approve by leaving the tree clean — all in your own editor.
  There is no chat UI to lose.
- **Harness agnostic.** gtd emits prompts to stdout (or JSON). Claude Code, a
  bash loop, a CI job, or you reading it out loud — the workflow doesn't care
  who executes it.
- **Bounded, not runaway.** Fix attempts are capped (`retry` on a state). When
  the cap is hit, gtd redirects to a human gate instead of burning tokens
  rewriting the same test for the 47th time.
- **Your call on history.** Every intermediate `gtd(actor): from → to` commit is
  a real, attributed commit — the subject names both the state the work was done
  in and where it advanced to, nothing hidden in chat. Squash them into one
  conventional commit if you want that (an interactive rebase, an amend, a PR's
  squash-merge, or a custom workflow with a `commit:` finale), or don't — gtd
  makes no assumption.

## Install

```bash
npm install -g @pmelab/gtd
```

Or run without installing (prefix every `gtd` below with `npx`):

```bash
npx @pmelab/gtd next
```

That's it — gtd ships the **unified** workflow as its **built-in default**, so a
state command works out of the box with no configuration at all.

Optionally, seed the settings a project usually tunes — run once:

```bash
gtd init
```

This writes a minimal `.gtdrc.json` seeding the one variable most projects
change — the test command (`vars.testCommand`, defaulting to `npm test`) — plus
a top-level `modes:` block suggesting **Prettier** as the steering-file
formatter (`npx prettier --write` for the built-in `qa`/`review` modes — format
only, so gtd still validates them); edit or drop either freely (point
`testCommand` at your suite, swap Prettier for dprint or a script, delete a
key). It writes **no** `workflow:` key — the machine is built in — so review and
commit the file before your first `gtd land`. `gtd init` takes no argument and
refuses to clobber an existing config; it may also run in a plain parent
directory (not a git repo) to seed a shared config a nested repo picks up. To
customize the machine itself, add a `workflow:` key (there is no default
fallback to merge over — a `workflow:` is the whole definition).

gtd requires a repository with **at least one commit** before any state command
(`land`, `--entry`, `next`, `status`, `abandon`, `restore`, `validate`) will run
— there is no workflow state to derive from an empty history. Committing the
`.gtdrc.json` above (or anything else) satisfies this by construction;
`gtd init`, `gtd install`, `gtd lsp`, `gtd visualize`, and `gtd check` are
unaffected since none of them derive workflow state.

## How it works

gtd is a small **pattern machine**: named states, each awaiting one actor and
carrying one piece of content (a script, a prompt, a message, or a squash commit
template), with an ordered set of change-patterns routing to the next state.

The loop is one beat, repeated: run `gtd next --json` and dispatch on `kind` —
`"message"` means it's a human's move (stop and hand off, unless it's the run's
opening beat, which the human triggered by re-running the driver: land that one,
since changing nothing is itself a declared outcome at some gates); `"capture"`
means a human gate the human already acted on (land it immediately); `"script"`
means the driver runs `gtd next`'s own plain-text output itself, then lands it;
`"prompt"` means feed `gtd next`'s output to your agent — using the accompanying
`session.id`/`session.resume` fields off `gtd next --json` to continue or start
that agent conversation (see "Driving the loop" below) — then run `gtd land`
once it's done. gtd itself never executes anything — the driver owns running
scripts. Every `gtd next` call is strictly mutation-free, safe to poll or peek
at any time: `session.id`/`session.resume` are DERIVED, never stored, so looking
is free — nothing distinguishes a peek from a dispatch, and there is no separate
claiming form at all. A `prompt` beat whose turn changes nothing still lands:
`gtd land` commits an EMPTY `gtd(<actor>): <state>` attempt instead of silently
doing nothing, so the fruitless dispatch is visible in history rather than
invisible. `"kind": "stalled"` is derived from that history — HEAD is an empty
attempt at the resting state and the tree is clean — so every `gtd next --json`
call reports it, and it stays reported on a repeat (there's no marker to
consume) until something actually changes. The fix for a repeated stall is
either a better prompt, a `retry:` cap on the state that redirects to an
escalation state after N fruitless attempts, or — if the state can legitimately
finish with nothing to change — declaring a `C` (clean-tree) pattern on it.

An `on` edge may also carry a short imperative `action` (e.g. `Accept plan`)
alongside its existing `describe` sentence — a human-facing name for the choice
itself, not just the underlying glob pattern. `gtd next` (plain and `--json`)
and `gtd visualize`'s diagram and inspector all render the two composed
together: the `action` leads when the edge declares one, with the raw pattern
(and `describe`) still shown alongside it, so a human choosing between routes
reads intent first, glob second.

**Your input is a spec, not the work.** The unified workflow treats ANY change
to the tree — a hand-edit to real code, a scratch note in some file, anything at
all — as a sketch to be finished, never as work to be preserved: there is no
fork on which steering file you happen to create, and `idle` has exactly one
outgoing edge, into `unwind`. `.gtd/TODO.md` is a good default place to start
sketching when you'd rather write a note than touch code — despite living beside
the workflow's own state files, that sketch is your input for `design.triage` to
fold in, never gtd bookkeeping to preserve or ignore. `unwind` reverts that
whole diff back out of your working tree (`git revert --no-commit` against the
commit it just landed in) before planning ever starts — your tree is back to
exactly what it was, and your intent doesn't disappear, it survives in history
for `design.triage` to read.

From there, `start-gate.check` runs your test suite on the tree as it now stands
— which, thanks to the unwind, is simply your repo's own baseline. The rule is
the plain one: the baseline must be green. A red run halts the process and tells
you to repair it first (that's what `gtd --entry fix-precheck` is for);
`review-gate` follows the same rule.

Once past the gate, `design.triage` reads the diff that started the process
itself — the prompt never inlines it; it finds the entry commit (the one
`unwind` reverted) and runs `git show` against it — and groups that diff into an
ORDERED list of **concerns**, each one able to leave the test suite green on its
own, classifying each as **product** (a user-facing/requirements decision) or
**technical** (an implementation decision). A concern's open point clears a
three-part bar before it's ever raised as a question: the answer must be a
genuine fork with divergent outcomes, the sketch/entry diff/history must not
already settle it, and getting it wrong must survive all the way to human
review. Anything below that bar — product or technical alike — triage decides
itself, recording the decision and a one-line rationale under
`## Answered Questions`, the same section a human-answered question lands in;
only a product point that clears the bar is raised as an open question in
`.gtd/REQUIREMENTS.md` (a technical point that clears it waits for the
architecture phase to raise it), folding EVERYTHING the entry commit added into
those concerns — a scratch sketch and a hand-edited code change alike, since the
unwind already reverted both; nothing is left to delete. When every concern
turns out to be technical, triage writes no `## Open Questions` section at all.
A shared check+answer gate then probes `.gtd/REQUIREMENTS.md` for unanswered
questions: each open question offers a couple of candidate answers plus a
`- [ ] _your answer_` slot, and you tick exactly one per question (the gate
won't let the phase advance while any question is unanswered) — but a phase
whose document has no open questions skips that human stop entirely and falls
straight through. If a question's options ever come out as prose instead of
`- [ ]` rows, there is no checkbox for the gate to see, so it stays permanently
unanswered; un-wedge it yourself: hand-write the `- [ ]` rows and tick one,
delete that question, or delete the whole `## Open Questions` section to accept
the plan as-is.

Once the product questions are settled, `architecture.author` picks up as a
**cold reader** — a separate machine with its own memory scope, so it does not
resume the triage conversation but reads `.gtd/REQUIREMENTS.md` in full (cold
means no memory of that conversation, never no git access — it finds and reads
the entry commit from history exactly as triage did) — and develops the _how_
for each settled concern. Because it is the first state that knows the _how_, it
is also the one state allowed to re-merge concerns whose file footprints
coincide (never split), recording every merge under a `## Merged Concerns`
heading. The same three-part bar applies to every technical point here too: only
one that clears it is raised as an open question in `.gtd/ARCHITECTURE.md`;
everything below the bar, author decides itself and records under
`## Answered Questions` right alongside triage's own settled points, all of
which author treats as SETTLED regardless of whether they're product or
technical. Open questions are routed through that same shared check+answer gate
shape, again skipping the human stop when nothing is open, and
`.gtd/REQUIREMENTS.md` is deleted once its content is folded in. A process where
nothing ever clears the bar runs both phases straight through with no human stop
at all — the existing review tail, which sees the whole diff anyway, is the
veto. Once those are settled, `architecture.decompose` is a purely mechanical
write-out — **one package file per concern**, in the settled order, with no
merge/split judgement of its own (triage grouped the concerns, and
`architecture.author` may already have re-merged some of them by file footprint)
— handing off to the per-package build queue: each package (a set of independent
tasks a single build turn fans out to parallel subagents) runs its own test loop
and a per-package **agentic review** that verifies it against its own spec. A
package whose work already landed (an earlier package's fix turn pulled it in)
is not a dead end: the build turn records per-criterion evidence in
`.gtd/SATISFIED.md` instead of implementing anything, and the package still goes
through the checks and the spec review before closing out. If a queue item ever
_does_ dead-end (a build turn that authors nothing stalls), the supported
recovery is to write that same file yourself and `gtd land` — no hand-authored
state commit.

The process converges on that same shared tail: an agent hands you a
`.gtd/REVIEW.md` checkbox review of the diff — the prompt never inlines the diff
itself; it names the commit the changes are based at and the agent runs
`git diff` to read the range before writing the review. Each hunk is a
`- [ ] ./path/to/file.ts#42` pointer, and its explanation can either trail the
pointer on the same line after a dash or sit on the line(s) below it — both
forms are equally valid, but the same-line form is the reflow-proof one, since a
continuation line has to be indented exactly two spaces (four or more, after a
blank line, reads as an indented code block and never reflows):

```
- [ ] ./path/to/file.ts#42 — what this hunk does, with room to run to
  several lines
- [ ] ./path/to/file.ts#99
  a note on the line below the pointer works too
```

The one rule an explanation must follow either way: it must never itself START
with a bare `./path` token, since that parses as a second hunk pointer rather
than a note. If a styled `.gtd/REVIEW.md` ever comes out malformed some other
way (a paragraph where a `- [ ] ./path#line` row belongs), `gtd check review`
refuses the step the same way: the file stays exactly as written in the working
tree, unlanded, and re-running the same prompt is the recovery — nothing is
lost. While the process rests at that gate, the landing script opens a **review
checkout window**: HEAD is rewound to the review base with the working tree
untouched, so the whole reviewable change shows up as ordinary uncommitted
changes in your editor's normal git integration (and files added during the
process show up as ordinary untracked files, so discarding one deletes it — an
untracked file you leave alone is not a pending change, and only actually
removing it from disk counts as a deletion). The next landing's own script
closes the window before it commits. Tick a box as you review each hunk (ticking
just records "I read this"), and leave a **comment** to request changes: a note
on a line, an inline `// TODO`-style comment in the code, or a direct code edit.
A comment sends a FULL development lap, not a quick fix-and-re-review: an agent
first judges whether your comment is actually actionable (a genuinely approving
remark with no code edit short-circuits straight to sign-off instead), and an
actionable round is re-planned from scratch through triage, architecture, and
the package queue again — a hand-edit you made during review is treated as a
**sketch**, the same as any other change that starts a process, not a fix the
agent builds on: it is reverted out of the tree first, and your intent survives
only in your own review-round commit for triage to read. There is no baseline
check on the way back into planning. Only the turn that drafts the final squash
message resumes the session that built the feature in the first place (the
review tail is nested inside that build identity rather than sitting beside it)
— an actionable round leaves that identity entirely, so it starts a fresh
session like any other process. A comment is what asks for changes; landing with
no comment signs off, whatever the boxes say, which collapses the whole process
into one commit (a **squash finale** whose message an agent drafts). Deleting
`.gtd/REVIEW.md` is refused — the guard only asks whether the step's diff
deletes the file.

A second entry, the same review tail's own direct entry point —
`gtd --entry review-gate.check --var reviewBase=<commitish>` starts a brand new
process reviewing `<commitish>..HEAD` with no build of its own on a clean
sign-off, e.g. a colleague's PR branch (`review-gate.check`'s `reviewBase:` is a
template bound to the `reviewBase` var, so supplying it via `--var` fixes the
whole process's diff base to that commitish) — though an actionable round on
this entry runs the same full triage → gates → architecture → package-queue lap
as any other, same as `re-unwind` re-plans a build process's own review
feedback. A clean sign-off's squash keeps and describes only the fixes made
_during_ the review (not the reviewed changeset); a clean sign-off with no fixes
becomes an empty `chore: human review` commit. A third entry,
`gtd --entry fix-precheck`, starts from a clean `idle` and goes straight into
repairing a red baseline — repair, review, and squash into one commit. If the
suite is already green there is nothing to fix, and the log is left untouched —
no commit is left behind.

`--entry` itself isn't limited to states flagged `entry: true` — it accepts
**any** declared, non-commit state of the active workflow (see
[`gtd --entry`](#commands) below). `entry: true` only marks a state as an
_extra_ reachability root (and drives a badge in `gtd visualize`) for a state
that would otherwise be unreachable from the ordinary `idle` rest —
`review-gate.check` and `fix-precheck` need it for exactly that reason, while
`start-gate.check` carries it too (the bundled template dedups its two
`entryGate` instances — `start-gate` and `review-gate` — into one shared
machine, so flagging the shared state flags both) even though `idle` already
reaches it the ordinary way. `entry: true` is not a precondition for `--entry`
to target a state.

Every agent state routes its model through two `vars` tiers — `plannerModel`
(heavier planning and review) and `coderModel` (the coding turns) — so you can
repoint the models globally in one place (a `vars:` edit or a `GTD_PLANNERMODEL`
override) instead of per state. Every steering file the bundled workflow reads
or writes lives at a fixed path under `.gtd/`; `testCommand`, `plannerModel`,
`coderModel`, and `reviewBase` are the only vars left to tune.

To inspect or change the machine itself, see [Configuration](#configuration) —
the workflow is just `.gtdrc` config.

## Commands

```
Usage: gtd [command] [options]

Commands:
  init             Scaffold a minimal .gtdrc.json for this repo, seeding the
                   default variables you are most likely to change (the test
                   command) and a Prettier formatting suggestion. gtd runs its
                   built-in workflow by default, so no workflow is written —
                   add a workflow: key only to customize the machine itself.
                   Takes no argument. Run once per repo; refuses if a gtd
                   config already exists. Leaves the file uncommitted for you
                   to review and commit
  land             Land whatever the tree now shows at the currently resolved
                   rest — a human capture, an agent/check turn, an empty
                   attempt (a fruitless prompt turn), or a squash. Pass
                   --cost=<n> (optionally --model=<name>) to record the
                   just-finished invocation's token cost and model on the
                   turn commit (summed into it.processCost/
                   processCostByModel). Plain (the default) prints ONLY the
                   script that records the landing; a driver runs it, e.g.
                   `gtd land | sh`. --json/--sh instead emit script (that
                   same script, byte-identical) alongside settled, idle,
                   state (the post-land target), subject, cost and model —
                   --json/--sh are mutually exclusive. Exits 0 on success, 1
                   on any refusal — see the Exit codes section below
  (no command) --entry <state>
                   Starts a new process authenticated as human, e.g.
                   'gtd --entry <state>'
  abandon          End the process currently underway without completing it:
                   close any open review checkout window, then rewind HEAD to
                   the commit the process started from, keeping everything it
                   produced as uncommitted changes. A no-op when no process is
                   underway
  restore          Hard-reset HEAD back to the pre-squash tip retained by the
                   last squash/abandon (refs/worktree/gtd/history), undoing a
                   squash or bringing back an abandoned process's turns.
                   Refuses on a dirty working tree, when there is no retained
                   history, or when HEAD has advanced past the squash with
                   commits that would be lost
  next             Print the resolved rest's beat (no mutation, safe to
                   poll), in one of three encodings. Plain (the default): a
                   status summary, a blank line, then the step verbatim —
                   except at a prompt rest, which is the bare step (plus the
                   self-validation instruction when applicable) with no
                   header, since those bytes are the agent's own input. --json
                   emits the one structured surface gtd has: kind
                   (capture|message|script|prompt|stalled) selects what a
                   driver does, content is what it runs or shows, idle marks
                   the workflow's initial state with a clean tree, plus the
                   prompt session, model, validate script, log path, changes,
                   next and the resting state's own fields. --sh emits the
                   same fields as gtd_-prefixed POSIX shell assignments.
                   --json/--sh are mutually exclusive. Exits 0 — see the
                   Exit codes section below
  validate         Print the script that formats (when declared) then
                   validates the resolved rest's steering file, using its
                   mode's commands (its file:/mode:), instead of running it —
                   a driver runs the script and reads the findings from its
                   own exit code/output. Always exits 0; prints "nothing to
                   validate" when the resolved rest declares nothing to run.
                   On a non-zero validate exit the emitted script prints a
                   ready-to-send fix prompt (instruction + findings) and
                   exits with the validator's own code
  lsp              Start the LSP server for .gtd/ steering files (stdio)
  visualize        Serve an interactive diagram of the active workflow on a
                   local web server (--port <n>, --no-open). Prints the
                   chosen port on its own line — with --port 0, this is the
                   only way to learn which port was picked
  check <mode> <file>
                   Read <file> and run the built-in steering format named
                   <mode> (see `gtd validate`'s modes: qa, review) over its
                   contents, printing each finding one per line and exiting
                   non-zero when there are any. Resolves no workflow state and
                   reads no config — standalone, runnable from any directory
                   with <mode>/<file> given explicitly. This is what a
                   workflow's emitted validation script invokes as a leaf step.
                   --open-questions runs the qa unanswered-questions predicate
                   instead (see --help)
  install          Print a complete, self-contained briefing that teaches an
                   agent (or a human) to build a gtd driver in any shell or
                   runtime — the self-serve version of README's 'Writing
                   your own driver'. Writes nothing: this installs knowledge
                   into the calling agent's context, not files on disk. Runs
                   from any directory, in or out of a repository
  version          Print version and exit
  help             Print this help and exit

Options:
  --json           (gtd next/gtd land only) output structured JSON
                   instead of plain text. Mutually exclusive with --sh
  --sh             (gtd next/gtd land only) output gtd_-prefixed POSIX
                   shell assignments instead of plain text. Mutually
                   exclusive with --json
  --port=<n>       (gtd visualize only) port to serve on (default: a free port)
  --no-open        (gtd visualize only) do not open the browser
  --cost=<n>       (gtd land only) record the invocation's token cost
  --model=<name>   (gtd land only, with --cost) tag that cost's model
  --entry <state>  (with no command at all) start a brand new process at
                   <state> — any declared, non-commit state — authenticated
                   as human
  --var <name>=<value>
                   (with --entry; repeatable) supply a fixed it.vars
                   override for the new process; the name must already be
                   declared by the workflow's own vars: or the .gtdrc vars:
  --open-questions (gtd check only) ignore <mode>'s structural findings and
                   instead run the qa open-questions predicate over <file>,
                   printing each unanswered question one per line and exiting
                   non-zero when any remain
  --verbose        enable stderr narration for this invocation: which rest
                   resolved, which declared pattern each pending change
                   matched, which review-window action was emitted, and how
                   config resolved across layers. Aliased to -v
  --version, -V    Print version and exit
  --help, -h       Print this help and exit
```

### Plain output is not a parsing surface

`gtd next`'s plain encoding is for a human, or a driver that merely displays it
— never for scraping. Parsing lives in `--json`/`--sh`, both of which read from
the exact same field set (`gtd install`'s briefing has the full reference);
anything that greps, cuts, or `awk`s plain text is unsupported, and its shape
may change across releases with no warning.

### Exit codes

Closed at five numbers, five meanings — a new command never grows this table;
whose turn is next lives in `gtd next --json`'s own `kind` field instead.

| Code      | Meaning          |
| --------- | ---------------- |
| 0         | success          |
| 1         | runtime error    |
| 2         | usage error      |
| 130 / 143 | SIGINT / SIGTERM |

Every command follows this table uniformly, `next`/`land` included: `0` on
success, `1` on refusal, `2` on usage error, `130`/`143` when gtd itself dies by
that signal — a parent's `wait` sees a real signal death (`WIFSIGNALED`), not a
chosen exit code that merely reuses the same number. No command's exit code
carries a second meaning.

**Migration — read this even if you already migrated for a prior release.** This
is the second inversion in as many releases, folded into one note rather than
two to compose in your head: `10`/`20` (whose turn was next) are gone — every
command exits `0`/`1`/`2` uniformly now; `gtd status` is gone (folded into
`gtd next`); and plain `gtd next` now prints a status header at every kind
EXCEPT `prompt` — agent input is untouched, since plain `gtd next` at a `prompt`
rest is byte-identical to before. A driver must read whose turn is next off
`gtd next --json`'s own `kind` field
(`capture`/`message`/`script`/`prompt`/`stalled`) — never off gtd's exit code,
which no longer carries that signal at all.

Every usage mistake — an unknown option or command, missing/extra arguments, a
scope violation (e.g. `--cost` on a command other than `gtd land`), a bad flag
value — is a USAGE error (`2`), never a runtime error (`1`): nothing was even
attempted. `--help`/`--version` still exit `0`.

`--version` (`-V`) / `gtd version` and `--help` (`-h`) / `gtd help`
short-circuit before any git or repository-state work — they run outside a repo
and in any repo state, and print to **stdout** at exit 0. `--verbose` (`-v`) is
not a short-circuit — it gates narration for whatever command follows (see
[Narration and remediation](#narration-and-remediation) below). Bare `gtd` (no
subcommand) is a usage error that exits 2 — gtd decides and prints, full stop;
driving a loop is a driver's job, not a bundled command (see
[Driving the loop](#driving-the-loop) below) — printing its help text to
**stderr**, not stdout: stdout stays byte-empty on every failure, a usage error
included (see [Error envelope](#error-envelope) below). Any other, truly unknown
subcommand is likewise a usage error exiting 2 without touching the repository.
The state commands (`land`, `--entry`, `abandon`, `restore`, `next`, `status`,
`validate`) must run from the **repository root** — gtd derives the workflow,
pending changes, and process history relative to cwd, so they refuse with a
clear error from a subdirectory; `lsp`, `init`, `visualize`, `check`, and
`install` are standalone and run from anywhere (see each command's own help
entry).

`--json`, `--cost=<n>`, `--model=<name>` (the latter two only for `gtd land`),
`--entry <state>` (no other command at all), and `--var <name>=<value>` (with
`--entry`, repeatable) are the only long options the compiled bundle recognizes.
`--entry`/`--var` accept both the `--flag=value` and the space-separated
`--flag value` form. Any other `--` option (including a typo like `--jsn`) is
rejected with a usage error rather than silently ignored, so a mistyped flag can
never degrade a JSON caller to plain-text mode. `--var` with no `--entry`, a
duplicate `--var` name, or `--cost`/`--model`/`--entry` combined with another
command are all usage errors too — landing and entering are different verbs, so
`gtd land --entry <state>` is a usage error, not a synonym. A bare
`--cost`/`--model` with no value, a non-numeric or negative `--cost`, an empty
`--model`, `--model` without `--cost`, or `--cost`/`--model` on any command
other than `gtd land` are all usage errors.

### `gtd next`'s `Next:`/`next`

Both plain and `--json` output include a headline preview of what would happen
next: the first declared `on` edge whose pattern matches the pending changes AS
A WHOLE (the same first-match-wins semantics `gtd land` itself uses), using its
`action` when the edge declares one, else its raw pattern, alongside its target
state. Plain output prints a `Next: <action-or-pattern> → <target>` line (or
`Next: (no match — nothing would happen)`); `--json`'s `next` key mirrors it as
`{ action?, pattern, target }`, or `null` on no match.

This reports the **declared** route only: a capped `retry` may redirect
elsewhere when the land is decided, which `Next:`/`next` does not apply — it
previews what the declared `on` patterns would match, not a guarantee of where a
real `gtd land` lands.

### Error envelope

**stdout is either the complete artifact or byte-empty — never a partial write
followed by an error.** Every command buffers everything it would print and
flushes that buffer to stdout exactly once, only after it succeeds; on any
failure the buffer is simply discarded, so stdout never carries a half-written
prompt/script alongside a message about why it stopped. `gtd visualize` is the
one exception worth knowing: it flushes its served-URL line immediately, before
blocking on `Ctrl-C`, since a flush-on-success would never otherwise fire.

Any invocation that carries `--json` (valid only for `gtd next`/`gtd land` —
every other command usage-errors on it) reports a failure as a machine-readable
envelope on **stderr** — including the scope violation itself, so a driver that
always adds `--json` still gets a parseable envelope on every failure, not only
`gtd next`'s/`gtd land`'s own:

```json
{ "state": "error", "prompt": "<message>" }
```

This covers every failure mode, not just a command's own refusal (exit 1): a
**usage error** (an unknown flag, a missing argument, `gtd --entry version`'s
"not an enterable state" — exit 2) and a **defect** (a layer throwing outside
the ordinary error channel — exit 1) both get the same envelope shape — there is
no failure path that reaches `--json` without one — but a usage error's exit
code is 2, never 1, so a driver can tell "you invoked gtd wrong" apart from "gtd
refused/broke" (see [Exit codes](#exit-codes)).

A human-readable `gtd: <message>` line is also always written to **stderr**,
right after the envelope — stdout carries neither one on a failing run. Stderr
always carries exactly one `gtd: ` prefix: a message already authored with its
own `gtd:`/`gtd <cmd>:` prefix is never doubled.

**Accepted cost:** a driver that pipes stdout into `jq` on a failed run now
reads nothing instead of a parseable error object — it must read stderr or the
exit code to learn why a run failed.

### Narration and remediation

Stderr carries two things beyond the `gtd: ` message line above: NARRATION,
gated by `--verbose`/`-v`, and REMEDIATION, unconditional.

`--verbose` (alias `-v`) turns on one line of commentary per in-process fact a
command's dispatch already computes — which rest resolved, which declared
pattern each pending change matched, which review-window action was emitted, and
how config resolved across `.gtdrc` layers. Without it, none of this is printed;
stdout is never touched either way — narration is a stderr-only concern, exactly
like the error envelope above.

A failure's remediation detail is unconditional — it prints at every verbosity,
on the line(s) right after the `gtd: `-prefixed message, each indented two
spaces: a bad config key names the offending key and which `.gtdrc` layer it
came from, a corrupted ref names the ref, and a missing binary in a steering
mode's `format:`/`validate:` command names the resolved `$PATH` it was looked up
in.

### Non-interactive today

gtd is non-interactive: no readline, no `/dev/tty`, no prompt call anywhere in
`src/`. If interaction is ever added, it goes to `/dev/tty`, never stderr, and
never blocks — a question fails with a code when the tty cannot be opened rather
than hanging. The reason is the section above: stderr already has two occupants,
narration and remediation, and a question mixed into that stream would deadlock
a driver that never reads stderr.

## Driving the loop

gtd itself is not a loop — it decides and prints, full stop; driving a loop is a
driver's job. The README's minimal driver below (see
[A complete minimal driver](#a-complete-minimal-driver)) is that driver: save it
as `~/.local/bin/gtd-loop`, `chmod +x` it, and run it from a repository root —
it takes no arguments and runs the loop until it's your turn. It drives the
autonomous states (agent turns, check runs) and stops at the first
non-autonomous one: reaching a human gate it prints the gate's message and
exits. You act by editing files (answer a plan question, tick a review box, fix
code) and re-running it — your pending edit arrives as the loop's first beat
(`kind: "capture"`, landed immediately), so you never run `gtd land` by hand.

Some gates could accept by INACTION instead: a workflow may declare a `"C"`
(clean-tree) pattern on a human-actor state that routes onward, so changing
nothing there means "accept as-is" rather than nothing happening. That reaches
the driver as `kind: "message"` either way, which no inspection can tell apart
from a gate you have not read yet — so the driver treats its OPENING beat as
yours regardless and lands it: you re-ran it while resting there, and that
invocation IS the decision. Every later beat halts as usual, because a gate the
driver produced mid-run is one you have not seen. Landing an opening beat at a
gate with no `"C"` pattern is harmless — a benign no-op (see `gtd land`'s exit
codes below) — and the gate then prints on the next beat. A mid-process restart
simply resumes driving from whatever beat is actually next.

Anything richer at that boundary — opening your editor, desktop notifications,
terminal-multiplexer status — is the job of an outer wrapper around the driver,
not of the loop itself; see
[Terminal-multiplexer status: a herdr wrapper](#terminal-multiplexer-status-a-herdr-wrapper)
below for a worked example.

A workflow state can declare an optional `label:` — a human-readable display
name surfaced in `gtd next --json`/plain `gtd next`. The driver uses it for its
per-beat progress lines; an outer wrapper (a terminal multiplexer, a notifier)
can use it the same way.

A machine may also declare `system:` — like `model:`, stamped once at the
machine level onto every one of that machine's own `prompt` states, never
authored on an individual state. It is passed to the agent CLI as (in the
reference driver's case) `--system-prompt`, which **replaces** the harness's own
default system prompt outright rather than appending to it (contrast with an
`--append-system-prompt`-shaped flag) — so a machine declaring `system:` loses
not only the harness's own tool-use instructions but also its dynamic per-turn
sections: current working directory, environment info, memory-path information,
git status. A workflow author reaching for `system:` for the first time is
therefore writing a complete replacement system prompt, not a tweak on top of
the harness's own. The scoping is machine-level for the same reason memory is
machine-scoped below: a machine is the unit of conversational identity, so its
system prompt — like its model tier — is one property of that identity, constant
across every turn of the one resumed session, never a per-state override. Like
`model:`/`file:`, a `system:` value prefixed `./` or `../` is inlined from the
declaring config file's own directory at compile time — for a user's own
`.gtdrc` `workflow:` config only; the bundled template ships no filesystem
references at all, since it has to work inside a single-file build. The bundled
default template ships six such personas already, one per prompt-bearing machine
— `designPersona`, `architectPersona`, `reviewerPersona`, `specReviewerPersona`,
`builderPersona`, `finisherPersona` — and, like any other bundled var, each is
overridable through a top-level `.gtdrc` `vars:` key or a `GTD_<NAME>`-style
environment variable (e.g. `GTD_DESIGNPERSONA`) — gtd's existing, generic
vars-override mechanism, nothing new.

Memory is **entry-scoped to a machine**, not a state-authored label: each
machine instance (a node in the `machines:` tree, e.g. `build`, `build.health`,
`packages.item`, `packages.item.health`) owns its own conversational scope, and
a `prompt`-content state's `memory` key — surfaced in `gtd next --json`'s
`memory` field, and as a `Memory: <key>` line in plain `gtd next` — is computed,
never authored, as `<scope>#<hash7>`: `<scope>` is that machine instance's
dotted path (the root instance is shown as `root`), and `<hash7>` anchors to the
commit the CURRENT unbroken entry into that scope started FROM. Entering a
**descendant** scope (e.g. dipping from `build` into `build.health`) does not
break the parent's unbroken run — a full agent turn in a nested child machine,
then back to the parent, still resumes the SAME parent conversation; entering a
**sibling or unrelated** scope does start a fresh one. The bundled template's
`build.review` (the human review tail) is a worked example: it is nested INSIDE
`build` (the builder's own machine) so that a `gtd --entry fix-precheck` run —
`build.fix` -> `build.health.check` -> `build.review.*` -> `build.squashing` —
stays inside one subtree, letting `build.squashing` resume the SAME session that
made the fixes instead of a root-level sibling forcing it to re-derive the range
from scratch on every pass through the tail. (An actionable review round breaks
the run on purpose instead — it leaves `build` entirely through a root-level
`re-unwind` state and a full re-plan, since a hand-edit made during review is a
sketch to reconsider, not a fix to build on.) Two instances of the same reusable
machine (e.g. `build.health` and `packages.item.health`, both instantiating
`healthGate`) get different scopes and so never share a key, even though they're
the "same shaped" machine. One consequence is a structural guarantee: **a
reviewer's turn never resumes an implementer's session, and vice versa** — a
reviewer machine and the implementer machine it reviews are always different
instances with different scopes.

`gtd` itself stores NOTHING to make this work: `session.id` is
`UUIDv5(<fixed gtd namespace>, <memory key>)` — a deterministic hash of the
computed `<scope>#<hash7>` key above — so the same scope-run always re-derives
the exact same id, and there is no table, no file, no write to keep in sync.
`session.resume` is `true` iff a prior `prompt` turn already landed within that
same scope-run. Because nothing is written, calling `gtd next --json` twice in a
row — a driver's own opening peek, a status poll, a curious human — derives
IDENTICAL `session.id`/`session.resume` values both times, since there is
nothing to poison: looking is free, and there is no separate claiming form to
protect. The per-scope survival story (a child machine's own excursion doesn't
disturb the parent's session) falls out of the key itself, not out of a
per-scope row: the parent's anchor commit is unaffected by whatever the child
scope does in between. A driver maps `session.id`/`session.resume` straight onto
the agent CLI's own session flags — the README's minimal driver passes them as
`--session-id <id>`/`--resume <id>` to `claude -p`, but treats `resume` as a
HINT rather than a contract: it tries the flag `resume` points at first and
falls back to the other on failure. That fallback is what recovers BOTH
mismatches that used to need manual intervention — a crashed prior turn that
minted an id but landed no commit (so the next lap re-derives the SAME id with
`resume: false`, and `--session-id` on an already-used id fails, so the driver
falls back to `--resume`), and the inverse (`resume: true`, but the remembered
session is gone — retention expired, `~/.claude/projects` wiped — so `--resume`
fails and the driver falls back to `--session-id`). There is no file to delete
and nothing to restart.

### Terminal-multiplexer status: a herdr wrapper

[herdr](https://herdr.dev) shows a per-pane status in its sidebar. This wrapper
reports `gtd`'s own lifecycle to that status without any herdr-specific
knowledge in `gtd` itself: `working` while the loop drives, `blocked` when it
comes to rest on a human (a gate, a stall, a non-zero exit), and `idle`
(rendered as "done" once the pane's tab is unfocused) when a run ends without
anything owed. It needs nothing from `gtd` beyond `gtd next --sh`'s `gtd_actor`
field — a strictly read-only orientation peek.

Save this as `~/.local/bin/gtdh`, `chmod +x` it, and run `gtdh` in place of
`gtd-loop` — it's a plain bash file, so it works from fish or any other shell.

```bash
#!/usr/bin/env bash
# Report gtd's own lifecycle to the herdr pane it runs in: working while the
# loop drives, blocked when it rests on you, idle (shown as "done") otherwise.
# Needs nothing from gtd but `gtd next --sh`. Outside herdr it is a plain
# passthrough.
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
env -u HERDR_PANE_ID gtd-loop
rc=$?

# Whose turn is it now? `gtd next --sh` is a strictly read-only peek — every
# gtd command is, including `gtd next` (its prompt session id is derived,
# never minted/stored) — only the emitted scripts a driver runs actually
# touch git. A human actor means gtd is waiting on you; anything else means
# the run ended with nothing owed. Assign first, THEN eval — same reason as
# the driver above.
out="$(gtd next --sh 2>/dev/null)" || out=""
eval "${out:-}" 2>/dev/null || true

if [ "$rc" -ne 0 ] || [ -z "${gtd_actor:-}" ] || [ "$gtd_actor" = human ]; then
  report blocked
else
  report idle
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

The README's minimal driver below is gtd's own reference driver, not a
privileged one — the engine itself is a supported public surface, and anything
below holds for any driver you write against it. gtd decides and prints; it
never touches git itself. The four commands that change anything — `gtd land`,
`gtd --entry <state>`, `gtd abandon`, and `gtd restore` — perform no git write
when run: each one prints ONE POSIX sh script for YOU to execute
(`src/Emit.ts`'s `combinedScript`) — a leading comment ("gtd emitted this and
did NOT run it — pipe it into `sh` to land the turn"), then the REQUIRED half
verbatim, then, only when there's a presentation-only follow-up, a second
comment ("presentation only — safe to skip") and the OPTIONAL half wrapped in a
subshell whose own non-zero exit is swallowed (reported to stderr as a warning,
never turning a landed turn into a failing one). Printing gtd's output and never
running it is not driving anything; a driver must pipe or execute what gtd
prints — e.g. the capture-then-pipe form the reference driver below uses — never
a bare `gtd land | sh`, which would hand an empty script to a shell on a refusal
instead of stopping first (see the reference driver's own use of `gtd land --sh`
below).

Every script gtd emits — `gtd land`, `gtd --entry <state>`, `gtd abandon`,
`gtd restore`, and the format/validate script `gtd validate` prints — is POSIX
`sh`, portable to `dash`: a driver may run any of them with any POSIX-compliant
shell, not specifically bash. The same convention extends to the workflow's own
`vars.testCommand` (what a `script`-content check state actually executes): it
is expected to be POSIX sh-compatible too, but this is a DOCUMENTED CONVENTION
only — gtd never inspects or validates `testCommand`'s shell dialect itself, it
only renders the value into a script and hands it to whatever shell the driver
invokes that script with.

- **The required half** is everything that decides what lands in git — closing
  an open review checkout window, the resting state's own steering-mode
  `format:`/`validate:` commands, the commit or squash itself (`gtd land` and
  `gtd --entry <state>`), or the ref update and reset that undo a process
  (`gtd abandon`, `gtd restore`) — and, last, a printed line naming what just
  landed (`src/OutcomeScript.ts`'s `gtd_report_*` calls): a transition or
  capture's changed-file rows, or the abandon/restore prose, resolved from the
  repository AFTER the write above it. Its own exit code IS the printed script's
  exit code — skipping it means the turn never lands, and you never see what it
  did.
- **The optional half** is presentation only: re-opening the review checkout
  window (the `<<<<<<< HEAD` diff view) after `gtd land` lands at a
  `reviewWindow: true` state, so an editor's diff view has something to show.
  Its own failure is swallowed by the wrapping subshell (a warning on stderr,
  nothing more) — skip it (or let it fail) and you lose nothing but that view,
  the workflow is still driven correctly. `gtd abandon`/`gtd restore` never
  carry one — there is no window to reopen after either, so their printed
  artifact is the required half alone, with no trailing comment/subshell at all.

`gtd next --json` carries one more field worth a custom driver's attention:

- **`log`** — the per-worktree loop log path, always present. It's derived from
  the worktree's own git dir, so two worktrees looping concurrently never share
  one file; set `$GTD_LOOP_LOG` to override it verbatim, or `$GIT_DIR` to name
  the git dir directly (both honored the same way every git subprocess already
  honors them — an inherited `$GIT_DIR` moves the log path along with it). gtd
  itself neither creates nor truncates this file — a driver appends subprocess
  output to it and truncates once at the start of a run, exactly like the driver
  above does.

Even a genuine no-op `gtd land` (a clean tree matching no `on` pattern) prints a
PRINT-ONLY script: no git write, just the same `nothing to do at "<state>"` line
the script prints when a driver runs it. Every encoding (plain, `--json`,
`--sh`) carries that same script verbatim in its `script` field — running it is
never optional, whichever encoding a driver reads it from. The script is
self-contained (it carries its own precondition assert and retry helper) and
safe to run standalone, in sequence, or not at all — paste it into a terminal
and it does exactly what it says, printed output included: it detects its own
tty/`NO_COLOR` at RUN time (not at the moment gtd generated it), so the
fancy/plain rendering always matches wherever you actually run it.

A driver has no opening move. It does not need to know whose turn it is before
it starts — `gtd next --json`/`--sh` tells it, and a human's pending edit
arrives as an ordinary `kind: "capture"` beat that the driver lands like any
other. The rule this replaces: never `gtd land` outside a beat you dispatched. A
stray land at a clean `prompt` rest authors an empty attempt on purpose (that IS
the stall bookkeeping), so an unconditional opening land would manufacture a
stall out of a fresh start. The one EXCEPTION is the run's very first beat: land
it before trusting `idle` there too, so a workflow whose initial state declares
its own clean-tree `"C"` pattern still gets a chance to advance on a human's
bare re-invocation, rather than the driver concluding "nothing owed" without
ever giving that edge a turn (see the reference driver's own comment on this).

Exit code carries none of this any more — every command, `next`/`land` included,
exits `0` on success (see [Exit codes](#exit-codes) above). Whose turn is next,
and whether a landing settles, are both PLAIN FIELDS on `gtd next --json`/`--sh`
and `gtd land --json`/`--sh`: `next`'s own `kind`
(`capture`/`message`/`script`/`prompt`/`stalled`) and `idle`; `land`'s own
`settled` and `idle`. `gtd land --sh` carries `settled`/`idle` alongside the
script itself, so ONE invocation both runs the landing and tells the driver
whether to stop — no second read needed to decide. A no-op at a `script` rest
settles right where it rests (stop immediately, nothing more to read); an
ordinary or squash landing that finishes the whole process instead resolves
`idle` on the FOLLOWING `gtd next` — the reference driver below reads once more
only to DISPLAY that gate's message, never to decide whether to stop. Declaring
a `C` edge on a `script` state is the workflow-side way to make the state
advance instead of settling.

### Drivers other than sh

The protocol above is JSON in (from `gtd next --json` alone), subprocesses out —
sh is one convenient shape, not the only one. A **program** parses
`gtd next --json`, switches on `kind`, and runs `gtd next`'s (plain-text) output
and `gtd land`'s (POSIX sh) output as subprocesses — no sh anywhere in it. A
**human** runs plain `gtd next` (there is no JSON form of it at all), does what
it says, and pastes `gtd land | sh`: plain-text output exists for exactly this,
printing the combined script ready to paste. An **agent** gets `gtd install` as
its instructions — the same protocol, in a form built to be pasted into a
context window rather than read. A **CI job** is the program case with the
`prompt` arm pointed at a headless agent CLI, and
`kind: "message"`/`kind: "stalled"` mapped onto "stop and report".

### A complete minimal driver

This is the whole protocol described above, compressed into a loop small enough
to paste from this README and own outright — save it as `~/.local/bin/gtd-loop`
(`chmod +x`) and it's the ready-to-run driver
[Driving the loop](#driving-the-loop) above points at; swap the `claude` line
for any agent CLI and it keeps working.

This exact fenced block is extracted and executed by
`tests/integration/features/readme-driver.feature` — renaming the heading above
or splitting the block into more than one fence breaks the build.

**Pipe the prompt to the agent CLI on stdin — never pass it as a command-line
argument.** A `prompt` beat's content embeds a full diff, and argv is capped:
roughly 1 MB on macOS, and POSIX guarantees only 4 KB (`ARG_MAX`). Both are
reachable by an ordinary diff, so a driver that passes the prompt as an argument
works in testing and then fails on the first large change, in a way that looks
like an agent error rather than a driver bug. The driver below pipes `$c`/`$out`
into `claude -p` over stdin for exactly this reason.

```bash
#!/usr/bin/env sh
set -eu

beat=1
while :; do
  # One invocation per beat: assign first, THEN eval — command substitution
  # inside eval's own argument would swallow a failed `gtd next` under
  # `set -e` (eval would see only the empty string and abort on some later
  # unset variable with a confusing message). Assigning to `out` first makes
  # this a simple command whose own exit status IS the substitution's, so
  # `set -e` aborts correctly on a genuine failure.
  out="$(gtd next --sh)"
  eval "$out"

  # `gtd_idle` (true iff the initial state, clean tree) is the one shape
  # that means the process is genuinely done — EXCEPT on the run's opening
  # beat: land it anyway, so a workflow whose initial state declares its own
  # clean-tree "C" pattern still gets a chance to fire.
  if [ "$beat" -gt 1 ] && [ "${gtd_idle:-}" = true ]; then
    gtd next
    exit 0
  fi

  case "$gtd_kind" in
    stalled) printf '%s\n' "$gtd_content" >&2; exit 1 ;;
    # you re-ran us resting here: you either edited something or accepted by
    # editing nothing, so land the opening beat either way. Later beats are
    # gates we just produced and you have not read yet — hand off.
    message) [ "$beat" = 1 ] || { gtd next; exit 0; } ;;
    capture) ;; # the human already acted — just land it
    script)
      sh -c "$gtd_content" >>"$gtd_log" 2>&1 || true ;;
    prompt)
      # $gtd_content embeds a full diff, so it goes to the agent over
      # stdin, never as an argv positional — argv is capped (~1 MB on
      # macOS, and POSIX guarantees only 4 KB, ARG_MAX), and a diff crosses
      # that far sooner than you'd expect.
      agent_turn() { printf '%s' "$gtd_content" | claude -p "$1" "$gtd_session_id" \
        ${gtd_model:+--model "$gtd_model"} \
        ${gtd_system:+--system-prompt "$gtd_system"} \
        --dangerously-skip-permissions >>"$gtd_log" 2>&1; }
      if [ "${gtd_session_resume:-}" = true ]
      then agent_turn --resume || agent_turn --session-id
      else agent_turn --session-id || agent_turn --resume
      fi
      n=0
      while [ -n "${gtd_validate:-}" ] && ! fix="$(sh -c "$gtd_validate" 2>&1)"; do
        n=$((n + 1)) && [ "$n" -gt 3 ] && { printf '%s\n' "$fix" >&2; exit 1; }
        # $fix IS the fix prompt, verbatim — piped for the same reason as
        # $gtd_content above. Whether `claude --resume` re-applies the
        # original session's model/system prompt is a harness detail gtd
        # cannot verify from outside, so this passes the identical
        # $gtd_model/$gtd_system on both calls rather than assume it does —
        # otherwise this fix turn might silently fall back to Claude Code's
        # own defaults while the turn that produced the file ran under the
        # workflow's own model and persona.
        printf '%s' "$fix" | claude -p --resume "$gtd_session_id" \
          ${gtd_model:+--model "$gtd_model"} \
          ${gtd_system:+--system-prompt "$gtd_system"} \
          --dangerously-skip-permissions >>"$gtd_log" 2>&1
      done ;;
  esac

  # `gtd land --sh` carries `settled`/`idle` alongside the script itself —
  # one invocation tells us both what to run and whether to stop, with no
  # second read needed to decide either.
  out="$(gtd land --sh)"
  eval "$out"
  printf '%s\n' "$gtd_script" | sh
  if [ "${gtd_settled:-}" = true ]; then
    [ "${gtd_idle:-}" = true ] && gtd next
    exit 0
  fi
  beat=$((beat + 1))
done
```

Line by line it is the protocol described above: `out="$(gtd next --sh)"` then
`eval "$out"` is one invocation per beat — assigning first is what lets `set -e`
abort correctly on a genuine failure, where `eval "$(gtd next --sh)"` would
instead eval the empty string and die later on some unrelated unset variable;
the driver carries no `unset` of its own, since the `--sh` document's own
preamble makes `eval` self-contained. The very first beat lands even when
`gtd_idle` is already true, so a workflow whose initial state declares its own
clean-tree `"C"` pattern still gets a chance to fire before the driver calls it
done. `kind: "stalled"` prints `$gtd_content` (the diagnosis itself) to stderr
and stops — no re-invocation needed, since the beat already fetched it;
`message` halts unless it is the opening beat, which the human's own
re-invocation authored and which therefore lands like any other decision (see
[Driving the loop](#driving-the-loop) above — this is the one place the driver,
not gtd, decides, because "has the human read this gate" is run-scoped knowledge
gtd deliberately does not keep); `capture` lands a human's already-made edit
outright, no display needed; `script` runs `$gtd_content` in the driver;
`prompt` sends it to the agent over stdin with
`$gtd_session_id`/`$gtd_model`/`$gtd_system` mapped onto the agent's session
flags — trying `resume`'s hinted flag first and falling back to the other on
failure, since the session id is derived, not remembered (see
[Driving the loop](#driving-the-loop) above) — and its own `$gtd_validate`
script's output re-prompted verbatim on failure (the driver owns only the retry
cap). Every optional variable (`$gtd_model`, `$gtd_system`, `$gtd_validate`,
`$gtd_session_resume`, `$gtd_idle`, `$gtd_settled`) is read as `${var:-}` or
`${var:+...}` — under `set -u`, the `--sh` document's own `unset` preamble makes
an absent field genuinely unset, not empty, so a bare `$gtd_model` would abort
the driver. Every landed turn is executed — and reported — by the emitted
scripts themselves, via `gtd land --sh`'s own `$gtd_script` field, captured then
piped to `sh`. `$gtd_settled` ends a run that has nothing left to do: a no-op at
a `script` rest settles right where it rests (stop immediately, nothing more to
read), while an ordinary or squash landing that finishes the whole process
instead resolves `$gtd_idle` on the FOLLOWING beat's own `gtd next --sh` read —
the reference driver reads once more (a plain `gtd next`) only to DISPLAY that
gate's own message, the decision to stop already made from `$gtd_settled`/
`$gtd_idle` alone.

This paste passes `$gtd_system` on argv, and POSIX guarantees only 4 KB of argv
(`ARG_MAX`) — real systems are far higher (roughly 1 MB on both macOS and
Linux), and the bundled personas are only a few KB each, so this works
everywhere in practice. A driver shipping much larger system prompts, or
targeting a platform sitting at the POSIX floor, should write the string to a
file and pass that instead: gtd's own contract ends at emitting `gtd_system` as
a string, and how a driver hands that string to its agent CLI — argv, a temp
file, or something else — is the driver's own call, since it alone knows its
platform's argv limit and whether it has a writable temp directory; gtd adds no
flag, no file, and no mechanism of its own for this. (The doc-test below only
proves this paste parses and runs against a `claude` shim — not that the flag is
spelled or placed correctly; that's a `claude --help` check plus one live run,
not something the green suite can catch.)

### The self-validation gate

After an agent turn at a state that declares `file:`+`mode:`, run the script:
either `gtd next --json`'s own embedded `.validate` field (present at every
`prompt` beat that hands over a validatable file), or, standalone,
`gtd validate`'s own plain-text output — both resolve the exact same script from
one shared resolver. This field is now populated even at a FIRST-WRITE beat,
before the steering file exists at all: the script itself carries a leading
`[ -f <file> ] || exit 0` guard rather than gtd checking existence ahead of
time, so a driver's `while [ -n "$gtd_validate" ]` repair loop is armed from the
very first turn at a state, not just the second and later ones. Exit 0 means the
file is well-formed (or genuinely doesn't exist yet) — proceed to `gtd land`. A
non-zero exit usually means the script's own captured output IS a complete,
ready-to-send fix prompt (an instruction plus the findings, see `src/Emit.ts`'s
`failurePromptWrapper`): send it back to the same agent session verbatim, and
cap how many fix attempts you allow yourself — the driver owns that retry count,
not gtd. Landing never TRUSTS that you validated, either: the emitted `land`
script carries the same format/validate commands ahead of its own commit and
fails without committing when they fail, so a malformed file is never captured
whether or not you ran the validate script first.

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
  rejected the turn). No script was ever produced.
- **`gtd` itself exits 2.** A usage error — nothing was even attempted, the
  invocation itself was wrong (unknown option/command, bad arity, a scope
  violation).
- **`gtd land` succeeds (exit 0) but doesn't settle.** This is NOT a failure:
  whose turn is next lives in the FOLLOWING `gtd next`'s own `kind` field, not
  in `gtd land`'s exit code (see [Exit codes](#exit-codes)) — and `gtd land`'s
  own stdout still carries a script (a print-only note, or a genuine
  retain+rewind, or an ordinary commit) that a driver must still run.
- **An emitted script exits non-zero when YOU run it.** Something may have
  partially happened — e.g. a `gtd_retry`-wrapped git write landed but a later
  step in the same script failed.

Recovery is the same in every case: **ask gtd again** (`gtd next`, then land).
It re-reads the real repository state fresh every time — never a cached plan —
and emits whatever still needs to happen from there. This works because every
emitted script opens by asserting its own precondition
(`[ "$(git rev-parse --verify --quiet HEAD 2>/dev/null)" = <expected> ] || { ...; exit 1; }`,
and the same shape for a review window's saved ref — see `src/Emit.ts`'s
`headAssertion`/`reviewWindowAssertion`), so a script generated against a
repository state that has since moved refuses loudly instead of corrupting
anything. **Emitted scripts are re-runnable**: this is the single most important
property for a driver's recovery logic. Re-running a script that already fully
applied is a no-op (its git writes are `--allow-empty` commits, idempotent ref
updates, and tolerant staged-restore calls), and re-running one that only
partially applied resumes correctly, because the precondition either still holds
(nothing landed yet — safe to retry verbatim) or gtd's next invocation reads the
new real state and emits a fresh script for what remains. A driver never needs
its own retry/resume logic beyond "if the script failed, ask gtd again."

### Prerequisites

- **A POSIX `sh`** (dash, ash, bash's own POSIX mode, etc.) — gtd's own emitted
  scripts (`gtd land`, `gtd --entry <state>`, `gtd abandon`, `gtd restore`) are
  POSIX sh; captured, then piped into it (see
  [Writing your own driver](#writing-your-own-driver) above).
- **`gtd` on `PATH`** — a mode's seeded `validate:` command (the one the
  compiler fills in for the built-in `qa`/`review` formats) is literally the
  string `gtd check <mode> '<file>'`, invoked by NAME from inside an emitted
  script, not by absolute path (see `src/SteeringFormats.ts`'s
  `seededValidateCommand`). This is a deliberate trade: a readable, overridable,
  copy-pasteable command in exchange for depending on shell name resolution at
  the moment the script runs. The sharp edge: if the `gtd` binary you invoked to
  GENERATE the script differs from the `gtd` that resolves on `PATH` when the
  script later RUNS (a locally-built dev binary vs. a globally-installed
  release, say), you can get version skew between the two — the command that
  validates may not be the command that decided. Keep the two in sync (one `gtd`
  on `PATH`, consistently) if you care about that gap.

### The normalization-only contract on `format:`

A mode's `format:` command may reformat a steering file — whitespace, wrapping,
reordering — but must NEVER change what a land-capture guard would decide. gtd's
guards (the review-doc check, the feedback-progress check, the
answer-completeness check, the require-revert check — `src/StepGuards.ts`)
decide ONCE, against whichever bytes are on disk at the moment `gtd land` runs,
which may be before OR after an emitted script's own `format:` line has run (the
script runs `format:` then `validate:` then the commit — see
`src/SteeringMode.ts`'s `renderSteeringCommands` — but gtd's decision and the
driver's script execution are different processes at different times, so there's
no guaranteed ordering between "gtd decided" and "the script formatted"). That's
only safe because every built-in guard judges only the content it explicitly
cares about, not incidental formatting around it — the feedback-progress guard,
for instance, only checks whether a deleted file's trimmed first line is the
`NOTHING ACTIONABLE` sentinel, so reindenting the rest of it changes nothing the
guard reads. If you plug in your own `format:` command, the same rule binds it:
a formatter that also changes meaning — stripping a paragraph a guard reads —
makes the guard's decision and the file's actual content disagree, and gtd will
not catch that for you.

One case never runs your `format:` (or `validate:`) at all: a step whose diff
DELETES the state's own `file:`. Deleting it is a legitimate outcome — a review
sign-off's whole diff is the review doc's deletion — and there is nothing left
to format. Emitting the command anyway would make such a step unlandable, since
`format:` is the first line of a `set -eu` script and a formatter like
`prettier --write` exits non-zero on a path that is not there.

### Built-in steering formats are ordinary modes

`qa` and `review` are gtd's two built-in steering-file formats (parsed and
validated in-process because `gtd lsp` needs the same parsers for live
diagnostics), but their `validate:` is not hardcoded or hidden: the compiler
SEEDS every workflow's `modes:` map with `qa`/`review` entries whose `validate:`
is the same `gtd check <mode> '<file>'` string described above
(`src/PatternConfig.ts`, `src/SteeringFormats.ts`'s `seededValidateCommand`).
That seeded command is visible in `gtd visualize`'s compiled model and in the
editor JSON schema like any other mode, and it's overridable the same way any
mode is — declare `modes: { qa: { validate: "your-own-command" } }` (in the
workflow or in `.gtdrc`) and your command displaces the seed; declaring only a
`format:` for `qa`/`review` composes with the seeded `validate:` rather than
replacing it. There is no special-cased built-in behavior a driver needs to know
about beyond the ordinary mode-resolution rules already documented under
[The `workflow:` key](#the-workflow-key).

## Configuration

gtd reads an optional `.gtdrc` config file via
[cosmiconfig](https://github.com/cosmiconfig/cosmiconfig). With no `workflow:`
configured anywhere in the cwd→home config chain, the bundled unified workflow
is used automatically, so a state command works out of the box with no config at
all. Supported filenames (searched in this order):

- `.gtdrc`
- `.gtdrc.json`
- `.gtdrc.yaml`
- `.gtdrc.yml`
- `gtd.config.json`
- `gtd.config.yaml`

### Schema

`.gtdrc` has exactly three blessed top-level keys:

- **`workflow`** (object, optional) — the whole machine definition (its states,
  plus its own `vars:` defaults and `modes:`). Absent = gtd's built-in default
  is used. Declare it to fully REPLACE that default with your own machine (there
  is no `extends`/merge).
- **`vars`** (object, optional) — a flat `name -> scalar` map, one layer of the
  merged `it.vars` every template sees.
- **`modes`** (object, optional) — steering-file modes (`format:`/`validate:`
  shell commands), layered over the active workflow's own `modes:` and gtd's
  built-in validators, so a project can plug in its formatter or linter without
  re-declaring that mode on the workflow itself.
- **`$schema`** (string, optional) — stripped before validation, so it never
  counts as an unknown key. Point it at the published schema for editor-backed
  autocompletion (this is what `gtd init` writes):

  ```
  https://cdn.jsdelivr.net/npm/@pmelab/gtd/schema.json
  ```

  That URL serves `schema.json` straight out of the published npm tarball, so it
  always matches the latest release. Pin it to a major with
  `@pmelab/gtd@8/schema.json`, or point at your own install
  (`./node_modules/@pmelab/gtd/schema.json`) to work offline.

Any other top-level key is **rejected**. The engine blesses no VARIABLE NAMES
either — `testCommand` is workflow-authored data like any other `it.vars` entry,
not a special key gtd interprets.

### The `workflow:` key

A declared `workflow:` key fully REPLACES gtd's built-in default. The built-in
default is itself a YAML asset (`src/workflows/unified.yaml`) compiled through
the exact same compiler your own `workflow:` value goes through — no privileged
code path. Its shape:

```yaml
workflow:
  vars: # optional — the workflow's own declared `it.vars` defaults
    anyKey: anyScalarValue
  modes: # optional — steering-file modes a state's `mode:` may name
    <name>:
      format: <shell command> # both optional — {} is the format-only tier
      validate: <shell command>
  entry:
    default: <machine name> # which machine is the ROOT instance
  machines:
    <name>:
      model: <string> # optional, opaque harness hint — stamped onto every one of THIS machine's own `prompt` states; declared ONCE per machine, never per state
      params: [<param>, ...] # optional, advisory — documents which $params a caller may bind
      entry: <local or ref key> # this machine's own default local, resolved recursively
      states:
        <local>:
          actor: <string> # forbidden on a commit state, required otherwise
          script: <string> # exactly one of script/prompt/message/commit
          prompt: <string>
          message: <string>
          commit: <string>
          on: # a mapping, DECLARATION ORDER PRESERVED
            "<pattern>": <targetState> # short form
            "<pattern>": {
                to: <targetState>,
                describe: <sentence>,
                action: <label>,
              } # description/action
          retry:
            max: <number>
            otherwise: <targetState>
          label: <string> # optional, opaque display name passed through `gtd next --json`
          file: <string> # optional, an Eta template naming the state's steering file RELATIVE to ".gtd/" — the compiler prepends that directory automatically
          mode: <modeName> # optional, requires "file" — must be declared in `modes:` (qa/review are seeded for you; everything else, including prose, you declare)
          reviewWindow: true # optional — open the review checkout window at rest here
          reviewBase: true # optional — anchor the review window's diff base to this state's most-recent commit
          # reviewBase: <Eta template> # OR a template — rendered (only meaningful entering via --entry) to a commitish that fixes the WHOLE PROCESS's diff base
          requireProgress: true # optional, requires "file" — refuse a turn whose only change deletes this state's own `file:`
          answerGate: true # optional, requires "file" — refuse a turn until every open question in the (qa-mode) `file:` is answered
          requireRevert: true # optional, requires "file" — refuse a turn until the human's review-round paths actually match the review base's parent
          entry: true # optional — an EXTRA reachability root (`entries.manual`), enterable via `gtd --entry <this state's qualified name>` — NOT a precondition for `--entry` (any declared, non-commit state is a valid target)
        <local>: { machine: <name>, with: { <param>: <value> } } # a REFERENCE — instantiates <name> as a child, qualified as `<local>.<childLocal>`
```

There is no `memory:` key anywhere in this shape — a state's memory scope is
never authored, only computed from its position in the machine tree (see
[Driving the loop](#driving-the-loop) above for the key format and how it
derives a driver's session id).

The top-level `entry:` key (naming the root machine, `entry.default`) and a
state's own `entry: true` flag are the same word at two different levels, by
design: one selects the workflow's root machine, the other opts one state in as
an extra manual entry point.

A workflow is authored as a TREE of reusable, parameterized machines — a
gate/loop written once and instantiated several times with different `with:`
bindings (dedup), or a complex cluster grouped under one name for source
comprehension (encapsulation). Every reference is expanded at load time into
concrete, qualified states (`<local>.<childLocal>`, however deep) before the
engine ever sees the definition — see `src/Machines.ts` for the mechanism.
MACHINE BOUNDARIES ARE THE UNIT OF CONVERSATIONAL IDENTITY: a machine that holds
an identity (a planner or a coder persona) declares its own `model:` once, at
the machine level, instead of repeating it per state — and, per the memory rule
above, two references to the SAME machine (a dedup instantiation) are always two
independent instances with two independent memory scopes, never one shared
conversation across both call sites.

Besides `it.vars` (below), a `script`/`prompt`/`message`/`commit` template sees:

- **`it.startCommit`** — the process's diff base (the commit the current process
  started from, or the base a `--var reviewBase=<commitish>` entry resolved to).
- **`it.reviewBase`** — the previous review round's boundary, falling back to
  `it.startCommit` on a first review. In the bundled template, an actionable
  round's NEXT review therefore covers the revert of the human's own lines
  (`re-unwind`) followed by the whole lap that re-derives and re-implements them
  — the net diff is the final implementation, the right thing to review, but no
  longer the tiny "just the fixes" delta a quick fix-and-re-review would have
  shown.
- **`it.retainedBase`** — the process's trace/retry boundary, what a squash
  actually keeps (never moved by a review entry's fixed base).
- **`it.currentCommit`** / **`it.previousCommit`** — HEAD's hash and its parent,
  at render time.

A template never sees rendered diff CONTENT — no field carries a diff. It names
a base and leaves the agent to run `git diff <base>` itself; this keeps every
render cheap (no diff computed on `gtd next`/`gtd lsp`) and the prompt small and
cacheable.

Authoring or editing a workflow with a coding agent? `skills/authoring/SKILL.md`
is the agent-facing contract for producing a valid `workflow:` — the state
model, pattern grammar, load-time rules, and how to verify a change compiles.

> **Upgrading from a pre-8.2 `workflow:`?** The old flat `states:` shape (with a
> per-state `initial: true`/`reviewEntry: true`/`fixEntry: true` flag) is no
> longer accepted — finish or `gtd abandon` any in-flight process before
> upgrading, since the old and new shapes aren't compatible mid-process. Wrap
> your states under a single
> `machines: { <name>: { entry: <initial state>, states: {...} } }` and declare
> `entry: { default: <name> }` at the top level (moving any
> `reviewEntry`/`fixEntry` state to a plain per-state `entry: true` flag,
> entered via `gtd --entry <state>` — see the next note).

> **Upgrading a `workflow:` that still declares `entry.review`/`entry.fix`?**
> Those two keys, and the `gtd review <commitish>`/`gtd fix` commands that used
> them, are gone. Replace `entry.review: <target>`/`entry.fix: <target>` with a
> plain `entry: true` flag on that same state, and enter it with
> `gtd --entry <state>` instead of the removed commands.
> `gtd review <commitish>` required a clean tree and a `<commitish>` argument;
> the replacement instead captures whatever is pending in the working tree (just
> like an ordinary `gtd land`) and takes the commitish as a
> `--var reviewBase=<commitish>` override consumed by that state's own
> template-form `reviewBase:` (see the `workflow:` shape above and
> [`gtd --entry`](#commands)). `gtd fix` likewise becomes
> `gtd --entry <the state that was entry.fix>` (e.g. the bundled template's
> `gtd --entry fix-precheck`).

> **Upgrading a `workflow:` that still declares a per-state `model:` or
> `memory:`?** `model:` moved from a state key to a MACHINE key: declare it once
> on the `machines.<name>:` entry instead of on every one of that machine's
> states — it is stamped onto every one of that machine's own `prompt` states
> automatically (see the `workflow:` shape above). A state that still declares
> its own `model:` is a load error naming the machine to move it to, never a
> silently ignored key. `memory:` is gone outright, with **no** replacement key
> — a workflow author simply removes it; a state's memory scope is now computed
> from its position in the machine tree instead of authored (see
> [Driving the loop](#driving-the-loop)). The bundled template was also
> restructured so machine boundaries line up with this new identity model,
> renaming twenty-two states:
>
> - `building` → `build.building`
> - `decompose` → `build.decompose` → `design.decompose`
> - `squashing` → `build.squashing`
> - `review.building` → `build.addressing`
> - `packages.building` → `packages.item.building`
> - `packages.closing` → `packages.item.closing`
> - `packages.health.check` → `packages.item.health.check`
> - `packages.health.fix` → `packages.item.fix-suite`
> - `packages.health.escalate` → `packages.item.health.escalate`
> - `packages.spec.review` → `packages.item.spec.review`
> - `packages.spec.fix` → `packages.item.fix-spec`
> - `build.check` → `build.health.check`
> - `build.escalate` → `build.health.escalate`
> - `review.reviewing` → `build.review.reviewing`
> - `review.await-review` → `build.review.await-review`
> - `review.deciding` → `build.review.deciding`
> - `review.collecting` → `build.review.collecting`
> - `product.author` → `design.product-author`
> - `product.answer` → `design.product-answer`
> - `technical.author` → `design.technical-author`
> - `technical.answer` → `design.technical-answer`
>
> (`decompose`'s two hops both land in this same release, so a process upgrading
> from before either restructure only ever sees one hop: `decompose` →
> `design.decompose`.) Because of these renames, an in-flight process left
> resting at one of the old qualified state names can no longer be resumed after
> upgrading — those names no longer exist in the definition, and gtd refuses
> loudly rather than silently treating the rest as idle. Run `gtd abandon` to
> discard it and start over (or finish the process on the pre-upgrade workflow
> version first).

> **Upgrading a `workflow:` from the old two-flow (`.gtd/TODO.md` vs.
> `.gtd/REQUIREMENTS.md`) shape?** The bundled template collapsed that fork into
> one flow: `idle` now has a single outgoing edge — any change at all starts the
> process, never a fork on which steering file you create — and
> `plan-gate.check`/`spec-gate.check` merged into one shared `start-gate.check`.
> The old plan-iteration machine's `plan.planning`/`plan.await-plan` states and
> its monolithic `build.building` state are gone outright; every concern now
> goes through the same per-package build queue instead. Renamed:
> `design.product-author` → `design.triage`, `design.product-answer` →
> `design.gate.answer`, `design.technical-author` → `architecture.author`,
> `design.technical-answer` → `architecture.gate.answer`, `design.decompose` →
> `architecture.decompose` (architecture is now its own sibling machine with its
> own memory scope, not nested under `design`). The `prose` mode is gone and
> there is no more free-form _plan_ file — `todoFile` itself came back later
> with a different job: `idle`'s own mode-less `file:` hint, gtd's sketch pad
> that no state writes or reads. As with every rename above, an in-flight
> process resting at one of the old names can no longer be resumed;
> `gtd abandon` it (or finish it on the pre-upgrade workflow version) before
> upgrading.

> **Upgrading a `workflow:` that still references `build.addressing`?** That
> state is REMOVED, not renamed — the implementer's own follow-through on review
> feedback is gone outright, since an actionable review round is now re-planned
> from scratch through a new root-level `re-unwind` state (reverting the human's
> hand-edit) instead of being built upon. A non-actionable round (an approving
> remark with no code edit) short-circuits straight to `build.squashing` instead
> of spending a lap on nothing. As with every rename above, an in-flight process
> resting at `build.addressing` can no longer be resumed after upgrading;
> `gtd abandon` it (or finish it on the pre-upgrade workflow version) first.

### Variables

Every template — `script`/`prompt`/`message`/`commit`, a machine's own `model:`,
and a state's `file:` — sees `it.vars`: a flat `Record<string, string>`
assembled from four layers, **later wins**:

1. **The workflow's own `vars:` key** (sibling to `entry:`/`machines:`) — the
   workflow author's declared defaults. The unified template declares
   `vars: { testCommand: "npm test" }`, read by `build.health.check`'s script as
   `<%~ it.vars.testCommand %>`.
2. **A top-level `.gtdrc` `vars:` key** (a sibling of `workflow:`, NOT nested
   inside it) — per-repo tuning without redefining the whole workflow.
3. **The current process's entry `--var` overrides**, if it was started via
   `gtd --entry <state>` — repeatable `--var <name>=<value>` flags fixed at the
   moment of entry and recorded as `Gtd-Var: <name>=<value>` trailers on the
   process's oldest commit, re-parsed on every turn for as long as that process
   is underway. Each `--var` name must already be declared by layer 1 or 2; an
   undeclared name is a usage error, not a silent no-op.
4. **`GTD_<UPPERCASE-name>` environment variables** — highest precedence,
   checked at every invocation, case-insensitively against each name already
   declared by layers 1–3: `GTD_TESTCOMMAND` overrides `testCommand`. The
   environment can only OVERRIDE a name an earlier layer already declared — a
   `GTD_*` var matching no declared name is silently ignored.

Values in layers 1–2 must be YAML scalars (string/number/boolean), coerced to
strings at load time; an object or array value is a load error. A `--var` value
(layer 3) is always a single-line string as given on the command line.

```yaml
# .gtdrc — overriding the unified template's testCommand
vars:
  testCommand: npm run test:ci
```

```bash
# highest precedence — beats both the workflow default and the .gtdrc value above
GTD_TESTCOMMAND="npm run test -- --bail" gtd next
```

#### The voice

gtd ships its own writing voice for the files it generates — the default, not an
opt-in. It is a specialisation of the "Spartan" output style from
[alexgreensh/attention-span](https://github.com/alexgreensh/attention-span)
(AGPL-3.0), written from a reading of that project's version `0.6`: gtd's own
prose stating the same density discipline, rewritten for deliverables (files
that run as long as the work needs) rather than chat replies. No upstream text
ships in gtd's bundle. This is a point-in-time derivation with no refresh
mechanism — it will silently go stale as upstream moves on, and nothing in gtd
will notice.

It is two independently-overridable variables, each an ordinary `vars:` entry
that can be overridden or blanked through the same layers as any other (a
top-level `.gtdrc` `vars:` key, or the matching `GTD_STYLEBLOCK` /
`GTD_STYLEFORMATCONTRACT` environment variable):

- **`styleBlock`** — the voice itself, injected at all seven prompt states that
  generate content, not just three: the free-prose ones — the `.gtd/packages/`
  package files (`architecture.decompose`), `.gtd/SPEC_FEEDBACK.md`
  (`packages.item.spec.review`), and `.gtd/COMMIT_MSG.md` (`build.squashing`) —
  plus the four machine-parsed states named in the next bullet. Blanking
  `GTD_STYLEBLOCK` strips the voice from all seven, including the machine-parsed
  ones, not only the free-prose three. In short: why density matters before any
  rule, answer-first with no preamble or restatement, blunt and imperative,
  plain words, bold carries the load, ship the artifact bare, compressing is not
  dropping, one idea per block, flag risk in one blunt line, never narrate the
  work — and never-trim outranks every other rule in the set.
- **`styleFormatContract`** — the structural override for machine-parsed files:
  the format contract (headings, checkbox rows, marker lines) outranks the
  voice, and a violation refuses the turn. It renders at the top of the prompt,
  ahead of the role sentence and well before any state-specific format-contract
  text — `styleBlock` first, then `styleFormatContract`, at the four prompt
  states whose output a parser reads: the two `qa`-mode steering files
  (`.gtd/REQUIREMENTS.md` at `design.triage`, `.gtd/ARCHITECTURE.md` at
  `architecture.author`) and the `review`-mode one (`.gtd/REVIEW.md` at
  `build.review.reviewing`), plus `.gtd/REQUIREMENTS.md` again at
  `build.review.collecting`, which classifies a review round straight into it.

Three more generated files carry no injected voice, because a script — not an
agent — writes them: `.gtd/FEEDBACK.md` (verbatim test-suite output plus a HEAD
stamp — the tool's content, not gtd's prose), `.gtd/NEXT.md` (a bare path, no
prose to style), and `.gtd/REVIEW_RAW.md` (gtd's own prose, hand-tightened in
the voice directly in `build.review.deciding`'s script rather than templated in
through either variable).

### Lookup and precedence

gtd walks from the current working directory **up to your home directory** (or
to the filesystem root when cwd is outside home), collecting every `.gtdrc` it
finds along the way. All found levels are **deep-merged**, with the **innermost
(cwd) config winning** on conflicts — so a shared `.gtdrc` in a worktree-parent
directory cascades to every checkout beneath it, while any individual checkout
can still override with its own `.gtdrc`.

### Validation and errors

Config-shape problems (unknown keys, wrong types, unreadable file references)
are collected together; if the shape is clean, the assembled definition is
additionally run through the engine's own validation. A bad config throws
**one** error listing every finding, at load time — before anything touches the
repository — never partially, and never deferred to land time:

```
workflow config:
  - state "idle": must declare exactly one of script/prompt/message/commit (found 2)
  - state "idle": "on" target "nowhere" is not a defined state
```

Those findings include the **semantic graph checks**: every `on` target and
`retry.otherwise` must name a defined state, and every state must be
**reachable** from the initial state. All load failures exit **1** and write to
**stderr**, never stdout.

Many of these problems never reach gtd at all if your editor validates against
the [published schema](#schema), which fully types the `workflow:` key. The
rules JSON Schema cannot express — exactly one content kind, `entry.default`
resolving to a real state, targets naming defined states, reachability — remain
the compiler's job at load time.

## Repository requirements

- **Single writer, linear branch.** A process's history is walked via
  **first-parent** commits only.
- **Test/build artifacts must be gitignored.** This is **load-bearing**, not a
  style preference: every land decision detects "clean" via
  `git diff --name-status HEAD` (tracked changes) unioned with
  `git ls-files --others --exclude-standard` (untracked files, classified by
  content against the base — one that is already there with the same bytes is
  not a change, and a file that exists on disk is never reported as a deletion,
  however the index sees it), which silently omits anything matched by
  `.gitignore`. If a `script` state's command (or the build it triggers) writes
  output — a `dist/`, a coverage report, a log file — into the working tree, the
  tree never goes clean after a green run, and the check's `"C"` pattern never
  fires. Gitignore every path your scripts write before wiring gtd into a repo.
- **Repository root invocation.** Every state subcommand must run from the git
  repository root. `--help`/`--version` (and the `help`/`version` subcommands),
  `lsp`, `init`, `visualize`, `check`, and `install` skip this guard entirely
  (`visualize` still reads the `.gtdrc` workflow, but needs no git state; `init`
  may even run outside a repository to seed a shared parent-dir config).
- **Linked worktrees are independent.** N `git worktree` worktrees of one
  repository (sharing a single `.git`) each run their own gtd process: state is
  derived from that worktree's own HEAD, and the review checkout window's refs
  live in git's per-worktree `refs/worktree/gtd/*` namespace, so a review
  resting in one worktree neither blocks nor rewrites any other.

## Editor integration

`gtd lsp` starts an LSP server over stdio for `.gtd/` steering files — a symbol
per `review`-mode chunk that still has an unchecked hunk (an outline of the
packages left to review) plus check/uncheck actions over those chunks,
go-to-definition from a `review`-mode hunk line into the file it points at (at
its `#line` — a hunk's path is a single whitespace-delimited `./`-relative
token, so a hyphen in a filename stays part of the path, never a note
separator), symbols over a `qa`-mode file's open questions plus "pick this
option"/"uncheck this option" code actions on each option — offered anywhere on
the option's list item, including any wrapped continuation lines, not just its
own `- [ ]` line — diagnostics for both (live as you edit), and a
`gtd.openSteeringFile` command that jumps to the current state's steering file —
including `idle`, whose `.gtd/TODO.md` hint gives the one keybinding an answer
even before a process has started. The command only names that path — it never
stat-checks or creates it — so on a repo that has never run gtd, `.gtd/` may not
exist yet and editors differ on opening a file whose parent directory is missing
(an empty buffer that creates it on save vs. refusing the path outright); this
bites only the very first sketch in a fresh repo, since the workflow's own check
scripts create the state directory on the first `gtd next`/`gtd land`.

It is config-driven via each state's `file:`/`mode:`, and falls back to basename
dispatch (`REVIEW.md` → `review`) with no config in sight. `qa` and `review` are
gtd's built-in steering-file FORMATS, each with its own outline/actions/
go-to-definition and a VALIDATOR gtd itself implements; a mode's `format:` and
`validate:` are shell commands a workflow (or a project's `.gtdrc`) declares for
itself, so you bring your own formatter and your own checkers. Overriding one of
`qa`/`review`'s `validate:` with a shell command does NOT lose its outline/
actions — those come from the FORMAT (the name), independent of who validates —
but `gtd lsp` never runs a shell command per keystroke, so live diagnostics
become one `Information` notice pointing at `gtd validate` instead of the
built-in findings. Any OTHER mode name — a project's own declared name (e.g.
`prose`, for a free-form note) — has no built-in format, so it gets no live
editor support at all: `gtd validate`'s emitted script and the `gtd land` gate
still format and validate it like any other mode.

## Development

```bash
npm install
npm run dev          # run from source, no build (node dev/run.mjs)
npm run build        # tsdown → dist/gtd.bundle.mjs
npm test             # the whole gate, via turbo — cached and parallel
npx turbo run test:unit         # one task, cached (add --force to bypass)
npx turbo run test:e2e:live     # builds first (turbo dependsOn), then @live
npm run test:changed # local pre-flight: only unit/@inmem tests git says changed
npm run test:mutation # StrykerJS mutation testing (manual only, ~10 min)
npm run typecheck
npm run lint
```

`npm test` is a turbo task graph (`turbo.json`): each check declares its own
`inputs`, so an unchanged check is skipped, and a check that does run is run in
parallel with the others. Caveat from the `test:e2e:live` task's `build`
dependency: a bare `npm run test:e2e:live` skips the build, so use
`npx turbo run test:e2e:live` to test against a fresh bundle.

A pre-commit hook is installed automatically via the `prepare` script when you
run `npm install` on a fresh clone — it runs
[lint-staged](https://github.com/lint-staged/lint-staged) with
[oxfmt](https://oxc.rs/docs/guide/usage/formatter.html), mirroring the
`format:check` step enforced in CI.

The decision core is pure and IO-free: the pattern machine's shape (states,
patterns, retry) is a plain-data `WorkflowDefinition` (`src/PatternMachine.ts`),
and the same module's `resolveState`/`step` are the pure resolver/interpreter
over it — so the whole engine is trivially unit-testable in isolation. All
git/filesystem/template IO is confined to the edge (`src/Edge.ts`), whose
`currentRest` resolves everything derivable from where the process rests right
now into a single snapshot, and whose `planStep`/`planEntry` pair separates
deciding a transition from performing it — so a command's own capture guards run
between the two. The edge reaches the outside world through two content ports
(`src/RepoFiles.ts` for working-tree and committed reads, `src/CommandRunner.ts`
for the one place gtd spawns a subprocess itself), with the `gtd land` capture
guards (`src/StepGuards.ts`) built on top of them.

`src/testing/` holds the in-memory git/config/filesystem test double every
`@inmem` scenario and unit test runs against instead of a real repo — it never
ships (a lint rule and a build-time check both enforce that) and is trustworthy
only because the same `GitOperations` contract suite runs against a real git
repo too.

Releases are automatic: push releasable Conventional Commits (`fix:`, `feat:`,
or breaking changes) to `main` and semantic-release computes the next version,
builds the bundle, tags it, and publishes.

## License

MIT
