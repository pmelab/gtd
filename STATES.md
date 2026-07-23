# The gtd v3 state machine (the "pattern machine")

`gtd` is a turn-taking state machine layered over a git branch. There is no
long-lived process and no daemon: every invocation is a single
`resolve → decide → (perform)` hop. The engine (`src/PatternMachine.ts`) is a
pure, IO-free module — definition types, the pattern grammar's parser/matcher,
HEAD resolution, and step decisions; all git/filesystem/template IO lives at the
edge (`src/Edge.ts`, called from `src/program.ts`).

This document is the design reference for the v3 engine: the state model, the
pattern grammar, the commit-subject grammar and its attribution rule,
resolution, step semantics (refusals/no-op/commit/squash), retry, the squash
lifecycle, validation, and the bundled default workflow. Where this document and
the code disagree, the code (`src/PatternMachine.ts`, `src/PatternConfig.ts`,
`src/Edge.ts`) wins.

See [docs/configuration.md](docs/configuration.md) for the full `.gtdrc`
`workflow:` schema and [docs/cli.md](docs/cli.md) for the command surface.

## 1. The model

A workflow is a set of named **states**. Each state declares:

| Property                                      | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `actor`                                       | A plain string: who acts here. No closed vocabulary, no "kinds" — every actor just makes changes in the working tree. `gtd step <actor>` authenticates against it. **Commit states carry no `actor`** — gtd itself performs them.                                                                                                                                                                                                                                                                                                                                                    |
| `script` \| `prompt` \| `message` \| `commit` | Exactly one — the state's content kind (see §2). All four are Eta templates, inline or a `./`-relative file reference auto-inlined at config load (see [Configuration](docs/configuration.md)).                                                                                                                                                                                                                                                                                                                                                                                      |
| `on`                                          | An ordered map of change patterns → next state (see §3). Evaluated at step time against the pending diff; **first match wins**. Absent on a commit state (a commit state has no outgoing edges — the process ends there).                                                                                                                                                                                                                                                                                                                                                            |
| `initial: true`                               | Exactly one state across the whole workflow: where an unrecognized HEAD resolves (see §5). Must not be a commit state.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `retry`                                       | Optional `{ max, otherwise }` — redirects a transition into this state to `otherwise` once this state has already been entered `max` times within the current process (see §7).                                                                                                                                                                                                                                                                                                                                                                                                      |
| `model`                                       | Optional, opaque string — a harness hint (e.g. `smart`, `fast`, or a concrete model id) emitted alongside the state's content for the driving loop to map onto its agent harness. **Rendered as an Eta template through the same `it.vars`-carrying context as content** (a plain string with no Eta tags passes through unchanged) — see [Configuration](docs/configuration.md#model--the-opaque-harness-hint-template-rendered). gtd never interprets the rendered value; unset means "use the harness's default". **Forbidden on a commit state** (never at rest, emits nothing). |
| `file`                                        | Optional — THE steering file this state is about: the file a human/editor should look at while the machine rests here. An **Eta template**, rendered exactly like `model` (must render non-empty). **Forbidden on a commit state.** Multiple states may share one `file:`. gtd itself never reads a path out of this string — only `gtd lsp` (`src/Lsp.ts`) interprets it, to map rendered paths to `mode` — see [Configuration](docs/configuration.md#filemode--the-steering-file-association).                                                                                     |
| `mode`                                        | Optional, requires `file:`. The associated file's FORMAT, from a closed vocabulary (`qa` \| `review`) the LSP dispatches document symbols/code actions/diagnostics on. An unknown value is a load error. Like `model`, this is opaque emitted data — the ENGINE never branches on it. **Forbidden on a commit state.**                                                                                                                                                                                                                                                               |
| `reviewWindow: true`                          | Optional boolean. While the machine RESTS at this state, gtd opens a **review checkout window** — HEAD and the index are rewound to the review base with the working tree untouched, so the whole `base..HEAD` diff surfaces as ordinary uncommitted changes in the editor's git integration; it closes automatically once the machine rests anywhere else (see §11). The pure engine never observes it. **Forbidden on a commit state.**                                                                                                                                            |
| `reviewBase: true`                            | Optional boolean. Marks the state whose most-recent in-process commit anchors the review window's diff base (`base..HEAD`); absent any such state, the base is the process start (§11). Like `reviewWindow`, history-derived edge data the engine never reads. **Forbidden on a commit state.**                                                                                                                                                                                                                                                                                      |

**Emission:** `gtd next --json`/`gtd status --json` gain optional `file`
(rendered) and `mode` (verbatim) keys, omitted — never `null` — when unset,
exactly like `model`; plain `gtd status` prints `File:`/`Mode:` lines (after
`Model:`) when set.

A state is either a **rest** (has an `actor` — `gtd` halts there and awaits that
actor's next step) or a **commit state** (has `commit:` instead of an
`actor`/`on` — entering it ends the process in one squash, see §8).

## 2. Content kinds

Exactly one of these four per state:

- **`script`** — an executable the DRIVER runs. `gtd next` emits it rendered;
  `gtd run` executes it verbatim via `bash` (the only place gtd itself spawns a
  subprocess) and then steps that state's own actor. gtd never executes anything
  on its own initiative.
- **`prompt`** — instructions for an agent. `gtd next` prints it; the agent
  acts, then runs `gtd step <actor>` itself.
- **`message`** — text for a human. Drivers halt here; a human acts by editing
  files and running `gtd step <actor>`.
- **`commit`** — the squash-commit message template. A state carrying `commit:`
  is **final**: no separate flag, no `actor`, no `on` — see §8.

## 3. Pattern grammar

Each `on` row pairs a pattern string with a target state:

```
<status> <glob>
```

- `status` ∈ `A` (added) | `M` (modified) | `D` (deleted) | `*` (any status).
- `glob` is matched against the pending change's repo-relative path:
  - a lone `*` matches within **one path segment** — it never crosses a `/`. `*`
    matches `NOTE.md` but not `.gtd/FEEDBACK.md` (that path has a segment the
    lone `*` can't cross).
  - `**` matches across segments, including zero of them, at any depth.
    `.gtd/**` matches both `.gtd/FEEDBACK.md` and `.gtd/sub/DEEP.md`.
  - dotfiles are not special-cased — `*`/`**` match a leading `.` like any other
    character; this is a diff-path matcher, not a shell glob.

Or the bare token **`C`** — the clean-tree event (an explicit, opt-in match for
"nothing pending").

A pattern **fires** if any pending change matches it (contains-match over the
whole change list, not a single-file match): `A`/`M`/`D`/`*` require a status
match and a full-path glob match; `C` fires only when there are zero pending
changes.

**Declaration order, first match wins.** `on` rows are evaluated top to bottom
(a YAML mapping preserves key order); the first row whose pattern fires against
the pending diff decides the target.

> **Documented discrepancy:** an early design note called `"* *"` "the catch-all
> for any dirty tree". Per the single-segment rule above that is only true when
> every tracked path is a repo-root file — a workflow that ever touches a
> subdirectory (`.gtd/FEEDBACK.md`, `src/x.ts`, …) needs **`"* **"`** to catch
> every dirty tree unconditionally. The code (`src/PatternMachine.ts`)
> implements the literal single-segment-vs- cross-segment grammar; `"* *"` is
> not special-cased to mean `"* **"`.

## 4. Subject grammar and the attribution rule

Every commit a `gtd step <actor>` invocation authors carries the subject:

```
gtd(<actor>): <state>
```

`<actor>` is **who authored the step** — the invoker — and `<state>` is the
state being **entered**. History is therefore an attributed state trace:
`git log --oneline` reads as who did what, when.

**Resolution reads back only `<state>`.** The subject's actor is checked only
against the workflow's closed-world set of _every_ declared actor (not
specifically the resolved state's own declared actor) — see §5. This is what
makes a cross-actor handoff resolve correctly: a human stepping out of a
human-awaited state into an agent-awaited one writes
`gtd(human): <agent-state>`, and the next invocation must still resolve that
subject to `<agent-state>` so the agent — that state's own actor — is now
correctly recognized as awaited.

## 5. Resolution

```
next = f(HEAD's commit subject)
```

Parse HEAD's subject as `gtd(<actor>): <state>`. The state resolves to `<state>`
unless any of the following holds, in which case it resolves to the workflow's
**initial state** instead:

- the subject doesn't parse as `gtd(<actor>): <state>` at all (a plain commit, a
  v1/v2-style `gtd: <label>` subject, anything non-`gtd`),
- `<state>` doesn't name a state this workflow declares,
- `<state>` names a **commit** state (a process never rests there — see §8),
- `<actor>` doesn't name any actor this workflow declares (the closed-world
  check from §4).

