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
lifecycle, validation, and the bundled unified template. Where this document and
the code disagree, the code (`src/PatternMachine.ts`, `src/PatternConfig.ts`,
`src/Edge.ts`) wins.

See [docs/configuration.md](docs/configuration.md) for the full `.gtdrc`
`workflow:` schema and [docs/cli.md](docs/cli.md) for the command surface.

## 1. The model

A workflow is a set of named **states**. Each state declares:

| Property                                      | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actor`                                       | A plain string: who acts here. No closed vocabulary, no "kinds" — every actor just makes changes in the working tree. `gtd step <actor>` authenticates against it. **Commit states carry no `actor`** — gtd itself performs them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `script` \| `prompt` \| `message` \| `commit` | Exactly one — the state's content kind (see §2). All four are Eta templates, inline or a `./`-relative file reference auto-inlined at config load (see [Configuration](docs/configuration.md)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `on`                                          | An ordered map of change patterns → next state (see §3). Evaluated at step time against the pending diff; **first match wins**. A row's value is either the target state name or a `{ to, describe }` object carrying an optional human-readable `describe` sentence (see §3). Absent on a commit state (a commit state has no outgoing edges — the process ends there).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `initial: true`                               | Exactly one state across the whole workflow: where an unrecognized HEAD resolves (see §5). Must not be a commit state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `retry`                                       | Optional `{ max, otherwise }` — redirects a transition into this state to `otherwise` once this state has already been entered `max` times within the current process (see §7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `model`                                       | Optional, opaque string — a harness hint (e.g. `smart`, `fast`, or a concrete model id) emitted alongside the state's content for the driving loop to map onto its agent harness. **Rendered as an Eta template through the same `it.vars`-carrying context as content** (a plain string with no Eta tags passes through unchanged) — see [Configuration](docs/configuration.md#model--the-opaque-harness-hint-template-rendered). gtd never interprets the rendered value; unset means "use the harness's default". **Forbidden on a commit state** (never at rest, emits nothing).                                                                                                                                                                                                                                                                                                   |
| `memory`                                      | Optional, opaque string — a **memory-scope label** emitted alongside the state's content for a memory-aware driving loop to compare, not act on literally: consecutive agent turns emitting the **same** label share a memory scope (the driver retains the agent's memory across them); a change in value — or the first agent turn — is where it starts fresh. This lets a loop that keeps re-entering one state (a planning or fix loop) retain memory across its laps, while crossing to a differently-labelled state at a phase boundary clears it. **Rendered as an Eta template**, exactly like `model`; gtd never interprets the rendered value; unset means "use the harness's default". **Forbidden on a commit state.** See [Configuration](docs/configuration.md#memory--the-memory-scope-label-template-rendered) and the loop driver contract in `skills/loop/SKILL.md`. |
| `file`                                        | Optional — THE steering file this state is about: the file a human/editor should look at while the machine rests here. An **Eta template**, rendered exactly like `model` (must render non-empty). **Forbidden on a commit state.** Multiple states may share one `file:`. gtd itself never reads a path out of this string — only `gtd lsp` (`src/Lsp.ts`) interprets it, to map rendered paths to `mode` — see [Configuration](docs/configuration.md#filemode--the-steering-file-association).                                                                                                                                                                                                                                                                                                                                                                                       |
| `mode`                                        | Optional, requires `file:`. The associated file's FORMAT: the name of a **steering-file mode** — one of the two built-ins (`qa` \| `review`) or one the workflow declares in `modes:` (a `format:`/`validate:` pair of shell commands — see §12). gtd formats and validates the file with that mode at `gtd validate` and at the `gtd step` capture gate; `gtd lsp` dispatches document symbols/code actions/diagnostics on the built-in names only. A name nothing defines is a load error. Like `model`, this is opaque emitted data — the ENGINE never branches on it. **Forbidden on a commit state.**                                                                                                                                                                                                                                                                             |
| `reviewWindow: true`                          | Optional boolean. While the machine RESTS at this state, gtd opens a **review checkout window** — HEAD and the index are rewound to the review base with the working tree untouched, so the whole `base..HEAD` diff surfaces as ordinary uncommitted changes in the editor's git integration; it closes automatically once the machine rests anywhere else (see §11). The pure engine never observes it. **Forbidden on a commit state.**                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `reviewBase: true`                            | Optional boolean. Marks the state whose most-recent in-process commit anchors the review diff base (`base..HEAD`) — both the review checkout window (§11) AND `it.reviewDiff` (the incremental diff a re-reviewing agent's template inlines, §2); absent any such state, the base is the process start. Like `reviewWindow`, history-derived edge data the engine never reads. **Forbidden on a commit state.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `reviewEntry: true`                           | Optional boolean. Marks the (at most one) state `gtd review <commitish>` enters to start a BRAND NEW process reviewing `<commitish>..HEAD` — e.g. a colleague's PR branch with no gtd process of its own (§11). The pure engine never reads it either; the mechanism (resolving `<commitish>`, writing the entry commit, recording its hash as a `Gtd-Review-Base:` trailer) lives entirely at the edge. **Forbidden on a commit state and on the initial state.**                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Emission:** `gtd next --json`/`gtd status --json` gain optional `memory`
(rendered), `file` (rendered) and `mode` (verbatim) keys, omitted — never `null`
— when unset, exactly like `model`; plain `gtd status` prints
`Memory:`/`File:`/`Mode:` lines (after `Model:`) when set. Both also emit an
`edges` array — the resting state's `on` edges as
`{ pattern, target, describe? }` (the same list a `message:` template sees as
`it.edges`, see §3) — omitted only when the state has no `on` (a commit state);
a per-edge `describe` key is likewise omitted when that edge declares none.
Plain-text output carries none of these structured keys (JSON-only, exactly like
`model`/`memory`/`file`/`mode`).

A state is either a **rest** (has an `actor` — `gtd` halts there and awaits that
actor's next step) or a **commit state** (has `commit:` instead of an
`actor`/`on` — entering it ends the process in one squash, see §8).

Beyond its states, a workflow may declare two more things of its own:
**`vars:`** (the lowest-precedence layer of the `it.vars` every template sees —
see [Configuration](docs/configuration.md#variables)) and **`modes:`** (the
steering-file modes a state's `mode:` may name — see §12). Both have a
higher-precedence project layer in the top-level `.gtdrc` keys of the same
names.

## 2. Content kinds

Exactly one of these four per state:

- **`script`** — an executable the DRIVER runs. `gtd next` emits it rendered;
  the driver executes that `content` verbatim via `bash` and then runs
  `gtd step <actor>` for that state's own actor to capture the outcome. gtd
  never executes a workflow script itself (the only place it spawns a subprocess
  at all is a steering-file mode's own `format:`/`validate:` command — §12).
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

**Row value: a target, or a `{ to, describe }` object.** A row's value is
normally just the target state name. It may instead be an object
`{ to: <target>, describe: <sentence> }`, where `describe` is a human-readable
sentence explaining what making that kind of change does next — e.g.
`describe: "Change nothing to accept the current state and proceed."`. The
`describe` is **inert to the engine** — it is not part of matching, not
Eta-rendered (exactly like the pattern key itself), and never affects a
decision. It exists only to be surfaced: a state's own edges are handed to that
state's content template as `it.edges` (an array of
`{ pattern, target, describe? }`), so a human gate's `message:` can render a
"what each change does next" list straight from the routing it documents — one
source of truth, no prose that can drift from the `on` map.
`gtd next --json`/`gtd status --json` emit the same `edges` array (see §1). The
`simple` template uses this at every human gate (see §10).

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
gtd(<actor>): <from> → <to>
```

