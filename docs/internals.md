# Internals

## How it works

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
check on the way back into planning. The review tail is nested inside that build
identity rather than sitting beside it, so a late-breaking fix and the review
turns that follow it all resume the SAME session that built the feature — an
actionable round leaves that identity entirely, so it starts a fresh session
like any other process. Landing the sign-off itself is a plain check step, not a
prompt turn, so no session drafts anything there: a comment is what asks for
changes; landing with no comment signs off, whatever the boxes say, which lands
one more ordinary `gtd(...)` commit entering the workflow's initial state —
every turn commit this process made stays on the branch. Run `gtd summary`
afterward for a closing-message prompt — a cold read of the commits it names,
not a resumed conversation. Deleting `.gtd/REVIEW.md` is refused — the guard
only asks whether the step's diff deletes the file.

A second entry, the same review tail's own direct entry point —
`gtd --entry review-gate.check --var reviewBase=<commitish>` starts a brand new
process reviewing `<commitish>..HEAD` with no build of its own on a clean
sign-off, e.g. a colleague's PR branch (`review-gate.check`'s `reviewBase:` is a
template bound to the `reviewBase` var, so supplying it via `--var` fixes the
whole process's diff base to that commitish) — though an actionable round on
this entry runs the same full triage → gates → architecture → package-queue lap
as any other, same as `re-unwind` re-plans a build process's own review
feedback. A clean sign-off on this entry closes a process whose trace holds only
the fixes made _during_ the review (not the reviewed changeset) — `gtd summary`
afterward names only those. A third entry, `gtd --entry fix-precheck`, starts
from a clean `idle` and goes straight into repairing a red baseline — repair,
then review, landing an ordinary commit entering `idle`. If the suite is already
green there is nothing to fix, and the log is left untouched — no commit is left
behind.

`--entry` itself isn't limited to states flagged `entry: true` — it accepts
**any** declared state of the active workflow (see
[`gtd --entry`](./cli.md#commands)). `entry: true` only marks a state as an
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

To inspect or change the machine itself, see [Configuration](./configuration.md)
— the workflow is just `.gtdrc` config.

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
