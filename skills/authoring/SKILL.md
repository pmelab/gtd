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
(a prompt, a script, a human message, or a squash-commit template), and routes
to the next state by matching the pending working-tree diff against an ordered
set of change **patterns**. Every step is a commit; the git history IS the
state. There is no engine to trace through — **a workflow is data**, compiled
from the `.gtdrc` `workflow:` key.

Your job here is to produce or edit that data so it compiles cleanly and does
what the user wants. Driving a workflow once it exists is a separate concern —
that is what the `bin/gtd` loop driver does.

## Golden rule: start from the built-in default, edit incrementally

Do **not** write a workflow from a blank page. gtd ships one known-good workflow
— the unified template (two file-keyed entry points, simple / advanced, into one
shared review + squash-finale tail) — and RUNS it as its built-in default when
no `workflow:` key is configured. To customize it, declare a `workflow:` key
that fully REPLACES the default (there is no `extends`/merge), so start from the
default's own source and edit it:

```bash
# The built-in default's source, heavily commented — copy from it, don't start blank:
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
    actor: <string> # who acts here. REQUIRED except on a commit state.
    prompt: <string> # EXACTLY ONE content kind (see below):
    # script: <string>       #   script | prompt | message | commit
    # message: <string>
    # commit: <string>
    on: # ordered map of pattern → next state (see "Patterns")
      "<pattern>": <targetState>
      "<pattern>": { to: <targetState>, describe: <sentence> }
    initial: true # EXACTLY ONE state across the workflow carries this
    retry: { max: <int>, otherwise: <targetState> } # optional cap (see "Retry")
    model: <string> # optional opaque harness hint (Eta-rendered)
    memory: <string> # optional opaque memory-scope label (Eta-rendered)
    file: <string> # optional steering file this state is about (Eta-rendered)
    mode: <modeName> # optional, REQUIRES file: — qa | review | a modes: entry
    reviewWindow: true # optional — open the review checkout window at rest here
    reviewBase: true # optional — anchor the review diff base to this state
    reviewEntry: true # optional — `gtd review <ref>` enters here (≤1 per workflow)
```

`actor` is a **plain string** — no closed vocabulary. `gtd step <actor>`
authenticates against it, and it becomes the commit subject
`gtd(<actor>): <from> → <to>`. Common actors: `human`, `agent`, `check`. Invent
your own freely; the set of valid actors is derived from what your states
declare.

### Content kinds — exactly one per state

- **`prompt`** — instructions for an agent. The driver hands `content` to the
  agent; the agent acts, then the driver runs `gtd step <actor>`.
- **`script`** — a shell script the DRIVER runs verbatim via `bash`, then steps
  the actor to capture whatever the script left in the tree. gtd never executes
  it itself. Used for checks (run tests, write a findings file). Mechanics only
  — the _meaning_ of the result is decided by this state's `on` patterns, never
  by the script's exit code.
- **`message`** — text for a human. Drivers halt here; the human edits files and
  runs `gtd step <actor>`.
- **`commit`** — a squash-commit message template. A state with `commit:` is
  **final**: it has NO `actor`, NO `on`, and no `model`/`memory`/`file`/`mode`/
  `review*`. Entering it squashes the whole process into one commit (see "Squash
  finale").

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

At `gtd step <actor>`, the engine decides:

- **Commit** — a pattern fired: everything pending is committed as
  `gtd(<actor>): <from> → <target>` (the state stepped from, then the matched
  target) and the machine advances.
- **No-op** — clean tree AND no `C` row: zero commits, exit 0. This is the
  **default and it is deliberate** — the loop opens each iteration with a step
  before the actor has acted, so a clean step must author nothing unless you
  explicitly declare a `C` row. Decide per state: is a clean step a _signal_
  (declare `C`) or a _no-op_ (declare none)?
- **Refusal** — dirty tree but no pattern fires: zero commits, exit non-zero.
  "Something happened that nothing recognizes." Make sure your `on` map covers
  every change the state's actor can legitimately make (usually via a trailing
  `"* **"`).

### `describe` — human-readable routing

An `on` value may be `{ to: <target>, describe: <sentence> }`. `describe` is
**inert to the engine** (not matched, not rendered) — it exists so a `message:`
template can list "what each change does next" from `it.edges`, the same routing
the engine uses. See the human gates in `unified.yaml` for the pattern.

## Templates: content is Eta, `on` keys are NOT

