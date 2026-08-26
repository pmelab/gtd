---
name: authoring
description: >-
  Write or edit a gtd workflow configuration (the `.gtdrc` `workflow:` key). Use
  when the user asks to create a custom gtd workflow, customize or change their
  workflow's shape, add/remove/rename a state, add a gate/phase/review step,
  change what an agent is prompted to do, adjust retry caps, models, or steering
  files, or otherwise edit the state machine gtd runs.
---

# Authoring a gtd workflow

A gtd workflow is a small **pattern machine**: a set of named **states** over a
git branch. Each state waits for one **actor**, carries one piece of **content**
(a prompt, a script, or a human message), and routes to the next state by
matching the pending working-tree diff against an ordered set of change
**patterns**. Every step is a commit; the git history IS the state — gtd never
rewrites it. There is no engine to trace through — **a workflow is data**,
compiled from the `.gtdrc` `workflow:` key.

Your job here is to produce or edit that data so it compiles cleanly and does
what the user wants. Driving a workflow once it exists is a separate concern —
that is what a driver (the README's minimal driver, or your own) does.

## Golden rule: start from the built-in default, edit incrementally

Do **not** write a workflow from a blank page. gtd ships one known-good workflow
— the unified template (two file-keyed entry points, simple / advanced, into one
shared review tail) — and RUNS it as its built-in default when no `workflow:`
key is configured. To customize it, declare a `workflow:` key that fully
REPLACES the default (there is no `extends`/merge), so start from the default's
own source and edit it:

```bash
# The built-in default's source — copy from it, don't start blank:
src/workflows/unified.yaml
```

If a `.gtdrc` already declares a `workflow:`, read it and edit in place instead.
Otherwise, materialize the built-in default into config form (`renderInitConfig`
in `src/workflows/templates.ts`) as your starting point, or hand-copy the states
you want to change from `src/workflows/unified.yaml`. `gtd init` does **not**
write a workflow — it only seeds a minimal `.gtdrc.json` (a `testCommand` var
and a formatting suggestion), so it is not the way to scaffold one to edit.

Make one small change, **verify it compiles** (see "Verify" below), then make
the next. A workflow that fails to compile breaks every `gtd` state command in
the repo, so never leave it broken between edits.

## The `.gtdrc` shape

Exactly these top-level keys (any other key is a hard error):

```yaml
workflow: # optional — the whole machine (states + its own vars/modes)
  vars: { ... } # optional — the workflow's own it.vars defaults
  modes: { ... } # optional — steering-file modes a state's mode: may name
  states: { ... } # the named states
vars: { ... } # optional — project layer over workflow.vars (higher precedence)
modes: { ... } # optional — project layer over workflow.modes
$schema: "https://cdn.jsdelivr.net/npm/@pmelab/gtd/schema.json" # optional — editor autocomplete
```

gtd ships a **built-in default** workflow (the unified template), used when no
`workflow:` key is configured. A declared `workflow:` fully REPLACES it — there
is **no** `extends`/merge, so `workflow:` is the sole definition source when
present. Config can be `.gtdrc`, `.gtdrc.json`, `.gtdrc.yaml`, `.gtdrc.yml`,
`gtd.config.json`, or `gtd.config.yaml`.

## Anatomy of a state

```yaml
states:
  <name>:
    actor: <string> # who acts here. REQUIRED.
    prompt: <string> # EXACTLY ONE content kind (see below):
    # script: <string>       #   script | prompt | message
    # message: <string>
    on: # ordered map of pattern → next state (see "Patterns")
      "<pattern>": <targetState>
      "<pattern>": { to: <targetState>, describe: <sentence> }
    initial: true # EXACTLY ONE state across the workflow carries this
    retry: { max: <int>, otherwise: <targetState> } # optional cap (see "Retry")
    file: <string> # optional steering file this state is about (Eta-rendered)
    mode: <modeName> # optional, REQUIRES file: — must be declared in modes: (qa/review are seeded automatically)
    reviewWindow: true # optional — open the review checkout window at rest here
    reviewBase: true # optional — anchor the review diff base to this state
    # reviewBase: <Eta template> # OR a template — see "Retry and review"
    entry: true # optional — an extra `gtd --entry <state>` reachability root (see below)
```

`actor` is a **plain string** — no closed vocabulary. `gtd land` resolves the
resting state's own declared actor and authenticates as it automatically (no
caller-supplied actor argument), and it becomes the commit subject
`gtd(<actor>): <from> → <to>`. Common actors: `human`, `agent`, `check`. Invent
your own freely; the set of valid actors is derived from what your states
declare.

