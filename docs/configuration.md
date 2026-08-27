# Configuration reference

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
  summary: <string> # optional — an Eta template rendered by `gtd summary`; a `./`/`../` value is inlined from the config directory like a state's content; absent is legal (`gtd summary` refuses); present-but-blank is a load error
  entry:
    default: <machine name> # which machine is the ROOT instance
  machines:
    <name>:
      model: <string> # optional, opaque harness hint — stamped onto every one of THIS machine's own `prompt` states; declared ONCE per machine, never per state
      params: [<param>, ...] # optional, advisory — documents which $params a caller may bind
      entry: <local or ref key> # this machine's own default local, resolved recursively
      states:
        <local>:
          actor: <string> # required
          script: <string> # exactly one of script/prompt/message
          prompt: <string>
          message: <string>
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
          reviewBase: true # optional — anchor the review's diff base (printed by `gtd base`) to this state's most-recent commit
          # reviewBase: <Eta template> # OR a template — rendered (only meaningful entering via --entry) to a commitish that fixes the WHOLE PROCESS's diff base
          requireProgress: true # optional, requires "file" — refuse a turn whose only change deletes this state's own `file:`
          answerGate: true # optional, requires "file" — refuse a turn until every open question in the (qa-mode) `file:` is answered
          requireRevert: true # optional, requires "file" — refuse a turn until the human's review-round paths actually match the review base's parent
          entry: true # optional — an EXTRA reachability root (`entries.manual`), enterable via `gtd --entry <this state's qualified name>` — NOT a precondition for `--entry` (any declared state is a valid target)
        <local>: { machine: <name>, with: { <param>: <value> } } # a REFERENCE — instantiates <name> as a child, qualified as `<local>.<childLocal>`
```

There is no `memory:` key anywhere in this shape — a state's memory scope is
never authored, only computed from its position in the machine tree (see
[Driving the loop](./driver.md#driving-the-loop) for the key format and how it
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

Besides `it.vars` (below), a `script`/`prompt`/`message` template sees:

- **`it.startCommit`** — the process's diff base (the commit the current process
  started from, or the base a `--var reviewBase=<commitish>` entry resolved to).
- **`it.reviewBase`** — the previous review round's boundary, falling back to
  `it.startCommit` on a first review. In the bundled template, an actionable
  round's NEXT review therefore covers the revert of the human's own lines
  (`re-unwind`) followed by the whole lap that re-derives and re-implements them
  — the net diff is the final implementation, the right thing to review, but no
  longer the tiny "just the fixes" delta a quick fix-and-re-review would have
  shown.
- **`it.processBase`** — the process's own trace/retry boundary (the parent of
  its first turn commit), never moved by a review entry's fixed base.
  `gtd summary` uses this to name the range it asks the agent to inspect.
- **`it.currentCommit`** / **`it.previousCommit`** — HEAD's hash and its parent,
  at render time.
- **`it.processCost`** / **`it.processCostByModel`** — accumulated token cost
  over the process (every `--cost`/`--model` recorded on `gtd land`), total and
  broken down per model.

#### `gtd summary`'s own template variables

A workflow's top-level `summary:` template is rendered against everything above,
plus three fields that mean nothing at an ordinary state template (the same
precedent a mode's `format:`/`validate:` command sets with `it.file`):

- **`it.entryCommit`** — the process's own entry commit, the trace's first hash.
- **`it.humanCommits`** — every `human`-authored commit in the process's trace,
  oldest to newest, as `{hash, state}` — a review round's edit, an answered
  question gate — minus `entryCommit` when it coincides with one. Derived
  generically off the commit subject's invoking actor, never by naming a state.
- **`it.processTip`** — the process's closing/current tip, the trace's last
  commit.

The prompt carries no session identity of its own — no `session.id`, no
`session.resume`, no model, no system prompt — so an agent reading it starts
cold and reads every decision back out of the commits it names.

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
> [`gtd --entry`](./cli.md#commands)). `gtd fix` likewise becomes
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
> [Driving the loop](./driver.md#driving-the-loop)). The bundled template was
> also restructured so machine boundaries line up with this new identity model,
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
> remark with no code edit) short-circuits straight to sign-off instead of
> spending a lap on nothing. As with every rename above, an in-flight process
> resting at `build.addressing` can no longer be resumed after upgrading;
> `gtd abandon` it (or finish it on the pre-upgrade workflow version) first.

> **Upgrading a `workflow:` that still declares a `commit:` state key, or
> templates against `it.retainedBase`?** The automatic squash finale is gone:
> the `commit:` content kind is removed from the engine, not just from the
> bundled workflow, so a state declaring `commit:` fails to LOAD — loudly, with
> a message naming the removal and pointing at `gtd summary` — rather than
> silently becoming an unknown-field error. A review sign-off now lands one more
> ordinary commit entering the workflow's initial state instead, keeping every
> per-turn commit on the branch; replace a `commit:` finale with a plain state
> your own `on` routing already leads into `idle`, and run `gtd summary`
> afterward (see [The `workflow:` key](#the-workflow-key) above) for a
> closing-message prompt. Separately, and by contrast, `it.retainedBase` was
> renamed `it.processBase` — the SAME rename fails SILENTLY, not loudly: Eta
> renders a reference to a missing key as an empty string rather than throwing,
> so a template still referencing `it.retainedBase` keeps loading and running,
> it just renders blank where the process's trace boundary used to appear.
> Search your workflow for both names before upgrading; only the `commit:` key
> refuses to load and tells you where.

### Variables

Every template — `script`/`prompt`/`message`, a workflow's top-level `summary:`,
a machine's own `model:`, and a state's `file:` — sees `it.vars`: a flat
`Record<string, string>` assembled from four layers, **later wins**:

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

- **`styleBlock`** — the voice itself, injected at all six prompt states that
  generate content, not just two: the free-prose ones — the `.gtd/packages/`
  package files (`architecture.decompose`) and `.gtd/SPEC_FEEDBACK.md`
  (`packages.item.spec.review`) — plus the four machine-parsed states named in
  the next bullet. Blanking `GTD_STYLEBLOCK` strips the voice from all six,
  including the machine-parsed ones, not only the free-prose two. In short: it's
  a deliverable, not a chat reply, so size follows the work; answer-first with
  no restatement; blunt and imperative; plain words; bold carries the load; ship
  the artifact bare; compressing is not dropping; one idea per block; flag risk
  in one blunt line; never narrate the work — and never-trim outranks every
  other rule in the set.
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

Three more vars exist purely to dedup wording repeated across several prompts —
they carry no voice, just shared instructions — and, like every bundled var, are
overridable via `.gtdrc` `vars:` or a `GTD_<NAME>` environment variable:

- **`stateFileRules`** — the "this workflow steers itself through its own state
  files, treat them as a private scratchpad" opener, injected as the first line
  of every prompt that touches a `.gtd/` file directly.
- **`questionBar`** — the open-questions warrant test, the decide-it-yourself
  sink, the `## Open Questions` checkbox shape, and the return-lap fold-in
  instruction shared by `design.triage` and `architecture.author`. Each site
  still states its own phase scope (product-only vs. TECHNICAL) locally, since
  that's where the two genuinely disagree.