This is the entire "upgrade story": **every** pre-v3 history — v1 subjects, v2
subjects, a foreign repo's plain commits — is simply unrecognized and lands at
the initial state, by design, with no special-casing. A repo with no commits at
all also resolves to the initial state.

## 6. Step semantics

`gtd step <invoker>` decides one of four outcomes (`PatternMachine.step`):

- **Out-of-turn refusal** — `invoker` isn't the resolved state's declared actor.
  Exits non-zero, commits nothing: `out of turn — "<state>" awaits <actor>`.
- **No-match refusal** — the tree is dirty and no `on` pattern fires. Exits
  non-zero, commits nothing, and names every declared pattern so the caller
  knows what would have worked:
  `no declared pattern matches the pending changes at "<state>" — declared patterns: <p1>, <p2>, …`.
- **No-op** — the tree is clean and the state declares no `C` pattern. Exits
  zero, commits nothing. This is the **default**, silent case a loop driver
  relies on: opening every iteration with a step before the actor has acted must
  never author junk.
- **Commit** (or **squash**, see §8) — a pattern fired. Everything pending is
  committed as `gtd(<invoker>): <to>`, where `<to>` is the matched target after
  retry redirection (§7) — unless `<to>` is a commit state, in which case the
  process squashes instead of committing a turn.