### `model` lives on the machine, not the state — and there is no `memory:`

A **machine**, not an individual state, is the unit of conversational identity:
its `model:` stamps every one of its own `prompt` states, and its memory scope
is keyed off its own position in the machine tree, not off any per-state field.

A state never declares its own `model:` — the opaque harness hint is declared
**once**, on the state's OWNING machine (`machines.<name>.model`), and is
stamped onto every one of that machine's own `prompt` states automatically. When
you group states under a reusable machine (see `src/workflows/unified.yaml` for
worked examples), give that machine's identity — a planner persona, a coder
persona — one `model:` at the top, not a repeated per-state field. A `model:`
left on a state fails to load, naming the machine to move it to.

There is also **no `memory:` key at all** — a state's memory scope is never
authored; it is computed from the state's position in the machine tree (each
machine INSTANCE gets its own scope, fresh on every entry). The one authoring
implication worth flagging: if you reuse one machine at two call sites (a
"dedup" instantiation, e.g. one shared gate machine referenced from two places),
you can no longer rely on that reuse to deliberately share one agent
conversation across both sites — each instance gets its OWN scope and its own
fresh-per-entry memory, so two references to the same machine are two
independent conversations, never one shared session. If you need two call sites
to share a conversation, they need to be the SAME machine instance (the same
position in the tree), not two references to a shared, reusable machine.

### Content kinds — exactly one per state

- **`prompt`** — instructions for an agent. The driver hands `content` to the
  agent; the agent acts, then the driver runs `gtd land`.
- **`script`** — a shell script the DRIVER runs verbatim via `bash`, then steps
  the actor to capture whatever the script left in the tree. gtd never executes
  it itself. Used for checks (run tests, write a findings file). Mechanics only
  — the _meaning_ of the result is decided by this state's `on` patterns, never
  by the script's exit code.
- **`message`** — text for a human. Drivers halt here; the human edits files and
  runs `gtd land`.

## Patterns — how `on` routes

Each `on` key is `<status> <glob>`, or the bare token `C`:

- `status` ∈ `A` (added) · `M` (modified) · `D` (deleted) · `*` (any status).
- `glob` matches the change's repo-relative path:
  - lone `*` matches within **one path segment** — it never crosses `/`. `* *`
    matches `NOTE.md` but NOT `.gtd/FEEDBACK.md`.
  - `**` crosses segments at any depth (including zero). `.gtd/**` matches
    `.gtd/FEEDBACK.md` and `.gtd/a/b.md`.
- `C` fires only on a **clean tree** (zero pending changes).

**The catch-all for "any dirty tree" is `"* **"`, not `"* *"`.** Use `"* **"`
whenever a change could touch a subdirectory (it almost always can).

**Declaration order matters — first match wins.** Rows are evaluated top to
bottom (YAML preserves key order). Put specific patterns before broad ones:

```yaml
on:
  "A .gtd/FEEDBACK.md": fixing # specific, first
  "M .gtd/FEEDBACK.md": fixing
  "D .gtd/FEEDBACK.md": reviewing
  "C": reviewing # clean-tree fallback
```

### Three step outcomes you are designing for

At `gtd land`, the engine decides:

- **Commit** — a pattern fired: everything pending is committed as
  `gtd(<actor>): <from> → <target>` (the state stepped from, then the matched
  target) and the machine advances.
- **No-op** — clean tree AND no `C` row, at a `script`/`message` state: zero
  commits (at a `script` state, `gtd land` exits 3 — SETTLED). This is the
  **default and it is deliberate** — a driver lands only a beat it acted on, and
  an act that changed nothing must author nothing unless you explicitly declare
  a `C` row.