- **`fixFeedbackPrompt`** — the body `packages.item.fix-suite` and `build.fix`
  share byte for byte: read `.gtd/FEEDBACK.md`, fix the code, leave it
  uncommitted. `fix-suite` appends one extra sentence about implementing a later
  package's work when that's the only way to green the suite; `build.fix` does
  not.

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
  - state "idle": must declare exactly one of script/prompt/message (found 2)
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

Not every finding is fatal. A non-`prompt`, non-initial, non-`human`-actor state
that declares no `"C"` (clean-tree) row is a **warning**, never a load error — a
clean tree there is a legitimate no-op by design (see "Step capture" in
AGENTS.md), but usually an oversight worth a nudge:

```
gtd: warning: state "checking" declares no "C" row
```

Every command that resolves workflow state prints each such warning once per
invocation, on stderr only — never stdout, and never a nonzero exit. It repeats
on every invocation until the workflow declares either a `"C"` row or is
otherwise fixed; that repetition is intentional, not a bug. `gtd visualize` and
`gtd lsp` never print it (neither resolves workflow state the same way
`gtd next`/`gtd land`/`gtd --entry` do).

The bundled unified template prints exactly two, on every invocation: `unwind`
and `build.review.deciding` both deliberately declare no `"C"` row, because
their clean-tree case is either ambiguous (a completed no-op vs. a `git revert`
failure swallowed by `set +e`, for `unwind`) or would auto-approve an unreviewed
round (`build.review.deciding`'s clean tree means its own `REVIEW.md` was never
provisioned, not that a human signed off). Routing either one somewhere to
silence the warning would be worse than the noise.

### The normalization-only contract on `format:`

`gtd land`'s own emitted script never runs a mode's `format:`/`validate:` pair —
it's only the HEAD assertion and the commit. Formatting and validating a
steering file is a driver contract instead: run it explicitly, ahead of
`gtd land`, off `gtd next --json`'s own `validate` field (or `gtd validate`,
which prints the same script). A driver that skips this can land a malformed or
unformatted steering file — `gtd land` itself no longer stops it.

A mode's `format:` command may reformat a steering file — whitespace, wrapping,
reordering — but must NEVER change what a land-capture guard would decide. gtd's
guards (the review-doc check, the feedback-progress check, the
answer-completeness check, the require-revert check — `src/StepGuards.ts`)
decide ONCE, against whichever bytes are on disk at the moment `gtd land` runs —
which may be before OR after a driver's own separate `format:` run, since that's
a different process at a different time with no guaranteed ordering against "gtd
decided". That's only safe because every built-in guard judges only the content
it explicitly cares about, not incidental formatting around it — the
feedback-progress guard, for instance, only checks whether a deleted file's
trimmed first line is the `NOTHING ACTIONABLE` sentinel, so reindenting the rest
of it changes nothing the guard reads. If you plug in your own `format:`
command, the same rule binds it: a formatter that also changes meaning —
stripping a paragraph a guard reads — makes the guard's decision and the file's
actual content disagree, and gtd will not catch that for you.

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
(`land`, `--entry`, `next`, `status`, `abandon`, `restore`, `validate`,
`summary`) will run — there is no workflow state to derive from an empty
history. Committing the `.gtdrc.json` above (or anything else) satisfies this by
construction; `gtd init`, `gtd install`, `gtd lsp`, `gtd visualize`, and
`gtd check` are unaffected since none of them derive workflow state.