## 7. Retry

A state's `retry: { max, otherwise }` caps how many times **that state** may be
entered within the current **process** (the contiguous run of
`gtd(<actor>): <state>` commits ending at HEAD — bounded by the nearest
**process boundary**, i.e. whichever comes first walking back from HEAD: a
non-matching commit (an old squash result, legacy/pre-v3 history, the repo's own
root), or a workflow commit that **enters the workflow's own initial state** —
e.g. the bundled default's `gtd(human): idle`, the empty approval turn that ends
a cycle with no squash. Either boundary kind is EXCLUDED from the process itself
— it belongs to the finished cycle, like an old squash commit did — see
`computeProcessRun` in `src/Edge.ts`). Once a transition's raw target has
already been entered `max` times in the current process's trace, the transition
is redirected to `otherwise` instead — decided **at write time**, so the
redirected state is what actually lands in history, never the raw `on`-match
target. If `otherwise` itself carries a `retry` cap, the same check applies to
it recursively; a redirect cycle (A's `otherwise` is B, B's `otherwise` is A,
both over cap) terminates rather than looping forever — once a target repeats
within one redirect chain, that target is accepted as final.

A cap of `0` redirects on the very first attempt to enter the state.

Retry counting resets naturally at the start of each process: a squash (§8)
starts a fresh one-commit history, a workflow commit entering the initial state
(e.g. an approved cycle resting back at `idle` with no squash) starts the next
process with an empty trace right after it, and an unrecognized HEAD starting a
new process (§5) also begins with an empty trace.

## 8. The squash lifecycle

A **commit state** (`commit:` content, no `actor`, no `on`) is final. A
transition whose target is a commit state doesn't write a turn commit — instead,
entering it performs, atomically:

1. **Render** the `commit:` Eta template against the PENDING working tree
   (`it.read(path)` reads files as they currently sit, not from any commit). A
   failed render (a malformed template, `read()` throwing for a missing path)
   **refuses the step and touches nothing** — no reset, no commit, no file
   discarded.
2. **Soft-reset** to the process's start parent (the commit before the process's
   first turn — `EMPTY_TREE` if the process covers the whole history) and write
   **one** commit with the rendered message, verbatim as its subject/body.
3. **Discard** everything still left uncommitted — the message-template file
   included; it never enters history.

The net effect: every intermediate `gtd(<actor>): <state>` commit the process
authored, plus any leftover scratch files, collapse into a single commit on top
of the process's start parent. Squashing is entirely optional — a workflow with
no `commit:` state never squashes, and nothing about the mechanism is hardcoded:
the message filename appears only in user-authored patterns/templates.

```
# before squashing (process: 3 turns since the start parent)
* gtd(agent): working      "write COMMIT_MSG.md"
* gtd(human): revising     "revise or accept"
* gtd(agent): drafting     "draft"
* <process start parent>

# after entering the "done" commit state
* feat: draft workflow     (the rendered COMMIT_MSG.md content, verbatim)
* <process start parent>
```

## 9. Validation

`validateDefinition` (run at config-load time, never at step time) rejects a
workflow with:

- zero states, or anything other than exactly one `initial: true` state, or an
  initial state that is itself a commit state,
- a state declaring other than exactly one of
  `script`/`prompt`/`message`/`commit`,
- a commit state declaring an `actor` or an `on`; a non-commit state omitting
  `actor`,
- an `on` row whose pattern doesn't parse, or whose target names an undefined
  state,
- a `retry.otherwise` naming an undefined state, or a `retry.max` that isn't a
  non-negative integer,
- `reviewWindow`/`reviewBase` declared on a commit state (never at rest).