- **Attempt** — clean tree AND no `C` row, at a `prompt` state: an EMPTY
  `gtd(<actor>): <state>` commit lands instead of a no-op — a fruitless agent
  dispatch costs money and must be remembered across restarts, unlike a
  fruitless check. Decide per state: is a clean step a _signal_ (declare `C`),
  an _attempt_ (a `prompt` state's default), or a _no-op_ (a `script`/`message`
  state declaring no `C`)?
- **Refusal** — dirty tree but no pattern fires: zero commits, exit non-zero.
  "Something happened that nothing recognizes." Make sure your `on` map covers
  every change the state's actor can legitimately make (usually via a trailing
  `"* **"`).

An attempt is visible in history, not just to a driver: `gtd next --json`
reports `kind: "stalled"` (with a diagnosis as `content`) whenever HEAD is such
an empty attempt at the resting state and the tree is clean — on every call, and
sticky until something clears it. Two ways to clear a stall, both
workflow-authored: if the `prompt` state can legitimately finish with nothing to
change, declare a `C` row on it so that's the intended signal instead; if
repeated fruitless dispatches should escalate instead (e.g. to a human gate),
cap the state with `retry: { max, otherwise }` — the Nth attempt redirects to
`otherwise` rather than repeating forever (arriving at the state already counts
as one entry, so `max: N` allows N−1 fruitless attempts before redirecting).

### `describe` — human-readable routing

An `on` value may be `{ to: <target>, describe: <sentence> }`. `describe` is
**inert to the engine** (not matched, not rendered) — it exists so a `message:`
template can list "what each change does next" from `it.edges`, the same routing
the engine uses. See the human gates in `unified.yaml` for the pattern.

## Templates: content is Eta, `on` keys are NOT

Every `script`/`prompt`/`message` value — plus a workflow's own top-level
`summary:`, a machine's own `model:`, and a state's `file:` — is an
[Eta](https://eta.js.org) template rendered against a context you reference as
`it.<name>`:

- `it.vars.<name>` — the merged variable map (see "Variables").
- `it.read(path)` — read a working-tree file by repo-relative path (throws if
  missing; that throw refuses the step).
- `it.startCommit` / `it.currentCommit` / `it.previousCommit` — commit hashes.
- `it.reviewBase` — the previous review round's boundary (falls back to
  `it.startCommit` on a first review).
- `it.processBase` — the process's own trace/retry boundary (the parent of its
  first turn commit). `gtd summary` uses this to name the range it asks the
  agent to inspect.
- `it.state` / `it.actor` — the state and actor being rendered.
- `it.edges` — this state's `on` rows as `{ pattern, target, describe? }`.
- `it.processCost` / `it.processCostByModel` — accumulated token cost.

A `summary:` template additionally sees `it.entryCommit` (the process's entry
commit), `it.humanCommits` (every `human`-authored commit in the process's
trace, oldest to newest, as `{hash, state}`), and `it.processTip` (the process's
closing/current tip) — none of the three means anything at an ordinary state
template.

**No field ever carries diff content.** A prompt names a range (one of the base
hashes above) and tells the agent to run `git diff <base>` itself — never inline
a rendered diff into a template; the context doesn't carry one.

A content value starting with `./` or `../` is a **file reference** — read
relative to the config file at load time (a missing file is a load error).
Anything else is inline template source. The bundled
`src/workflows/unified.yaml` must be inline, with no `./` refs at all: it ships
as a raw string inside the single-file `dist/gtd.bundle.mjs` build, so every
content string must already be resolved at BUILD time, not read from disk at
runtime. A user's own `.gtdrc` has no such constraint and may use `./` refs
freely.

> **Critical caveat: `on` pattern keys are NOT Eta-rendered.** If you drive
> steering-file paths from `it.vars` (e.g. `file: <%= it.vars.todoFile %>`), the
> `on` patterns must still hardcode the **literal** path (`"A .gtd/TODO.md"`).
> Repointing the var changes what `file:`/prompts render but NOT what `on`
> matches — desyncing the machine. Keep the literal `on` path and the var's
> default value in sync.

