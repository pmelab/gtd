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
  non-negative integer.

A bad config fails loudly — one thrown error naming every finding — before
anything touches the repository. See
[Configuration: validation and errors](docs/configuration.md#validation-and-errors).

## 10. The bundled default workflow

The workflow gtd ships with when `.gtdrc` has no `workflow:` key
(`src/workflows/default.yaml`, compiled through the exact same compiler a custom
`workflow:` key goes through — no privileged code path):

| State            | Actor | Content | `on`                                                                                                                          | Retry              | Model   |
| ---------------- | ----- | ------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------- |
| `idle` (initial) | human | message | `* **` → `grilling`                                                                                                           | —                  | —       |
| `grilling`       | agent | prompt  | `* **` → `building`                                                                                                           | —                  | `smart` |
| `building`       | agent | prompt  | `* **` → `checking`                                                                                                           | —                  | —       |
| `checking`       | check | script  | `A .gtd/FEEDBACK.md` → `fixing`; `M .gtd/FEEDBACK.md` → `fixing`; `D .gtd/FEEDBACK.md` → `await-review`; `C` → `await-review` | —                  | —       |
| `fixing`         | agent | prompt  | `* **` → `checking`                                                                                                           | max 3 → `escalate` | —       |
| `escalate`       | human | message | `* **` → `checking`                                                                                                           | —                  | —       |
| `await-review`   | human | message | `C` → `idle`; `* **` → `grilling`                                                                                             | —                  | —       |

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
lands `gtd(human): grilling`. `grilling` is a SINGLE agent turn — there is no
Q&A loop: the agent reads `.gtd/TODO.md`, explores the codebase, and develops it
into a concrete implementation plan in that one turn, stating any open
question's resolution inline (as an assumption) rather than asking, since the
human's checkpoint is the review at the end of the cycle, not a back-and-forth
here. `.gtd/TODO.md` stays as the plan artifact and the turn steps straight to
`building`.

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
`fixing`); a green run moves on to `await-review` either way — whether it just
deleted a previous red run's `.gtd/FEEDBACK.md` (`D .gtd/FEEDBACK.md`, so the
approved cycle's tree carries no leftover feedback file) or there was nothing to
clean up (`C`). `fixing`'s `retry: { max: 3, otherwise: escalate }` means the
fourth consecutive entry into `fixing` within one process redirects to
`escalate` — a human gate — instead; a human's own `"* **"` step from `escalate`
returns to `checking` (with the process's retry trace unaffected by counting
rules other than "how many times has `fixing` itself been entered").

`await-review` is a direct diff review, with no agent-prepared review file: the
human is told to inspect the cycle's changes themselves (e.g.
`git diff <startCommit>` or `git log --stat <startCommit>..HEAD`). A **clean**
`gtd step human` (the `C` event) approves — moving to `idle`, an empty
`gtd(human): idle` turn commit that ends the cycle right there with no squash;
its commits stay in history for the human to squash however they prefer (an
interactive rebase, an amend, a PR's squash-merge) or leave as-is. This
idle-entering commit is also this workflow's only process boundary besides an
unrecognized HEAD (§7): the NEXT cycle's `retry` counts, `startCommit`, and
diffs never reach back across it. Anything else pending at `await-review` — a
fresh `.gtd/TODO.md` describing what's wrong, code edits, or both — is feedback
and sends the cycle back to `grilling` (`"* **"`), re-entering the pipeline with
that input.

`grilling` — the heavier one-shot planning turn — declares `model: smart`, an
opaque hint `gtd next`/`gtd status` `--json` emit verbatim for the driving loop
to map onto its harness. Every other state leaves `model` unset, so the
harness's own default applies.
