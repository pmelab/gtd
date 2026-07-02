---
name: gtd
description:
  Use when the user wants to take the next git-aware, conventional-commits step
  on the current repo — planning with TODO.md, refining a plan, decomposing into
  work packages, executing packages with parallel subagents, committing pending
  changes, running the test suite, or reviewing the changes on the current
  branch. Also triggers on "gtd", "what's next", "take the next step", `/gtd`,
  "review changes", or "start a review".
compatibility: Requires Node 20+, pi-subagents for orchestration
allowed-tools: Bash(node:*)
---

# gtd

Generates the next prompt for the autonomous coding agent by folding the repo's
commit history and working tree through a 16-state event-sourced machine that
resolves to exactly one active state per invocation.

## How to use this skill

1. Run the bundled script from the user's current working directory:

   ```bash
   node scripts/gtd.js
   ```

   Resolve `scripts/gtd.js` relative to this skill's directory, not the user's
   repo. The script must be invoked with the user's **repository root** as cwd
   so it can read `git status`, commit history, and diffs — gtd refuses to run
   from a subdirectory (or outside a repository) with a clear error rather than
   mis-deriving state. The only supported subcommand is `format <file>`; there
   is no `gtd transport` command — a `gtd: transport` HEAD is hand-committed by
   the user and consumed by the Transport state.

2. Treat the script's stdout as a complete, self-contained prompt — read it and
   follow its instructions verbatim. Do not edit, paraphrase, or summarize it
   before acting.

## Steering files

`gtd` writes and commits temporary files that encode the in-progress state:

- **TODO.md** — the current plan (grilling / planning phases)
- **.gtd/** — ordered work packages; numbered subdirs, each holding task `.md`
  files
- **FEEDBACK.md** — test output or agentic-review findings to fix; an **empty**
  FEEDBACK.md signals a clean review (→ Close package)
- **ERRORS.md** — escalation gate: committed test failure output; the loop halts
  until a human removes it
- **REVIEW.md** — guided human review; committed while awaiting input

Steering files are authoritative: while any exist, gtd resumes that workflow
regardless of the last commit. Stale steering files from abandoned branches are
resumed exactly like live ones — `rm` them manually to discard.

## State detection (three layers, first match wins)

Detection combines:

1. **Steering-file presence/absence** — which files exist on disk
2. **Committed vs. uncommitted** — git status (e.g. REVIEW.md freshly written
   vs. already tracked at HEAD)
3. **Last commit subject** — the `gtd: <phase>` subject disambiguates states the
   filesystem alone cannot separate

Precedence ladder:

| Priority | Condition                                                     | State              |
| -------- | ------------------------------------------------------------- | ------------------ |
| 0        | HEAD `gtd: transport`                                         | Transport          |
| 1        | ERRORS.md present                                             | Escalate (STOP)    |
| 2        | FEEDBACK.md present, non-empty                                | Fixing             |
| 2        | FEEDBACK.md present, empty                                    | Close package      |
| 3        | .gtd/ modified                                                | Planning           |
| 3        | .gtd/ + code dirty / pending ERRORS.md deletion / no-op fixer | Testing            |
| 3        | .gtd/ clean + HEAD `gtd: planning` or `gtd: package done`     | Building           |
| 3        | .gtd/ clean + HEAD `gtd: building`                            | Agentic Review     |
| 4        | REVIEW.md + HEAD `gtd: review feedback` (lost seed)           | Accept Review      |
| 4        | REVIEW.md committed + clean tree                              | Done               |
| 4        | REVIEW.md committed + dirty tree                              | Accept Review      |
| 4        | REVIEW.md uncommitted                                         | Await Review       |
| 5        | Boundary HEAD + pending changes (no committed TODO.md)        | New Feature        |
| 6        | TODO.md + `<!-- user answers here -->` marker                 | Grilling (STOP)    |
| 6        | TODO.md + no marker + dirty                                   | Grilling (iterate) |
| 6        | TODO.md + no marker + clean                                   | Grilled            |
| 7        | Clean tree + boundary/`package done` HEAD + reviewable diff\* | Clean              |
| 7        | Clean tree + boundary/`package done` HEAD, otherwise          | Idle               |

\* Reviewable = the workflow-file-filtered diff since the review base is
non-empty AND commits exist after the last `gtd: done` (or none exists) — an
approved review settles Idle instead of immediately re-firing.

A "boundary" commit is any non-`gtd:` subject, or exactly `gtd: done`.

## The 16 states

**Six edge-only states** (no prompt — driver performs their action, then
re-gathers and re-resolves automatically):

| State         | Action                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| Transport     | Mixed-reset the `gtd: transport` HEAD into the working tree                                                    |
| New Feature   | Commit raw input `gtd: new task`, revert it, seed TODO.md                                                      |
| Testing       | Commit pending code `gtd: building`; run tests; on red write FEEDBACK.md or ERRORS.md and commit `gtd: errors` |
| Accept Review | Capture the changeset `gtd: review feedback` (commit-then-revert), remove REVIEW.md, seed TODO.md              |
| Close package | Remove FEEDBACK.md + finished package dir + empty .gtd/, commit `gtd: package done`                            |
| Done          | Remove REVIEW.md, commit `gtd: done`                                                                           |

**Ten prompt-bearing states**:

| State              | Auto-advance | Human gate                                                    |
| ------------------ | ------------ | ------------------------------------------------------------- |
| Grilling (iterate) | yes          | —                                                             |
| Grilling (STOP)    | —            | answer `<!-- user answers here -->` markers inline in TODO.md |
| Grilled            | yes          | —                                                             |
| Planning           | yes          | —                                                             |
| Building           | yes          | —                                                             |
| Fixing             | yes          | —                                                             |
| Agentic Review     | yes          | —                                                             |
| Clean              | —            | — (agent writes REVIEW.md, then stops)                        |
| Await Review       | —            | human reviews and edits (or approves by running gtd clean)    |
| Escalate           | —            | human fixes tests, removes ERRORS.md to resume                |
| Idle               | —            | terminal — nothing to do                                      |

Auto-advance states append a directive telling the agent to re-run `gtd`
immediately after completing the step. STOP states halt for human input.

## Build orchestration

When TODO.md converges (no `<!-- user answers here -->` markers, clean tree),
the build loop runs:

1. **Grilled → Planning**: A planning-model subagent decomposes TODO.md into
   `.gtd/` packages. Each numbered directory is a sequential package; each `.md`
   file inside is a parallel task. There is no `COMMIT_MSG.md` — the edge
   commits code automatically as `gtd: building`.

   ```
   .gtd/
     01-<name>/
       01-<task>.md
       02-<task>.md
     02-<name>/
       01-<task>.md
   ```

2. **Building**: Selects the first remaining package, inlines all its task `.md`
   files into the prompt, and spawns one execution-model subagent per task in
   parallel. The agent commits code; Testing verifies it.

3. **Testing** (edge-only): Commits pending code `gtd: building`, runs
   `testCommand`. On green → Agentic Review. On red → writes FEEDBACK.md,
   commits `gtd: errors`; when `testFixCount >= fixAttemptCap` (default 3)
   writes ERRORS.md instead → Escalate.

4. **Fixing**: Commits FEEDBACK.md removal (`gtd: fixing` if the FEEDBACK.md was
   committed by Testing; `gtd: feedback` if uncommitted from Agentic Review),
   inlines the feedback content into the fixer prompt. Returns to Testing.

5. **Agentic Review**: Reviews the package diff since the last `gtd: planning` /
   `gtd: package done`. Always writes FEEDBACK.md — empty for approval, with
   findings otherwise. If `reviewFixCount >= reviewThreshold` (default 3) or
   `agenticReview: false`, force-approves (writes empty FEEDBACK.md and skips
   the review prompt).

6. **Close package**: Empty FEEDBACK.md → removes it, removes the finished
   package dir, commits `gtd: package done`. If packages remain → Building;
   `.gtd/` gone → Clean.

## Review flow

After all packages close (or for any committed branch work with no active
workflow), **Clean** generates REVIEW.md for the diff since the auto-computed
base:

- Within a process → the first `gtd: grilling` of the current cycle (the whole
  task); after a feedback cycle → the last `gtd: awaiting review` (only the new
  work packages)
- Outside a process, feature branch → merge-base with the default branch —
  always the whole branch, even after a prior `gtd: done` on it
- Outside a process, default branch → no review (Idle)

A review only fires when commits exist after the last `gtd: done` (or none
exists), so an approved review settles Idle until new commits land. Workflow
files (REVIEW.md, TODO.md, FEEDBACK.md, ERRORS.md, `.gtd/`) are excluded from
every review diff.

**Await Review** commits REVIEW.md (`gtd: awaiting review`) and STOPs.

- **Substantive edits** (code edits, new files, inline comments, textual
  REVIEW.md notes, or an uncommitted TODO.md) → Accept Review (edge-only):
  captures the whole changeset as `gtd: review feedback` (commit-then-revert —
  untracked files are dropped by construction), removes REVIEW.md, seeds TODO.md
  from the captured diff. Next state is Grilling, which develops the feedback
  into a new plan — the process stays open; no `gtd: done` is committed on the
  feedback path. If a checkout/pull loses the uncommitted seed, HEAD
  `gtd: review feedback` + REVIEW.md regenerates it (never Done).
- **No edits (clean tree) or checkbox-only ticks** → Done (edge-only): removes
  REVIEW.md, commits `gtd: done` → Idle.

Everywhere a change is captured (New Feature, Accept Review, grilling rounds on
a committed plan — where code sketches are appended to TODO.md and reverted),
the seed embeds the interpretation rules: code changes are suggestions to
re-implement properly (including tests), code comments are positional feedback,
TODO.md/REVIEW.md text is global feedback, checkbox flips are approval noise.
During the build (`.gtd/` present) user edits are instead adopted and verified
by tests + agentic review — pending code there is indistinguishable from
builder-agent output.

## Configuration

`gtd` reads `.gtdrc` / `.gtdrc.json` / `.gtdrc.yaml` / `.gtdrc.yml` /
`gtd.config.json` / `gtd.config.yaml` via cosmiconfig. Lookup walks from cwd to
the home dir; innermost wins.

```yaml
testCommand: npm run test # default
agenticReview: true # false = skip agentic review, force-approve
fixAttemptCap: 3 # gtd: errors commits before escalating
reviewThreshold: 3 # gtd: feedback rounds before force-approving
models:
  planning: claude-opus-4-8 # tier for grilling, decompose, agentic-review, clean
  execution: claude-sonnet-4-8 # tier for building, fixing
  states: # per-state overrides (exact state names only)
    grilling: claude-opus-4-8
    decompose: claude-opus-4-8
    building: claude-sonnet-4-8
    fixing: claude-sonnet-4-8
    agentic-review: claude-opus-4-8
    clean: claude-opus-4-8
```

## Commit taxonomy

All machine-written commits use the flat `gtd: <phase>` format:

| Subject                | Written when                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `gtd: new task`        | New Feature captures raw input                                                                                                      |
| `gtd: grilling`        | Grilling commits pending TODO.md edits                                                                                              |
| `gtd: grilled`         | Grilled commits the converged plan                                                                                                  |
| `gtd: planning`        | Planning commits .gtd/ package files                                                                                                |
| `gtd: building`        | Testing commits code before running tests                                                                                           |
| `gtd: errors`          | Testing commits FEEDBACK.md (or ERRORS.md) on failure                                                                               |
| `gtd: fixing`          | Fixing removes a **committed** FEEDBACK.md                                                                                          |
| `gtd: feedback`        | Fixing removes an **uncommitted** (agentic-review) FEEDBACK.md                                                                      |
| `gtd: package done`    | Close package removes the finished package dir                                                                                      |
| `gtd: awaiting review` | Await Review commits REVIEW.md                                                                                                      |
| `gtd: done`            | Done removes REVIEW.md                                                                                                              |
| `gtd: transport`       | **Hand-made by the user** — carries uncommitted work across machines/branches; consumed by Transport, never produced by the machine |