## Steering files and modes

`file:` names THE file a human/editor should look at while resting here; `mode:`
(requires `file:`) names its FORMAT for validation:

- Built-in modes: **`qa`** (open-questions format, `## Open Questions` /
  `## Answered Questions` sections with free-form `###` question bodies) and
  **`review`** (checkbox review format). gtd parses these in-process for
  `gtd validate`, the `gtd land` capture gate, and `gtd lsp` diagnostics.
- Custom modes: declare a `modes:` entry with a `format:` and/or `validate:`
  shell command (each an Eta template over the state context plus `it.file`, run
  via `bash -c`; exit 0 = valid). A state's `mode:` may then name it.

A state that declares `file:`+`mode:` is gated on capture: `gtd land` formats
and validates the file and **refuses** to commit a malformed one. This runs for
agent drafts and human edits alike, so downstream gates only ever see
well-formed files. It is a no-op when the file is absent.

## Retry, review, and closing a process

- **`retry: { max, otherwise }`** caps how many times a state may be entered per
  process; once over the cap, a transition INTO it is redirected to `otherwise`
  (typically a human `escalate` gate). Bounds fix loops so agents can't burn
  tokens forever. `otherwise` must name a defined state.
- **`reviewWindow: true`** — while resting here, gtd rewinds HEAD/index to the
  review base (working tree untouched) so the whole process diff shows up as
  uncommitted changes in the editor. `reviewBase: true` anchors that base to
  this state's own most-recent in-process commit; absent one, it defaults to the
  process start.