Every `script`/`prompt`/`message`/`commit` value — plus `model`/`memory`/`file`
— is an [Eta](https://eta.js.org) template rendered against a context you
reference as `it.<name>`:

- `it.vars.<name>` — the merged variable map (see "Variables").
- `it.read(path)` — read a working-tree file by repo-relative path (throws if
  missing; that throw refuses the step, which is intended for `commit:`).
- `it.startCommit` / `it.currentCommit` / `it.previousCommit` — commit hashes.
- `it.reviewBase` — the previous review round's boundary (falls back to
  `it.startCommit` on a first review).
- `it.retainedBase` — the process's trace/retry boundary, what a squash actually
  keeps.
- `it.state` / `it.actor` — the state and actor being rendered.
- `it.edges` — this state's `on` rows as `{ pattern, target, describe? }`.
- `it.processCost` / `it.processCostByModel` — accumulated token cost.

**No field ever carries diff content.** A prompt names a range (one of the base
hashes above) and tells the agent to run `git diff <base>` itself — never inline
a rendered diff into a template; the context doesn't carry one.

A content value starting with `./` or `../` is a **file reference** — read
relative to the config file at load time (a missing file is a load error).
Anything else is inline template source. Bundled templates must be inline (they
ship in a single-file build); a user's own `.gtdrc` may use `./` refs.

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
  `gtd validate`, the `gtd step` capture gate, and `gtd lsp` diagnostics.
- Custom modes: declare a `modes:` entry with a `format:` and/or `validate:`
  shell command (each an Eta template over the state context plus `it.file`, run
  via `bash -c`; exit 0 = valid). A state's `mode:` may then name it.

A state that declares `file:`+`mode:` is gated on capture: `gtd step` formats
and validates the file and **refuses** to commit a malformed one. This runs for
agent drafts and human edits alike, so downstream gates only ever see
well-formed files. It is a no-op when the file is absent.

## Retry, review, and the squash finale

- **`retry: { max, otherwise }`** caps how many times a state may be entered per
  process; once over the cap, a transition INTO it is redirected to `otherwise`
  (typically a human `escalate` gate). Bounds fix loops so agents can't burn
  tokens forever. `otherwise` must name a defined state.
- **`reviewWindow: true`** — while resting here, gtd rewinds HEAD/index to the
  review base (working tree untouched) so the whole cycle diff shows up as
  uncommitted changes in the editor. `reviewBase: true` anchors that base;
  absent one, it defaults to the process start.
- **`reviewEntry: true`** — the (≤1) state `gtd review <commitish>` enters to
  review an arbitrary `<commitish>..HEAD` (e.g. a colleague's PR). Forbidden on
  the initial state and on commit states.
- **Squash finale** — a `commit:` state ends the process by squashing the whole
  cycle into one commit using its rendered template as the message (see
  `unified.yaml`'s `squashing` → `done`, reached on a full review sign-off). A
  workflow can omit it and leave the per-step commits in history instead.

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

- At least one state; **exactly one** `initial: true` state, and it is not a
  commit state.
- Every state declares **exactly one** content kind.
- Every non-commit state has an `actor`; every **commit state has NO `actor` and
  NO `on`** (and no `model`/`memory`/`file`/`mode`/`review*`).
- Every `on` pattern parses; every `on` target and every `retry.otherwise` names
  a **defined** state.
- `retry.max` is a non-negative integer.
- `model`/`memory`/`file`, when present, are non-empty strings, forbidden on
  commit states. `mode` names a known mode (built-in or `modes:` entry) and
  requires a sibling `file:`.
- Every `modes:` entry declares at least one non-blank `format:`/`validate:`.
- `reviewEntry` on ≤1 state, never on the initial or a commit state.
- **Every state is reachable** from the initial state by walking `on` targets
  and `retry.otherwise` redirects. An unreachable state is an ERROR (a typo'd
  rename or leftover), not a warning — there is no "manual-entry-only" state.

Also keep the **hygiene invariant** the bundled templates hold: an approved
cycle leaves `.gtd/` empty (each steering file is cleaned up by the state that
consumes it). A workflow that accumulates cruft in `.gtd/` across cycles is
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
`on` expects and run `gtd step <actor>`, then `gtd next --json` to see where it
landed. Then update the README / any docs describing the workflow if the change
is user-facing.

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

      What each change does next (then run `gtd step human`):
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
  `src/workflows/unified.yaml` (the bundled workflow, heavily commented).