`<actor>` is **who authored the step** — the invoker — `<from>` is the state the
authored changes were made **in**, and `<to>` is the state being **entered**.
Naming both ends means `git log --oneline` reads as _what each commit did_ (the
work done in `<from>`) rather than only where the machine is headed — the diff a
commit carries belongs to `<from>`, not `<to>`. When there is no meaningful
source — a self-loop (`<from>` == `<to>`) or a manual entry like `gtd review` —
the subject collapses to the bare `gtd(<actor>): <to>` form. History is
therefore an attributed state trace: who did what, from where, when.

**Resolution reads back only `<to>`** (the segment after the last `→`; the bare
form is read as `<to>` directly). The `<from>` prefix is human context and is
never consulted. The subject's actor is checked only against the workflow's
closed-world set of _every_ declared actor (not specifically the resolved
state's own declared actor) — see §5. This is what makes a cross-actor handoff
resolve correctly: a human stepping out of a human-awaited state into an
agent-awaited one writes `gtd(human): <human-state> → <agent-state>`, and the
next invocation must still resolve that subject to `<agent-state>` so the agent
— that state's own actor — is now correctly recognized as awaited.

> Legacy note: pre-existing bare `gtd(<actor>): <state>` commits (from before
> the transition prefix) still parse — the bare form _is_ the no-source form —
> so old history and old fixtures resolve exactly as they always did.

## 5. Resolution

```
next = f(HEAD's commit subject)
```

Parse HEAD's subject as `gtd(<actor>): <from> → <to>` (or the bare
`gtd(<actor>): <to>`). The state resolves to `<to>` unless any of the following
holds, in which case it resolves to the workflow's **initial state** instead:

- the subject doesn't parse as `gtd(<actor>): …` at all (a plain commit, a
  v1/v2-style `gtd: <label>` subject, anything non-`gtd`),
- `<to>` doesn't name a state this workflow declares,
- `<to>` names a **commit** state (a process never rests there — see §8),
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
  committed as `gtd(<invoker>): <from> → <to>`, where `<from>` is the resolved
  state the changes were made in and `<to>` is the matched target after retry
  redirection (§7) — unless `<to>` is a commit state, in which case the process
  squashes instead of committing a turn.