- **`reviewBase: <Eta template>`** — a different shape from `reviewBase: true`:
  a string is rendered (only meaningful when the state is entered via `--entry`)
  to a commitish that fixes the WHOLE PROCESS's diff base, not just the review
  window's. This is how a manual entry reviews an arbitrary `<commitish>..HEAD`
  (e.g. a colleague's PR branch) — the replacement for the old
  `gtd review <commitish>` command:

  ```yaml
  vars:
    reviewBase: "" # blank compiles away to "field absent" until overridden
  states:
    review-entry:
      reviewBase: <%= it.vars.reviewBase %>
      entry: true
      # ...
  ```

  Enter it with `gtd --entry review-entry --var reviewBase=<commitish>`; the
  template must render to a non-blank commitish that resolves to a real commit,
  is an ancestor of HEAD, and differs from HEAD.

- **`entry: true`** — marks this state an EXTRA reachability root:
  `gtd --entry <this state's qualified name>` starts a brand-new process here
  (any number of states may declare it; forbidden on the initial state). This is
  a RECORD-KEEPING flag only (it also drives a badge in `gtd visualize`) — it is
  **not** a precondition for `--entry` to work. `--entry` accepts **any**
  declared state of the workflow, flagged or not; declare `entry: true` only on
  a state that would otherwise be unreachable from the initial state by ordinary
  `on` routing (a state `idle` already reaches needs no flag to be a valid
  `--entry` target).
- **Closing a process** — gtd never rewrites history: there is no squash-commit
  content kind any more. A review sign-off routes its `on` edge straight to a
  state entering the workflow's initial state (`unified.yaml`'s `build.review`
  binds `onSignoff: $onDone` up to the root's `onDone: idle`) — an ORDINARY
  commit, keeping every per-turn commit in history. If you want a closing
  message for that commit range, declare a top-level `summary:` template
  (sibling to `vars:`/`modes:`, an Eta template over the same context as a state
  plus `it.entryCommit`/`it.humanCommits`/`it.processTip` — see "Templates"
  above): `gtd summary` renders it and prints the result for an agent to turn
  into the process's own closing message (a squash, an amend, a PR body) —
  writing nothing itself. Absent `summary:` is legal; `gtd summary` just
  refuses. A present-but-blank `summary:` is a load error.

## Variables

`it.vars` merges three layers (later wins): `workflow.vars` (the workflow's own
defaults) → top-level `.gtdrc` `vars:` → `GTD_<NAME>` environment variables.
Values are scalars only (objects/arrays are rejected). gtd blesses **no** names
— `testCommand`, `plannerModel`, etc. in the bundled templates are ordinary
authored data, not keys gtd interprets. Use `vars:` to make one value (a test
command, a model tier, a file path) repointable in one place.

## Hard rules the compiler enforces (load-time errors)

Any of these fails config load, which breaks every state command. Check them
before declaring a workflow done:

- At least one state; **exactly one** `initial: true` state.
- Every state declares **exactly one** content kind (script/prompt/message) and
  an `actor`.
- Every `on` pattern parses; every `on` target and every `retry.otherwise` names
  a **defined** state.
- `retry.max` is a non-negative integer.
- `model`, declared once per machine, is stamped onto every one of that
  machine's own `prompt` states — there is no per-state `model:` and no
  `memory:` key at all. `file`, when present, must be a non-empty string. `mode`
  names a known mode (built-in or `modes:` entry) and requires a sibling
  `file:`.
- Every `modes:` entry declares at least one non-blank `format:`/`validate:`.
- `entry: true` (any number of states) never on the initial state. A
  `reviewBase` template (the string form) must not be blank. A top-level
  `summary:`, when present, must not be blank.
- **Every state is reachable** from the initial state by walking `on` targets
  and `retry.otherwise` redirects. An unreachable state is an ERROR (a typo'd
  rename or leftover), not a warning — there is no "manual-entry-only" state.

Also keep the **hygiene invariant** the bundled templates hold: an approved
process leaves `.gtd/` empty (each steering file is cleaned up by the state that
consumes it). A workflow that accumulates cruft in `.gtd/` across processes is
almost certainly a bug.

## Verify (after every change)

The workflow definition is validated at **config load**, so any state command
surfaces compile/validation errors — but two commands are best for authoring:

1. **`gtd visualize --json`** — compiles the workflow and prints the resulting
   model (every state with its actor/kind/retry details and every `on` edge with
   its pattern and target), then exits. It compiles the config first, so a
   broken definition prints the error here. Check the shape, edges, and
   reachability against intent. Drop `--json` to serve the same model as an
   interactive diagram in a browser instead.
2. **`gtd status`** — resolves the current HEAD to a state and dry-runs the
   pattern report without mutating anything. Confirms the config loads and shows
   how the current tree would route.

`gtd validate` is NOT for this — it validates a **steering file's** format
(qa/review), not the workflow definition.

To sanity-check behavior end to end, in a scratch repo make a change the state's
`on` expects and run `gtd land`, then `gtd next --json` to see where it landed.
Then update the README / any docs describing the workflow if the change is
user-facing.

## Worked example: add an approval gate before building

Insert a human sign-off between planning and building in the unified template.
Add a state and re-route the edge into it:

```yaml
states:
  # ... plan-review previously routed "C" straight to `building`.
  plan-review:
    on:
      "C":
        to: approve-plan # was: building
        describe: Accept the plan and send it for sign-off.
      "* **": planning

  approve-plan: # NEW human gate
    actor: human
    file: <%= it.vars.todoFile %>
    message: |
      The plan in `<%= it.vars.todoFile %>` is ready. Approve to build.

      What each change does next (then run `gtd land`):
      <% it.edges.forEach(function (e) { if (e.describe) { %>
      <%~ "- " + e.describe + "\n" %>
      <% } }) %>
    on:
      "C":
        to: building
        describe: Change nothing to approve the plan and start building.
      "* **":
        to: planning
        describe: Edit the plan to send it back for another round.
```

Then verify: `gtd visualize --json` shows
`plan-review → approve-plan → building`, `approve-plan` is reachable, and no
state is orphaned.

## Notes

- This skill is versioned in the gtd repo, not auto-installed. When gtd is
  upgraded, re-copy it from the new version's `skills/authoring/SKILL.md` so the
  authoring contract stays in sync with the compiler it targets.
- Where this file and the code disagree, the code wins: `src/PatternMachine.ts`
  (engine + `validateDefinition`), `src/PatternConfig.ts` (compiler),
  `src/workflows/unified.yaml` (the bundled workflow).