A bad config fails loudly — one thrown error naming every finding — before
anything touches the repository. See
[Configuration: validation and errors](docs/configuration.md#validation-and-errors).

## 10. The bundled default workflow

The workflow gtd ships with when `.gtdrc` has no `workflow:` key
(`src/workflows/default.yaml`, compiled through the exact same compiler a custom
`workflow:` key goes through — no privileged code path). 12 states: the 7-state
pipeline from before, plus two deterministic **steering-file validation loops**
— one over `.gtd/TODO.md`'s open-questions format, one over `.gtd/REVIEW.md`'s
checkbox review format — that map the functionality the deleted v2 LSP server
(`src/Lsp.ts`) used to provide over those same two files (see
[docs/design/steering-file-loops.md](docs/design/steering-file-loops.md)):

| State               | Actor | Content | `on`                                                                                                                              | Retry              | Model   | File                | Mode     |
| ------------------- | ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------- | ------------------- | -------- |
| `idle` (initial)    | human | message | `* **` → `grilling`                                                                                                               | —                  | —       | —                   | —        |
| `grilling`          | agent | prompt  | `* **` → `todo-validating`                                                                                                        | —                  | `smart` | `vars.todoFile`     | `qa`     |
| `todo-validating`   | check | script  | `A .gtd/FORMAT.md` → `grilling`; `M .gtd/FORMAT.md` → `grilling`; `D .gtd/FORMAT.md` → `grilling-answer`; `C` → `grilling-answer` | —                  | —       | `vars.todoFile`     | `qa`     |
| `grilling-answer`   | human | message | `C` → `building`; `* **` → `grilling`                                                                                             | —                  | —       | `vars.todoFile`     | `qa`     |
| `building`          | agent | prompt  | `* **` → `checking`                                                                                                               | —                  | —       | `vars.todoFile`     | `qa`     |
| `checking`          | check | script  | `A .gtd/FEEDBACK.md` → `fixing`; `M .gtd/FEEDBACK.md` → `fixing`; `D .gtd/FEEDBACK.md` → `reviewing`; `C` → `reviewing`           | —                  | —       | —                   | —        |
| `fixing`            | agent | prompt  | `* **` → `checking`                                                                                                               | max 3 → `escalate` | —       | `vars.feedbackFile` | —        |
| `escalate`          | human | message | `* **` → `checking`                                                                                                               | —                  | —       | `vars.feedbackFile` | —        |
| `reviewing`         | agent | prompt  | `* **` → `review-validating`                                                                                                      | —                  | `smart` | `vars.reviewFile`   | `review` |
| `review-validating` | check | script  | `A .gtd/FORMAT.md` → `reviewing`; `M .gtd/FORMAT.md` → `reviewing`; `D .gtd/FORMAT.md` → `await-review`; `C` → `await-review`     | —                  | —       | `vars.reviewFile`   | `review` |
| `await-review`      | human | message | `D .gtd/REVIEW.md` → `idle`; `M .gtd/REVIEW.md` → `review-deciding`; `* **` → `grilling`                                          | —                  | —       | `vars.reviewFile`   | `review` |
| `review-deciding`   | check | script  | `A .gtd/TODO.md` → `grilling`; `M .gtd/TODO.md` → `grilling`; `D .gtd/REVIEW.md` → `idle`; `C` → `await-review`                   | —                  | —       | `vars.reviewFile`   | `review` |

`File` names the workflow's own `vars:` entry the state's `file:` renders
(`todoFile: .gtd/TODO.md`, `reviewFile: .gtd/REVIEW.md`,
`feedbackFile: .gtd/FEEDBACK.md` — see below); `fixing`/`escalate` declare
`file:` alone (`.gtd/FEEDBACK.md` is plain text, no LSP format).

`await-review` additionally declares **`reviewWindow: true`**: while the cycle
rests there for human review, gtd opens a review checkout window over the whole
cycle diff (no `reviewBase` state is declared, so the base is the cycle's
process boundary). See §11.

There is no squash — the cycle ends at human approval, an empty
`gtd(human): idle` turn commit that rests the machine back at its own initial
state (a **process boundary**, see §7). The cycle's turn commits stay in history
exactly as authored; whether/how to squash them (an interactive rebase, an
amend, a PR's squash-merge) is entirely the human's business, and gtd makes no
assumption about it. The squash-flavored finale this default used to end on — a
`squashing` prompt state authoring `.gtd/COMMIT_MSG.md` plus a `done` commit
state — is still an engine capability (§8), just not part of the bundled default
anymore; it lives on in the fuller machine below.

A fuller machine — two-phase Q&A planning, an architecture phase, task
decomposition, the deterministic `picking` queue arbiter with a per-task
build/check loop, agent-prepared `.gtd/REVIEW.md` review, and that squash finale
(`squashing` + `done`) — is preserved as a copy-paste-ready example at
[docs/examples/advanced-workflow.md](docs/examples/advanced-workflow.md) rather
than shipped as the bundled default.

### Walkthrough

A human writes `.gtd/TODO.md` (a short sketch — a few sentences is enough) and
runs `gtd step human` at `idle`: that dirty tree matches `"* **"`, so the step
lands `gtd(human): grilling`.

**Loop 1 — TODO.md open questions.** `grilling` reads `.gtd/TODO.md`, explores
the codebase, and develops it into a concrete implementation plan; anything it
can't settle itself goes under a `## Open Questions` heading, one
`### <question>` sub-heading per question, whose body's first non-blank line is
`Suggested default: <answer>` (see
[docs/design/steering-file-loops.md §1](docs/design/steering-file-loops.md) for
the exact format — `src/OpenQuestions.ts`'s parser is this format's executable
spec). The turn steps to `todo-validating`, a deterministic `script` state that
parses `.gtd/TODO.md` against that same spec (a grep/awk port, kept in sync by
hand — see the script's own comments): a malformed draft writes findings to
`.gtd/FORMAT.md` (`A`/`M .gtd/FORMAT.md` → back to `grilling`, whose prompt
reads `.gtd/FORMAT.md` first if present); a valid draft removes any stale
`.gtd/FORMAT.md` (`D .gtd/FORMAT.md` → `grilling-answer`) or has nothing to
clean up (`C` → `grilling-answer`) either way. At `grilling-answer`, a human
answers a question by replacing its `Suggested default: ...` line with
`Answer: ...` in place; a **clean** step (`C`, every default accepted as-is)
moves to `building`, while any edit (an answer, a new question, code) loops back
through `grilling`, which folds answers in, possibly asks follow-ups, and
re-validates.

`building` implements the plan in `.gtd/TODO.md` directly — no task
decomposition, no per-task queue — using TDD discipline (one test, then the
implementation that passes it, then the next), and deletes `.gtd/TODO.md` once
the work is complete and verified before stepping to `checking`.

`checking` is a `script` state: `gtd run` executes its inline test-running
wrapper (`<%~ it.vars.testCommand %>`, defaulting to `npm test` — this
workflow's own declared `vars:`, overridable via a top-level `.gtdrc` `vars:`
key or a `GTD_VAR_testCommand` environment variable; see
[Configuration](docs/configuration.md#variables)) and steps the `check` actor
itself. A red run leaves `.gtd/FEEDBACK.md` pending (`A`/`M .gtd/FEEDBACK.md` →
`fixing`); a green run moves on to `reviewing` either way — whether it just
deleted a previous red run's `.gtd/FEEDBACK.md` (`D .gtd/FEEDBACK.md`) or there
was nothing to clean up (`C`). `fixing`'s
`retry: { max: 3, otherwise: escalate }` means the fourth consecutive entry into
`fixing` within one process redirects to `escalate` — a human gate — instead; a
human's own `"* **"` step from `escalate` returns to `checking` (with the
process's retry trace unaffected by counting rules other than "how many times
has `fixing` itself been entered").

**Loop 2 — REVIEW.md checkboxes.** A green `checking` run moves to `reviewing`
(agent, `model: smart`), which writes `.gtd/REVIEW.md` grouping the cycle's full
diff into reviewable chunks, in the exact checkbox-pointer format
`src/ReviewDoc.ts`'s parser defines (header `# Review: <short-hash>`, a
`<!-- base: <hash> -->` comment, `##` chunks each with
`- [ ] ./path#line — note` pointers). `review-validating`, a deterministic
`script` state, parses it the same way `todo-validating` parses `.gtd/TODO.md`:
malformed → `.gtd/FORMAT.md` → back to `reviewing`; valid (with or without a
stale `.gtd/FORMAT.md` to clean up) → `await-review`. At `await-review`, a human
ticks a pointer's `- [ ]` to `- [x]` to approve that item; deleting
`.gtd/REVIEW.md` outright is the power-user shortcut to approve everything at
once (`D .gtd/REVIEW.md` → `idle` directly). Any other `M .gtd/REVIEW.md` step —
ticking/unticking boxes, adding notes, even alongside a code edit — routes to
`review-deciding` (declared **before** the catch-all `"* **"` row, so a step
that also touches code still goes to the decider); code-only edits that leave
`.gtd/REVIEW.md` untouched go straight back to `grilling` as feedback.
`review-deciding` is deterministic: if no unticked `- [ ]` pointer remains, the
cycle is approved (`rm .gtd/REVIEW.md` → `D .gtd/REVIEW.md` → `idle`); otherwise
it extracts the still-unticked pointers (with their notes) into a fresh
`.gtd/TODO.md` and removes `.gtd/REVIEW.md` — the resulting diff carries both
`A .gtd/TODO.md` and `D .gtd/REVIEW.md`, and the `A`/`M .gtd/TODO.md` row is
declared **first** so feedback wins over the approval pattern.

**Hygiene invariant:** an approved cycle leaves `.gtd/` completely empty —
`.gtd/FEEDBACK.md` is cleaned up by a green `checking` run, `.gtd/FORMAT.md` by
either loop's valid-parse branch, `.gtd/REVIEW.md` by the `review-deciding`
approval branch, and `.gtd/TODO.md` by `building`. The idle-entering commit that
closes the cycle is also this workflow's only process boundary besides an
unrecognized HEAD (§7): the NEXT cycle's `retry` counts, `startCommit`, and
diffs never reach back across it.

`grilling` and `reviewing` — the heavier one-shot planning/reviewing turns —
both declare `model: smart`, an opaque hint `gtd next`/`gtd status` `--json`
emit verbatim for the driving loop to map onto its harness. Every other state
leaves `model` unset, so the harness's own default applies.

The default's `vars:` also declares `todoFile`/`reviewFile`/`feedbackFile` (the
three filenames above, in one place), which every `file:` and every
prompt/script that names those files reads as `<%~ it.vars.todoFile %>` etc —
one source of truth per filename. **Known limitation:** `on` pattern keys are
NOT Eta templates — they keep the LITERAL `.gtd/...` paths matching these vars'
default values (see
[Configuration](docs/configuration.md#filemode--the-steering-file-association)).
Repointing `todoFile`/`reviewFile`/`feedbackFile` via a top-level `.gtdrc`
`vars:` key or a `GTD_VAR_` override changes what `file:` renders to (and what a
template reads/writes) WITHOUT changing what the `on` patterns match against —
desyncing the machine. `gtd lsp` (§3 of
[docs/design/state-file-association.md](docs/design/state-file-association.md))
reads this same `file:`/`mode:` pair to dispatch document symbols/code
actions/diagnostics, config-driven rather than hardcoded to `TODO.md`/
`REVIEW.md`.

## 11. The review checkout window

A state may declare **`reviewWindow: true`** (§1). While the machine RESTS at
such a state, gtd surfaces the reviewable diff directly in the editor's git
integration — no custom UI, just ordinary working-tree changes an SCM panel,
gutters, per-file diff, and discard-hunk already understand.

**Mechanism.** The whole cycle's work is already committed by the time review
begins, so an editor would otherwise show a clean tree. gtd temporarily rewinds
HEAD and the index to the review base (`git reset --mixed <base>`) with the
working tree untouched, so the entire `base..HEAD` diff re-appears as
uncommitted changes. The real head is preserved under `refs/gtd/review-head`
(the base under `refs/gtd/review-base`) so nothing is lost.

**The base.** By default it is the process start (the same boundary
`computeProcessRun` uses — see §7), so the window shows the whole current cycle.
A workflow can narrow it by marking an earlier state **`reviewBase: true`**: the
most-recent in-process commit that entered such a state becomes the base, so
only work committed after that milestone surfaces (planning-doc churn before it
stays committed and out of view).

**Open / close lifecycle.** The pure engine (§5–§8) never observes an open
window — it is opened and closed entirely at the edge (`src/ReviewWindow.ts`),
bracketing every state subcommand (`step`/`next`/`run`/`status`):

- **Close first, always.** Before anything reads or mutates state, gtd restores
  the real head if a window is open (keyed solely on `refs/gtd/review-head`
  existing). This is why the machine resolves the true rest, not the rewound
  base — and why a reviewer's own edits, made while the window was open, land as
  the resting state's ordinary pending changes and are captured by its `on`
  patterns like any other diff (in the bundled default, a code edit at
  `await-review` routes to `grilling` as feedback; deleting `.gtd/REVIEW.md`
  approves).
- **Re-arm last.** After the subcommand finishes — on success, on refusal, and
  after read-only commands too — gtd re-opens the window if the resolved rest
  declares `reviewWindow: true`. Every command participates, so the editor's
  diff view stays consistent no matter which one the driving loop last ran.

Both steps are idempotent under re-entry, so a crash at any point is recovered
by the next invocation's close. The close fails loudly (leaving the refs in
place) only if HEAD has moved off the reviewed branch — a `--mixed` reset there
would rewrite the wrong branch's tip; the error message spells out the manual
recovery.

`.gtd/` workflow plumbing (the review doc, plan/feedback files) is pinned back
to the real head's index while the window is open, so the editor's unstaged view
shows only the actual code changes.