**Token cost.** `gtd step <actor> --cost=<n> [--model=<name>]` records the token
cost of the invocation that produced the pending changes — and the model it ran
on — as a `Gtd-Cost: <n> <model>` trailer on the turn commit: a blank line then
the trailer, below the untouched `gtd(<actor>): <from> → <to>` subject, so
resolution (§5) is unaffected. The edge (`src/Edge.ts`) collects every such
trailer across the current process, summing them into `it.processCost` and
grouping them by model into `it.processCostByModel` (see §8 and
[Configuration: Token cost](docs/configuration.md#token-cost)); the engine never
interprets the number or the model name, it only carries, sums, and groups them.

## 7. Retry

A state's `retry: { max, otherwise }` caps how many times **that state** may be
entered within the current **process** (the contiguous run of
`gtd(<actor>): <state>` commits ending at HEAD — bounded by the nearest
**process boundary**, i.e. whichever comes first walking back from HEAD: a
non-matching commit (a squash result — the unified template's own `done` commit
carries an agent-authored, non-workflow subject — legacy/pre-v3 history, the
repo's own root), or a workflow commit that **enters the workflow's own initial
state** (e.g. `gtd(human): idle`). Either boundary kind is EXCLUDED from the
process itself — it belongs to the finished cycle, like an old squash commit did
— see `computeProcessRun` in `src/Edge.ts`). Once a transition's raw target has
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

**The diff base vs. the trace boundary.** `computeProcessRun` produces both the
process's trace boundary (`startParentHash`, above — what bounds `retry`
counting and the squash reset target, §8) and a separate **diff base**
(`diffBase`), the commit every rendered process diff (`it.processDiff`) and the
review checkout window's default base (§11) compare against. The two normally
coincide. They diverge only when the process's own OLDEST commit — its very
first turn — carries a `Gtd-Review-Base: <hash>` trailer:
`gtd review <commitish>` (§11) writes exactly such a commit when it starts a new
process, recording `<commitish>`'s resolved hash there. `diffBase` then becomes
that hash instead of the boundary parent, while the trace boundary itself is
untouched (the entry commit's own parent is a non-workflow commit — e.g. a
colleague's PR branch commit — so the ordinary boundary rule above already stops
the trace walk there). This is how one workflow-authored value re-points the
whole existing diff/review machinery at `<commitish>..HEAD` with no duplicated
logic.

## 8. The squash lifecycle

A **commit state** (`commit:` content, no `actor`, no `on`) is final. A
transition whose target is a commit state doesn't write a turn commit — instead,
entering it performs, atomically:

1. **Render** the `commit:` Eta template against the PENDING working tree
   (`it.read(path)` reads files as they currently sit, not from any commit;
   `it.processCost` is the whole-process token total and `it.processCostByModel`
   its per-model breakdown — every turn's `Gtd-Cost:` trailer plus the squashing
   step's own `--cost`/`--model` — so the squash message can record the complete
   cost of the feature, itemized by model, even though the per-turn trailers are
   discarded with the turns below). A failed render (a malformed template,
   `read()` throwing for a missing path) **refuses the step and touches
   nothing** — no reset, no commit, no file discarded.
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
- `reviewWindow`/`reviewBase` declared on a commit state (never at rest),
- a state unreachable from the initial state by walking `on` targets and
  `retry.otherwise` redirects (checked only once the initial-state rule itself
  passes — with zero or several initials there is no well-defined start to walk
  from). A workflow is bound to a project and edited as a project-wide change,
  so an unreachable state is a typo'd rename or a leftover, never a supported
  "manual entry point".

A bad config fails loudly — one thrown error naming every finding — before
anything touches the repository. See
[Configuration: validation and errors](docs/configuration.md#validation-and-errors).

## 10. The bundled workflow template

gtd ships **no** default workflow — a repo scaffolds one with `gtd init` (no
argument, see [Configuration](docs/configuration.md#gtd-init)), which writes the
single bundled template (`src/workflows/unified.yaml`) into `.gtdrc.json` — each
agent state's `prompt:` extracted to an editable `gtd-prompts/<state>.md` file
the config references via `./`
([auto-inlined at load](docs/configuration.md#content-values-inline-or-a-file-reference)),
with human `message:`/check `script:`/the `done` `commit:` bodies left inline.
It compiles through the exact same compiler a custom `workflow:` key goes
through — no privileged code path.

The **unified** template is one machine with **two file-keyed entry points into
one shared tail**. The initial `idle` state forks on which steering file a human
creates:

- **`.gtd/TODO.md`** (or any other change) → the **simple flow**: a
  `planning`/`plan-review` iteration loop (the agent presents a plan, the human
  accepts or edits it — no Q&A, no `qa` mode), a monolithic `building` turn, no
  decomposition, no agentic review.
- **`.gtd/REQUIREMENTS.md`** → the **advanced flow**: two-phase product then
  technical Q&A, package decomposition, a per-package parallel build, and a
  per-package agentic `spec-review` gate.

Both converge at `reviewing` → `await-review` (also the direct
`gtd review <commitish>` entry, via `reviewEntry: true` on `reviewing`). Ticking
a `- [ ]` box means only "I reviewed this hunk"; a **comment** — not an unticked
box — is what asks for changes. Every human step routes to `review-deciding`,
which decides from the step's content: a **full sign-off** (every box ticked, no
note in `.gtd/REVIEW.md`, no code edit) is the only path to the **squash
finale** (`squashing` → `done`), which collapses the whole cycle into one commit
whose message an agent drafts. **Feedback** — any note in `.gtd/REVIEW.md`
beyond a tick, OR a hand-edit to code — routes through `review-deciding`, which
CAPTURES the raw material into `.gtd/REVIEW_RAW.md` (never interpreting it) →
`feedback-collecting`, an agent that turns that raw material into an explicit
instruction list in `.gtd/REVIEW_FEEDBACK.md` → `feedback-building`, which
IMPLEMENTS the list → `checking` → `reviewing`, which regenerates an
**incremental** review (`reviewBase: true` on `review-deciding` scopes it to
`last-review..HEAD`, i.e. the agent's follow-through, not the reviewer's own
edit). A code edit counts as the reviewer's own fix: the instructions tell
`feedback-building` to complete the follow-through it implies and never revert
their lines. Feedback must not silently evaporate, so two dead ends never
commit: `feedback-collecting` declares no edge for "raw consumed, nothing
written" (a silent no-op matches no pattern → refused by the pure engine), and
`feedback-building` declares **`requireProgress: true`** so the edge gate
(`enforceFeedbackProgressGate`, `src/program.ts`) refuses a turn that just
deletes the instructions file without doing the work — unless it held a
`NOTHING ACTIONABLE` sentinel (a legitimately non-actionable round). Two more
dead ends never commit at the gate before them — the **sign-off gate**
(`src/program.ts`, an edge like the review window) refuses a step that leaves a
box unticked with no comment, and a deleted `.gtd/REVIEW.md`.

Steering-file formats (`.gtd/REQUIREMENTS.md`/`.gtd/ARCHITECTURE.md` open
questions — the advanced flow only, `.gtd/REVIEW.md` checkboxes) are checkable
but validation is not a state in the machine: the producing agent self-validates
with `gtd validate` before finishing (see §12). The simple flow's `.gtd/TODO.md`
is a free-form plan with no `mode:`, so there is nothing to validate there.

**Entry + shared states** (the simple flow and the tail all three entries
share):

| State                 | Actor | Content | `on`                                                                                                           | Retry              | Model   | Memory   | File / Mode                  |
| --------------------- | ----- | ------- | -------------------------------------------------------------------------------------------------------------- | ------------------ | ------- | -------- | ---------------------------- |
| `idle` (initial)      | human | message | `* .gtd/REQUIREMENTS.md` → `adv-grilling`; `* **` → `planning`                                                 | —                  | —       | —        | —                            |
| `planning`            | agent | prompt  | `* **` → `plan-review`                                                                                         | —                  | `smart` | `plan`   | `vars.todoFile`              |
| `plan-review`         | human | message | `C` → `building`; `* **` → `planning`                                                                          | —                  | —       | —        | `vars.todoFile`              |
| `building`            | agent | prompt  | `* **` → `checking`                                                                                            | —                  | `base`  | `build`  | `vars.todoFile`              |
| `checking`            | check | script  | `A`/`M .gtd/FEEDBACK.md` → `fixing`; `D .gtd/FEEDBACK.md` → `reviewing`; `C` → `reviewing`                     | —                  | —       | —        | —                            |
| `fixing`              | agent | prompt  | `* **` → `checking`                                                                                            | max 3 → `escalate` | `base`  | `fix`    | `vars.feedbackFile`          |
| `escalate`            | human | message | `* **` → `checking`                                                                                            | —                  | —       | —        | `vars.feedbackFile`          |
| `reviewing`           | agent | prompt  | `* **` → `await-review`                                                                                        | —                  | `smart` | `review` | `vars.reviewFile` / `review` |
| `await-review`        | human | message | `* **` → `review-deciding` (+ edge sign-off gate: refuses a deleted `REVIEW.md` / an unticked-no-comment step) | —                  | —       | —        | `vars.reviewFile` / `review` |
| `review-deciding`     | check | script  | `A`/`M .gtd/REVIEW_RAW.md` → `feedback-collecting`; `D .gtd/REVIEW.md` → `squashing`                           | —                  | —       | —        | `vars.reviewFile` / `review` |
| `feedback-collecting` | agent | prompt  | `A`/`M .gtd/REVIEW_FEEDBACK.md` → `feedback-building`                                                          | —                  | `smart` | `review` | `vars.reviewFeedbackFile`    |
| `feedback-building`   | agent | prompt  | `* **` → `checking` (+ edge `requireProgress` gate: refuses a work-free delete of the instructions file)       | —                  | `base`  | `build`  | `vars.reviewFeedbackFile`    |
| `squashing`           | agent | prompt  | `A`/`M .gtd/COMMIT_MSG.md` → `done`                                                                            | —                  | `base`  | `build`  | `vars.commitMsgFile`         |
| `done`                | —     | commit  | — (commit state: squash ends the process)                                                                      | —                  | —       | —        | —                            |

`await-review` declares **`reviewWindow: true`** and `review-deciding`
**`reviewBase: true`** (§11); `reviewing` declares **`reviewEntry: true`**.

**Advanced-flow states** (reached only via the `.gtd/REQUIREMENTS.md` entry):

| State                 | Actor | Content | `on`                                                                                               | Retry                  | Model   | Memory   | File / Mode                    |
| --------------------- | ----- | ------- | -------------------------------------------------------------------------------------------------- | ---------------------- | ------- | -------- | ------------------------------ |
| `adv-grilling`        | agent | prompt  | `* **` → `adv-grilling-answer`                                                                     | —                      | `smart` | `plan`   | `vars.requirementsFile` / `qa` |
| `adv-grilling-answer` | human | message | `C` → `architecting`; `* **` → `adv-grilling`                                                      | —                      | —       | —        | `vars.requirementsFile` / `qa` |
| `architecting`        | agent | prompt  | `* **` → `architecting-answer`                                                                     | —                      | `smart` | `plan`   | `vars.architectureFile` / `qa` |
| `architecting-answer` | human | message | `C` → `decompose`; `* **` → `architecting`                                                         | —                      | —       | —        | `vars.architectureFile` / `qa` |
| `decompose`           | agent | prompt  | `* .gtd/packages/**` → `picking`                                                                   | —                      | `base`  | `build`  | —                              |
| `picking`             | check | script  | `D .gtd/NEXT.md` → `reviewing`; `* .gtd/NEXT.md` → `adv-building`; `C` → `reviewing`               | —                      | —       | —        | —                              |
| `adv-building`        | agent | prompt  | `* **` → `adv-checking`                                                                            | —                      | `base`  | `build`  | —                              |
| `adv-checking`        | check | script  | `A`/`M .gtd/FEEDBACK.md` → `adv-fixing`; `D .gtd/FEEDBACK.md` → `spec-review`; `C` → `spec-review` | —                      | —       | —        | —                              |
| `adv-fixing`          | agent | prompt  | `* **` → `adv-checking`                                                                            | max 3 → `adv-escalate` | `base`  | `fix`    | `vars.feedbackFile`            |
| `adv-escalate`        | human | message | `* **` → `adv-checking`                                                                            | —                      | —       | —        | `vars.feedbackFile`            |
| `spec-review`         | agent | prompt  | `A`/`M .gtd/SPEC_FEEDBACK.md` → `spec-fix`; `D .gtd/SPEC_FEEDBACK.md` → `closing`; `C` → `closing` | max 3 → `closing`      | `smart` | `review` | —                              |
| `spec-fix`            | agent | prompt  | `* **` → `adv-checking`                                                                            | —                      | `base`  | `fix`    | `vars.specFeedbackFile`        |
| `closing`             | check | script  | `* **` → `picking`                                                                                 | —                      | —       | —        | —                              |

### Walkthrough — the simple flow and the shared tail

A human writes `.gtd/TODO.md` (a short sketch) and runs `gtd step human` at
`idle`: the `REQUIREMENTS.md` row doesn't match, so the catch-all `"* **"` lands
`gtd(human): idle → planning`.

**Planning — iterate on a plan, no Q&A.** `planning` reads `.gtd/TODO.md`,
explores the codebase, and develops it into a concrete implementation plan — the
files to change, the approach, the steps — deciding every open point itself
rather than asking questions. It declares `file: .gtd/TODO.md` but **no
`mode:`** (the plan is free-form prose, not the `qa` open-questions format), so
there is nothing to validate; it steps to `plan-review`. There a human either
accepts the plan with a **clean** step (`C` → `building`) or edits it — rewrites
a step, adds a constraint, drops an inline comment — which loops back through
`planning` (`* **`), where the agent folds every edit and comment into a
revised, self-contained plan.

`building` implements the plan in one turn — no decomposition — using TDD
discipline, deletes `.gtd/TODO.md`, and steps to `checking`.

`checking` is a `script` state: the driver runs its inline test wrapper
(`<%~ it.vars.testCommand %>`, default `npm test` — overridable via a top-level
`.gtdrc` `vars:` key or `GTD_VAR_testCommand`) and steps the `check` actor. A
red run leaves `.gtd/FEEDBACK.md` (`A`/`M` → `fixing`); a green run moves to
`reviewing` (`D .gtd/FEEDBACK.md` cleaning a prior red run, or `C`). `fixing`'s
`retry: { max: 3, otherwise: escalate }` redirects the fourth consecutive entry
to the `escalate` human gate.

**Review — REVIEW.md checkboxes.** `reviewing` (agent, `plannerModel`) writes
`.gtd/REVIEW.md` grouping the diff into reviewable chunks in the exact
checkbox-pointer format `src/ReviewDoc.ts` defines, self-validates it, and steps
to `await-review`. There a human ticks a `- [ ]` to `- [x]` as they review each
hunk — ticking records only "I read this", it is not sign-off. What asks for
changes is a **comment**: a note left on a `.gtd/REVIEW.md` line, or a direct
code edit. Every human step routes to `review-deciding` (`* **`);
`review-deciding` is deterministic and decides from the step's content. It is a
**feedback** round when the human left a comment — a change to `.gtd/REVIEW.md`
beyond a `[ ]`→`[x]` tick (detected by comparing the reviewer's copy against the
agent's original, `HEAD^`, with checkbox state normalized away), OR a hand-edit
to any non-`.gtd/` file this round (its own commit's file list). It CAPTURES
that raw material verbatim (the reviewer's `.gtd/REVIEW.md` diff and/or their
committed code diff) into `.gtd/REVIEW_RAW.md` and removes `.gtd/REVIEW.md` —
the `A`/`M .gtd/REVIEW_RAW.md` row is declared **first** so a feedback round
wins over the sign-off pattern. `review-deciding` never INTERPRETS the material;
it is a mechanical `check`. Otherwise (every box ticked, no note, no code) it
just removes `.gtd/REVIEW.md` (`D .gtd/REVIEW.md` → `squashing`).

`feedback-collecting` (a `smart`-tier agent) reads `.gtd/REVIEW_RAW.md` and
turns it into an explicit, flat instruction list in `.gtd/REVIEW_FEEDBACK.md`,
deleting the raw file. It applies three rules: a note added to `.gtd/REVIEW.md`
is a mandatory instruction (regardless of tick state); every comment the human
added to code this round is a mandatory instruction, marked for removal once
addressed; and every non-comment line they hand-edited is an already-committed
intent whose lines are final (complete only the follow-through, never revert).
If nothing is actionable (e.g. the human left only an approving remark) it
writes a single `NOTHING ACTIONABLE — <reason>` line instead of inventing work.
`feedback-building` then implements exactly those items (no Q&A) — building on
the reviewer's own lines, removing every comment it consumed — deletes the
feedback file, and re-enters `checking` → `reviewing`, which regenerates a
review scoped to just the changes since the last round (§11).

Feedback must not silently evaporate between these two turns — the original bug
was feedback captured, then deleted on the next turn with no work done — so both
interior transitions are guarded. `feedback-collecting` declares no edge for a
silent no-op (delete the raw file, write no instructions): the diff matches no
`on` pattern, so the pure engine refuses it. `feedback-building` declares
**`requireProgress: true`**, and the edge gate (`enforceFeedbackProgressGate` in
`src/program.ts` — invisible to the pure engine, keyed on the resting state's
flag) refuses a turn whose only pending change is deleting the instructions
file, exempting a `NOTHING ACTIONABLE` sentinel (a non-actionable round makes no
code change by design). A genuine build always produces a code or
comment-removal edit, so only the work-free discard is refused.

Two content-shaped dead ends a file-pattern edge can't tell apart never commit:
the **sign-off gate** (`enforceReviewSignoffGate` in `src/program.ts` — an edge
like the review window, invisible to the pure engine, keyed on the resting
state's `reviewWindow: true` + `mode: review`) inspects the pending step BEFORE
it commits and refuses a **deleted** `.gtd/REVIEW.md` (ticking is the sign-off
gesture now, not deletion) and an **unfinished** review (only tick-flips, a box
still `- [ ]`, and no comment of any kind — committing it would corrupt the
incremental review base, so the reviewer is told to finish first and the window
stays open).

**The squash finale.** A full sign-off reaches `squashing` (agent), which writes
`.gtd/COMMIT_MSG.md` with one conventional-commits message; entering the `done`
commit state squashes every turn commit since the process start into that one
commit (with a token-cost trailer, §8) and discards the message file. The squash
commit carries a NON-workflow subject, so it is the process boundary (§7): the
next cycle's `retry` counts, `startCommit`, and diffs never reach back across
it.

The message describes **`it.retainedDiff`, not `it.processDiff`** — the diff the
squash actually KEEPS, based at the process's own trace boundary
(`startParentHash`), which a `Gtd-Review-Base:` trailer never overrides (§11).
For a normal build cycle the two coincide (whole feature). For a
`gtd review <commitish>` process, `it.processDiff` covers the reviewed
`<commitish>..HEAD` but the squash only retains the fixes made DURING the
review; `it.retainedDiff` is exactly those, and the prompt renders it in place
of the full changeset. When it is empty — a clean sign-off with no fixes — the
prompt instead instructs a fixed `chore: human review` message, so the squash is
an empty commit that records the sign-off without restating the reviewed work.

### Walkthrough — the advanced flow

Creating `.gtd/REQUIREMENTS.md` and stepping at `idle` matches the first `on`
row, landing `gtd(human): idle → adv-grilling`. `adv-grilling` develops the
product plan in `.gtd/REQUIREMENTS.md` (product/user-facing decisions only, same
`## Open Questions` protocol), gated by `adv-grilling-answer`. A clean step
moves to `architecting`, which reads `.gtd/REQUIREMENTS.md`, writes the
technical plan to `.gtd/ARCHITECTURE.md`, deletes `.gtd/REQUIREMENTS.md`, and is
gated by `architecting-answer`.

A clean step moves to `decompose`, which reads `.gtd/ARCHITECTURE.md` and writes
an ordered set of **work packages** under `.gtd/packages/` (one file each), then
deletes `.gtd/ARCHITECTURE.md`. Each package file describes a set of
**independent** tasks. `picking` is the deterministic queue arbiter: it takes
the first package file (by name) into `.gtd/NEXT.md`, or removes `.gtd/NEXT.md`
when the queue is empty (`D .gtd/NEXT.md` → `reviewing`, closing out to the
shared tail). `adv-building` reads the package in `.gtd/NEXT.md` and implements
ALL its tasks in one turn, **fanning the independent tasks out to parallel
subagents** — gtd stays a single-branch serial machine; the parallelism is the
agent's, inside one turn. It leaves the package file in place for review.

`adv-checking` runs the suite (a red run → `adv-fixing`, capped to
`adv-escalate`); a green run reaches the per-package `spec-review` gate. There
an agent verifies the built package against its spec (the package file, still on
disk): if it finds problems it writes `.gtd/SPEC_FEEDBACK.md` (→ `spec-fix`,
which addresses them and re-enters `adv-checking` → `spec-review`); a **clean**
turn is its approval (`C` → `closing`). `spec-review` is bounded by
`retry: { max: 3, otherwise: closing }` — the cap **force-closes** the package
and moves on, deferring the unresolved concern to the shared human review (which
sees the whole diff anyway). NOTE the cap is process-scoped, so it pools across
packages — the same documented limitation the `fixing` cap has. `closing`
removes the reviewed package file and `.gtd/NEXT.md`, returning to `picking` for
the next package. Once the queue empties, `picking` closes out to `reviewing` —
the same shared tail and squash finale the simple flow uses.

**Hygiene invariant:** an approved cycle leaves `.gtd/` empty —
`.gtd/FEEDBACK.md` by a green check, `.gtd/REVIEW.md` by `review-deciding`,
`.gtd/TODO.md` by `building`, `.gtd/REQUIREMENTS.md`/`.gtd/ARCHITECTURE.md` by
the phase that folds them in, package files by `closing`, and
`.gtd/COMMIT_MSG.md` discarded by the squash.

**Models and memory.** Every agent state draws its `model` from one of two
`vars` tiers (`plannerModel` default `smart` for planning/architecting/review
turns, `coderModel` default `base` for build/fix turns), repointable in one
place (a `vars:` edit or a `GTD_VAR_` override). Each also declares a `memory:`
scope label (`plan`/`build`/`fix`/`review`) — an opaque hint the `--json`
commands emit verbatim so a memory-aware driver retains an agent's memory within
a loop (same label across laps) and clears it at a phase boundary. gtd never
reads either (see §1).

**Human-gate route lists.** Every human gate declares a `describe` on each `on`
edge and closes its `message:` with a "what each change does next" list rendered
from `it.edges` (§3), so it can never drift from the routing it describes.

The template's `vars:` declares every steering-file path in one place
(`todoFile`, `requirementsFile`, `architectureFile`, `packagesDir`, `nextFile`,
`reviewFile`, `reviewFeedbackFile`, `feedbackFile`, `specFeedbackFile`,
`commitMsgFile`), read by every `file:` and prompt/script as `<%~ it.vars.… %>`.
**Known limitation:** `on` pattern keys are NOT Eta templates — they keep the
LITERAL `.gtd/…` paths matching these vars' default values (see
[Configuration](docs/configuration.md#filemode--the-steering-file-association)),
so repointing a file var desyncs the machine. `gtd lsp` reads this same
`file:`/`mode:` pair to dispatch document symbols/code actions/diagnostics,
config-driven rather than hardcoded.

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

**The base.** By default it is the process's diff base (`computeProcessRun`'s
`diffBase` — see §7), so the window shows the whole current cycle — or, for a
process `gtd review <commitish>` started (below), `<commitish>..HEAD`. A
workflow can narrow it further by marking an earlier state
**`reviewBase: true`**: the most-recent in-process commit that entered such a
state becomes the base, so only work committed after that milestone surfaces
(planning-doc churn before it stays committed and out of view). The SAME base
also drives `it.reviewDiff` (`buildTemplateContext` resolves it via
`reviewBaseHash`), so a re-reviewing agent whose prompt inlines `it.reviewDiff`
regenerates its review over only the changes since the previous round — not just
the human's editor window. In the unified template `review-deciding` carries
`reviewBase: true`, so each feedback round's `reviewing` turn and checkout
window both cover `last-review..HEAD` (the first review falls back to the whole
cycle).

**Open / close lifecycle.** The pure engine (§5–§8) never observes an open
window — it is opened and closed entirely at the edge (`src/ReviewWindow.ts`),
bracketing every state subcommand (`step`/`next`/`status`):

- **Close first, always.** Before anything reads or mutates state, gtd restores
  the real head if a window is open (keyed solely on `refs/gtd/review-head`
  existing). This is why the machine resolves the true rest, not the rewound
  base — and why a reviewer's own edits, made while the window was open, land as
  the resting state's ordinary pending changes and are captured by its `on`
  patterns like any other diff (in the unified template, a code edit at
  `await-review` is feedback — it routes through `review-deciding` into a
  build + re-review round; ticking every box with no comment signs off into the
  squash finale, while a deleted `.gtd/REVIEW.md` is refused by the sign-off
  gate — see §10).
- **Re-arm last.** After the subcommand finishes — on success, on refusal, and
  after read-only commands too — gtd re-opens the window if the resolved rest
  declares `reviewWindow: true`. Every command participates, so the editor's
  diff view stays consistent no matter which one the driving loop last ran.

Both steps are idempotent under re-entry, so a crash at any point is recovered
by the next invocation's close. The close fails loudly (leaving the refs in
place) only if HEAD has moved off the reviewed branch — a `--mixed` reset there
would rewrite the wrong branch's tip; the error message spells out the manual
recovery.

**The review entry point (`gtd review <commitish>`).** Everything above
describes a review that a workflow's OWN cycle triggers (`reviewWindow: true`/
`reviewBase: true`). A state may separately declare **`reviewEntry: true`** (at
most one, never a commit state, never the initial state — §1/§9): the state
`gtd review <commitish>` enters to start a BRAND NEW process reviewing someone
else's work with no gtd process of its own — a colleague's PR branch pushed on
top of a shared base is the motivating case.

`gtd review <commitish>` requires resting at the workflow's initial state with a
clean tree (any process already underway, or a dirty tree, refuses), and
requires the active workflow to declare a `reviewEntry` state (otherwise it is a
usage error). It then resolves `<commitish>` — it must name an ancestor of HEAD
other than HEAD itself — and writes ONE ordinary empty turn commit,
`gtd(human): <review-entry-state>`, carrying the resolved commit's full hash as
a `Gtd-Review-Base: <hash>` trailer (mirroring how `gtd step --cost` writes its
own `Gtd-Cost:` trailer — see §6). Nothing else is special about this commit: it
resolves (§5) exactly like any other `gtd(human): <state>` turn.

`computeProcessRun` (§7) reads that trailer back off the process's own oldest
commit and uses it as the process's `diffBase` — the ordinary trace-boundary
rule already stops the trace walk at the entry commit's parent (a non-workflow,
non-gtd commit), so nothing about retry counting or the squash reset target
changes. Only the diff base moves. From here on, the ENTIRE existing review flow
is reused unmodified: the review-entry state's own prompt/message and `on`
routing run exactly as declared, `it.processDiff` covers `<commitish>..HEAD`,
and if a downstream state (the bundled default's `await-review`) declares
`reviewWindow: true`, the checkout window opens over that same range — zero
duplicated logic, one re-pointed value.

Because the trailer moves ONLY `diffBase`, not `startParentHash`, the squash
reset target and thus `it.retainedDiff` stay anchored at the review process's
own start — so the squash keeps and describes only the fixes made during the
review, never the reviewed changeset itself (§10, the squash finale).

The bundled default declares `reviewEntry: true` on `reviewing` itself (see
§10): `gtd review <commitish>` hands the agent a `<commitish>..HEAD` diff to
turn into a `.gtd/REVIEW.md` exactly as it would for an ordinary cycle's
`checking` → `reviewing` handoff.

`.gtd/` workflow plumbing (the review doc, plan/feedback files) is pinned back
to the real head's index while the window is open, so the editor's unstaged view
shows only the actual code changes.

## 12. Steering-file modes (`gtd validate`)

A state that declares both `file:` and `mode:` has an output whose format is
checkable. A **mode** is nothing but a pair of operations over that one file:

1. **format** — rewrite it in place, so nothing is judged in a shape the
   formatter would have fixed;
2. **validate** — report findings (none = valid).

Both halves are **DATA**: a `modes:` entry (beside `states:`, or as the
top-level `.gtdrc` `modes:` layer over it) declaring a `format:` and/or
`validate:` SHELL COMMAND for that mode name.

```yaml
workflow:
  modes:
    adr:
      format: "npx prettier --write <%= it.file %>"
      validate: "./scripts/check-adr.sh <%= it.file %>"
  states:
    drafting:
      actor: agent
      prompt: "Write the ADR."
      file: docs/adr/0001.md
      mode: adr
```

Both commands are Eta templates over the resting state's usual context plus
`it.file` (the rendered steering-file path), executed verbatim via `bash` from
the repo root. The contract is the shell's own: a `validate:` command exits 0
for valid, or non-zero with its output (stdout then stderr) as the findings, one
per line; a `format:` command is expected to rewrite the file in place, and a
non-zero exit is a hard error (broken tooling, not a malformed file).

Underneath the declared halves sit gtd's two **BUILT-IN VALIDATORS**: `qa`
(`src/OpenQuestions.ts`) and `review` (`src/ReviewDoc.ts`), each format's single
source of truth (their unit tests are the format's spec tests; the same parsers
back the LSP's live diagnostics, `src/Lsp.ts`). They are available in every
workflow without being declared — and they are validators ONLY: **gtd ships no
formatter**, so `qa`/`review` reformat nothing until a project gives them a
`format:` command. `gtd init` seeds one by default: the scaffolded `.gtdrc.json`
carries a top-level `modes:` block suggesting `npx prettier --write` as the
`format:` for both (validation still gtd's own) — an ordinary declared layer the
project edits or drops, not privileged machinery (see
[docs/configuration.md](docs/configuration.md#modes--pluggable-steering-file-modes)).

The two halves resolve **independently**, each from the first layer that
provides it (`resolveSteeringMode` in `src/SteeringMode.ts`) — so extending a
built-in is additive rather than all-or-nothing:

| `modes:` entry for `qa`          | format        | validate                    |
| -------------------------------- | ------------- | --------------------------- |
| none                             | nothing       | gtd's open-questions parser |
| `format: npx prettier --write …` | that command  | gtd's open-questions parser |
| `validate: my-linter …`          | nothing       | that command                |
| both                             | its `format:` | its `validate:`             |

A `mode:` naming neither a built-in nor a declared mode is a load error (see
[Configuration](docs/configuration.md#modes--pluggable-steering-file-modes),
which also covers the top-level `modes:` layer that lets a project plug a
formatter into the BUNDLED default without re-declaring the workflow).

The **pure engine** never formats or validates anything — it carries `modes:` as
inert data. Both halves are an edge concern (like the review checkout window,
§11), in `src/SteeringMode.ts`: a command, a capture-time gate, and emitted
guidance, none of which the `step` decision sees.

**`gtd validate`** resolves the current rest exactly like `gtd status`, renders
that state's `file:`, **formats it in place** (when the mode has a formatter),
then validates it — both per its `mode:`. Valid exits 0; violations exit
non-zero with the findings (one per line). A state with no `file:`/`mode:`, or
whose file is **absent**, has nothing to validate and exits 0 (and formats
nothing) — so `building` deleting `.gtd/TODO.md`, and an `await-review`
delete-to-approve, both pass cleanly.

**`gtd step` enforces the same gate.** Capturing a normal commit out of a state
that declares `file:`+`mode:` runs the very same format-and-validate on that
file first (`enforceSteeringGate` in `src/program.ts`, over the same
`src/SteeringMode.ts` mode resolution) and **refuses the step**, committing
nothing, when it is invalid. This is what makes the check run whoever last
touched the file — an agent's fresh draft AND a human's edit at a gate
(answering at `adv-grilling-answer`, reviewing at `await-review`) are formatted
and validated identically, and a malformed steering file is never committed. A
squash skips the gate (the file is discarded); a deletion/absent file is a no-op
(so delete-to-approve still works).

**Self-validation before the gate.** So the gate rarely has to refuse, the
producing agent validates its own output before stepping — and how that reaches
the agent depends on the output mode of `gtd next`, so the driving styles
compose:

- **`gtd next` (plain text):** for a `prompt` rest that declares
  `file:`+`mode:`, gtd appends a "run `gtd validate` and fix every violation"
  instruction to the rendered prompt. A human or simple driver hands the prompt
  to an agent, which self-validates.
- **`gtd next --json`:** the appended instruction is withheld (the emitted
  `content` stays the clean prompt). The driving loop instead runs
  `gtd validate` after the agent's turn and, on findings, re-prompts the same
  agent session until it passes — then steps (see `bin/gtd-loop` /
  `skills/loop/SKILL.md`). `gtd validate` being a no-op when there is nothing to
  validate means the loop can run it after every agent turn unconditionally.

In the unified template (§10) this covers `adv-grilling` (REQUIREMENTS.md/`qa`),
`architecting` (ARCHITECTURE.md/`qa`) and `reviewing` (REVIEW.md/`review`) — the
states that author a steering file — and, through the `gtd step` gate, the human
gates `adv-grilling-answer`, `architecting-answer` and `await-review` that edit
those same files. (The simple flow's `planning` authors `.gtd/TODO.md` with no
`mode:`, so it is not gated here.) It replaced the old in-machine
`todo-validating`/`review-validating` states and their `.gtd/FORMAT.md` bounce
loop (see
[docs/design/steering-file-validation-command.md](docs/design/steering-file-validation-command.md));
modes became pluggable afterwards (see
[docs/design/pluggable-steering-modes.md](docs/design/pluggable-steering-modes.md)).

**Known limitation — the editor sees only the built-ins.** `gtd lsp` publishes
diagnostics, document symbols and code actions for `qa`/`review` files only: gtd
never runs a mode's shell command per keystroke over an unsaved buffer. A
custom-mode file is still formatted and validated by `gtd validate` and the
`gtd step` gate.
