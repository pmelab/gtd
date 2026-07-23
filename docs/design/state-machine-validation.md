# Research: static validation of workflow definitions

> Status: PARTIALLY IMPLEMENTED. Scope decision: a workflow is bound to a
> project and edited as a project-wide change (never mid-process), so the
> mid-flight/backward-compat concerns in §6 don't apply, and no warning channel
> is needed — implemented checks are plain errors. Landed: the full `workflow:`
> typing in `schema.json` (§6.1, via `jsonSchema` annotations in
> `src/ConfigSchema.ts`) and the unreachable-state error (§3.1, as
> `validateReachability` in `src/PatternMachine.ts` — invalid `on`/
> `retry.otherwise` targets were already errors). Everything else in this
> document is deliberately on hold.

## 1. What is validated today (baseline)

Two layers run at config-load time, both aggregate-all-findings-then-throw
(`compileWorkflowConfig` merges its shape errors with `validateDefinition`'s
findings into one error — a bad config fails loudly at load, never at step
time):

- **Config shape** (`src/PatternConfig.ts`): unknown top-level/state/retry keys,
  wrong types, unreadable `./` file references, non-scalar `vars:` values.
- **Definition rules** (`src/PatternMachine.ts` `validateDefinition`): at least
  one state; exactly one non-commit `initial`; exactly one content kind per
  state; commit states carry no `actor`/`on`/`model`/`file`/`mode`; non-commit
  states carry an `actor`; every `on` pattern parses; every `on` target and
  `retry.otherwise` names a defined state; `retry.max` is a non-negative
  integer; `file`/`model` non-empty; `mode` ∈ {qa, review} and requires `file`.

Every one of these checks is **local** — a rule over one state (or one field) at
a time. Nothing today looks at the definition as a _graph_. The v2 design doc
(`configurable-state-machine.md` §3.11) planned exactly that class of checks
(totality, reachability, ambiguity, livelock bounds); the v3 rewrite shipped
without them.

## 2. The gap: definitions that validate clean but are broken

Each of these passes today's validation:

1. **Unreachable state** — defined, valid, but no `on` target or
   `retry.otherwise` ever names it (typically a rename that missed the edges).
   It silently never runs.
2. **Dead-end state** — a non-commit state with no `on` map (or an empty one).
   Once entered, every step is a no-op (clean) or refusal (dirty) forever; the
   process can never leave.
3. **Trap cycle** — a group of states that reach each other but from which no
   terminal (a commit state, or re-entry into the initial state — the bundled
   default's only "end") is reachable. The process runs but can never complete.
4. **Unbounded agent loop (livelock)** — a cycle consisting only of agent/check
   states with no `retry` cap on any member. The default's `fixing ↔ checking`
   loop is safe only because `fixing` carries
   `retry: {max: 3, otherwise: escalate}`; delete that key and the machine
   validates clean but can ping-pong forever with no human in the loop.
5. **Shadowed `on` row** — `on` is first-match-wins, so
   `{"* **": a, "A .gtd/FORMAT.md": b}` never routes to `b`: the catch-all
   subsumes the specific row. Dead rows are silent today.
6. **`retry.otherwise` cycle / self-reference** — `applyRetry` terminates at
   runtime via its `visited` guard, but the guard's "accept the repeated target
   as final" behavior is almost certainly not what the author meant; the config
   is accepted silently.
7. **Pointless `retry`** — retry redirection applies when a state is entered _as
   a transition target_; a `retry` on a state nothing targets never fires.
8. **Template errors discovered at step time** — Eta syntax errors in
   `prompt`/`script`/`message`/`commit`/`file` templates surface only when that
   state is first rendered, contradicting the "fails at load, never at step
   time" contract everything else honors.
9. **The documented `vars` ↔ `on` desync** (`default.yaml`'s KNOWN LIMITATION) —
   `on` patterns are literal strings while `file:` and content templates read
   `it.vars.todoFile` etc.; repointing a var moves what templates read/write
   without moving what patterns match.

## 3. Algorithm survey

The good news: a gtd workflow is a small, explicit, finite directed graph (the
bundled default: 12 nodes, ~25 edges; a custom one is the same order of
magnitude). Every algorithm below is textbook material and costs microseconds at
this size — there is no need for a model checker, SAT solver, or symbolic
anything. The edge set for all graph checks is `on` targets ∪ `retry.otherwise`
targets.

### 3.1 Reachability — accessible states (BFS/DFS from the initial state)

The classic "useless states" removal from automata theory, first half: a state
is _accessible_ iff some path from the start state reaches it. One BFS/DFS from
the `initial` state over the edge set, O(V+E). Anything not visited is finding
#1 (unreachable).

**gtd nuance:** history is an attributed state trace, and `resolveState` accepts
_any_ hand-authored `gtd(<actor>): <state>` subject naming a defined non-commit
state and a declared actor — so an edge-unreachable state is still _enterable_
by writing a commit by hand. That makes unreachability a **warning**, not a hard
error: it is almost always a typo'd rename, but a deliberate "manual entry
point" state is expressible and legal. (It also means an unreachable state's
`actor` still widens the closed-world actor vocabulary — one more reason the
finding deserves surfacing.)

### 3.2 Co-reachability — can-complete (reverse BFS from terminals)

The second half of the same textbook construction: a state is _co-accessible_
iff a terminal is reachable from it; an automaton restricted to accessible ∩
co-accessible states is called _trim_. Reverse the edges, BFS from the terminal
set, flag unvisited states.

**gtd's terminal set** is `commit` states ∪ the `initial` state — the bundled
default has no commit state at all; its cycle "ends" by re-entering `idle` (the
process-boundary rule in `computeProcessRun`). A reachable state that is not
co-accessible is a trap (finding #3); a state with no outgoing edges at all
(finding #2) is the degenerate case but deserves its own, more specific message.

This is also exactly what **workflow-net soundness** (van der Aalst; the Woflan
validator) checks in the Petri-net world: _option to complete_ (from every
reachable marking, the end is reachable) plus _no dead transitions_. gtd's
machine has no concurrency/tokens, so full soundness collapses to the two
reachability passes above — the whole "soundness" property is two BFS runs here.

### 3.3 Livelock heuristic — SCC analysis (Tarjan)

Full progress proofs are out of reach (whether a pattern fires depends on what
an agent writes), but the v2 plan's "livelock bounds" idea translates cleanly:
compute strongly connected components (Tarjan, O(V+E)), and for each cyclic SCC
check that it contains an _escape guarantee_:

- a state whose `actor` is a human-ish rest point (the machine stops and waits —
  a human can always steer out), **or**
- a member with a `retry` cap whose `otherwise` leaves the SCC (bounded
  redirection out).

An SCC with neither — e.g. `building → checking → fixing → checking` with no cap
— is a machine that can loop autonomously forever. Since "human-ish" is not
knowable (actors are open-vocabulary strings; the engine deliberately blesses no
names), the practical formulation is: **flag any cycle in which no member state
either awaits a different actor than the cycle's dominant one or carries a retry
cap escaping the cycle** — or, simpler and honest, make it a warning listing the
cycle and what would bound it. This mirrors how linters handle undecidable
properties: name the risk, don't pretend to prove it.

### 3.4 Shadowed/dead `on` rows — pattern subsumption (match-arm usefulness)

`on` is an ordered first-match-wins list — semantically identical to ML/Rust
`match` arms, where compilers warn on unreachable arms using the _usefulness_
algorithm (Maranget, "Warnings for pattern matching"). gtd's pattern grammar is
far simpler than ML patterns, so full usefulness reduces to pairwise
subsumption:

- Row _j_ is dead iff some earlier row _i_ fires on every diff row _j_ fires on.
  Matching is existential over the change set, so language inclusion is
  sufficient: if row _i_'s (status, glob) language ⊇ row _j_'s, any change
  matching _j_ also matches _i_, hence _i_ fires first.
- `C` is disjoint from every diff row (clean vs. dirty), so it can only be
  shadowed by an earlier duplicate `C`.
- Status subsumption is trivial (`*` ⊇ `A`/`M`/`D`; equal otherwise). Glob
  inclusion over the grammar {literal chars, `*`, `**`} is decidable — both
  compile to regular languages (`globToRegExp` already builds the regexes), and
  regular-language inclusion is decidable via product construction. In practice
  a direct segment-wise structural check (the approach gitignore/ file-watcher
  tooling uses) covers it without regex machinery, and even the cheap sufficient
  subset catches the real-world cases:
  - an exact duplicate pattern string earlier in the list (see also §4.1 — YAML
    may reject or silently drop these before the compiler sees them),
  - `* **` (or `* <glob>` with the identical glob) declared before a
    more-specific row,
  - same glob, earlier row's status `*` vs. later row's specific letter.

This one is a hard **error** candidate: a dead row is never intentional, and the
fix (reorder) is mechanical.

Deliberately **not** worth adopting from the match-checking world:
_exhaustiveness_. A dirty tree matching no row is a refusal **by design**
(AGENTS.md: "something happened that nothing recognizes" is a signal distinct
from a no-op), and a clean step with no `C` row is the documented default no-op.
The event space is intentionally non-total; a totality lint would fight the
semantics.

### 3.5 Retry-chain analysis — cycle detection on a functional graph

`retry.otherwise` edges form a functional graph (≤1 outgoing edge per state), so
cycle detection is a trivial colored DFS (or Floyd's, but at this size DFS with
a visited set is clearer — `applyRetry` already contains the runtime version of
it). Findings: `otherwise` chains that cycle (error — the runtime guard's
"accept the repeated target" fallback is a documented we-must-terminate
behavior, not a meaning), `otherwise: <self>` (degenerate case of the same), and
a `retry` on a state that no `on` edge targets (warning — it can never fire, per
`applyRetry`'s entry-as-target semantics).

### 3.6 Template validation — compile at load time

Eta exposes compilation separately from rendering: `compile()` every
`prompt`/`script`/`message`/`commit`/`file` string at load and report syntax
errors as load errors, closing gap #8 without executing anything impure
(rendering stays an edge concern; compiling is pure).

One step further, the **undefined-variable lint**: scan template source for
`it.vars.<name>` references and compare against the merged
workflow-`vars:`/rc-`vars:` keys. Because a third layer (`GTD_VAR_*` env vars)
can legitimately supply a name at run time, an unknown name is a **warning**,
not an error. (A full "render with a tracking proxy and record misses" approach
also works but executes template code at load — scanning the source is safer and
catches the common typo just as well.)

### 3.7 Domain cross-checks (gtd-specific lints)

Not from the literature — from this codebase's own documented failure modes:

- **`file:` ↔ `on` consistency** (gap #9): render each state's `file:` template
  with the workflow's _declared default_ vars (pure — the defaults are right
  there in the definition) and warn when the rendered path is matched by none of
  the workflow's `on` globs. This turns `default.yaml`'s KNOWN LIMITATION
  comment into a machine-checked finding whenever a var repoint desyncs
  templates from patterns. The same check re-run at `gtd status` time with the
  _actual_ merged vars (env layer included) closes the runtime half of the gap.
- **Actor typo proximity**: the actor vocabulary is open by design, so `agnet`
  is a legal actor — but a state awaiting it will never be stepped by the loop
  driving `agent`. A Levenshtein "did you mean" warning when one declared actor
  is within edit distance 1 of another (a pattern lifted from CLI arg parsers
  and `git`'s command suggestions). Warning-only; false positives are possible
  (`qa1`/`qa2`), so never an error.

### 3.8 Dynamic validation — model-based testing (complement, not substitute)

Since `step` is a pure function, the graph can be _executed_ exhaustively in
tests: for every state and every `on` row, synthesize a minimal diff that the
row's pattern matches (invert the glob: replace `*`/`**` with a literal segment)
and assert `step` routes there — i.e., every declared edge is exercisable. This
is the state-machine-testing pattern XState ships as `@xstate/graph`
(`getShortestPaths`/`getSimplePaths` for path coverage) and what the
model-based-testing literature calls transition coverage. It overlaps §3.4 (a
shadowed row shows up as an unexercisable edge) but from the behavioral side,
and it doubles as a regression harness for the pattern grammar itself. Fits
naturally as a property test over `defaultWorkflowDefinition` rather than a
load-time check.

## 4. Patterns from comparable systems

- **Automata theory** — _trim_ construction (accessible ∩ co-accessible),
  §3.1/§3.2. The canonical "early problem detection" for FSMs.
- **Workflow nets** — soundness (option to complete, no dead transitions);
  degenerates to the same two BFS passes for token-free graphs.
- **SCXML / W3C statecharts** — conformance validation is exactly this flavor:
  every `target` IDREF resolves, `initial` names a real child, etc. gtd already
  has the local half; the graph half is what's missing.
- **XState** — beyond TS-level typegen, its ecosystem does reachability via path
  enumeration (`@xstate/graph`) and visual inspection (Stately inspector) rather
  than a lint pass — an argument for also shipping a human-readable graph dump
  (see §5, `gtd lint`).
- **ML/Rust match checking** — usefulness/unreachable-arm warnings, §3.4; also
  the precedent for making dead-arm a _warning_ in some compilers and an _error_
  in none... but gtd's rows are config, not code paths, and a dead row means a
  whole state may be unreachable — error is defensible.
- **Model checking (CTL/LTL)** — names the property taxonomy worth keeping:
  today's checks are all _safety_ ("nothing malformed"); §3.2/§3.3 add the cheap
  _liveness_ half ("something good stays reachable"). At 12 nodes,
  `AG EF terminal` is just reverse-BFS — no checker needed.
- **Linter architecture (ESLint et al.)** — severity tiers (error/warning),
  collect-everything-then-report (gtd already does this for errors), stable
  finding identifiers, and machine-readable output. The missing piece in gtd is
  a **warning channel**: `compileWorkflowConfig` can only throw-or-pass, so
  warning-tier findings (§3.1's manual-entry nuance, §3.3's heuristic, §3.6's
  env-supplied vars, §3.7) currently have nowhere to go.

## 5. Recommendation

Tier the findings and keep every new check a pure function over
`WorkflowDefinition` (they need nothing but the definition — they belong in
`PatternMachine.ts` next to `validateDefinition`, except the Eta compile check,
which imports Eta and belongs in `PatternTemplates.ts`):

**Errors** (extend `validateDefinition`'s existing thrown aggregate; all
unambiguous, mechanical fixes):

1. Non-commit state with no `on` rows (dead end, §3.2's degenerate case).
2. Reachable state from which no terminal (commit state or initial) is reachable
   (trap, §3.2).
3. `on` row strictly subsumed by an earlier row (§3.4).
4. `retry.otherwise` self-reference or cycle (§3.5).
5. Eta template that does not compile (§3.6).

**Warnings** (requires adding a `{ severity, message }` shape and a channel —
print to stderr at load and/or surface under `gtd status`; a `gtd lint`
subcommand that prints all findings plus the state graph would follow the
XState-inspector precedent and cost little):

6. State unreachable via edges from `initial` (§3.1 — legal via hand-authored
   subjects, almost always a typo).
7. Autonomous cycle with no retry-capped escape (§3.3 heuristic).
8. `retry` on a state no edge targets (§3.5).
9. `it.vars.<name>` reference with no declared default (§3.6 — env layer may
   supply it).
10. `file:` rendering (with declared-default vars) to a path no `on` glob
    matches (§3.7).
11. Declared actor within edit distance 1 of another (§3.7).

**Test-side** (not load-time): transition-coverage property test over the
bundled default — synthesize a matching diff per `on` row, assert `step` takes
the edge (§3.8).

Sizing check: all graph passes are O(V+E) (two BFS + one Tarjan), subsumption is
O(rows² per state) over a trivial grammar, and template compilation is the only
cost that scales with content size. On workflows of tens of states this is
sub-millisecond — safe to run on every invocation, exactly like today's
`validateDefinition`.

### Interactions to respect

- **Severity of unreachability** hinges on `resolveState`'s hand-authored
  subject entry (§3.1) — do not promote finding 6 to an error without also
  deciding that manual-entry states are unsupported.
- **The bundled default must stay finding-free** — findings 7 and 10 are
  calibrated against it (`fixing`'s cap bounds the check loop; the literal
  `.gtd/...` patterns match the declared default vars). Any new check must be
  validated against `default.yaml` and `docs/examples/advanced-workflow.md`
  before landing.
- **Warning channel is the only architectural change** — everything else slots
  into the existing collect-and-merge flow in `compileWorkflowConfig`.

## 6. Reframe: safeguards for USER-authored machines

§1–§5 read as "validate the definition harder." The actual product goal is
narrower and different: the bundled default is already covered by e2e; what
needs protecting is a **user hand-writing a `workflow:` key in `.gtdrc`** — and
that shifts the design in three ways:

1. **Static analysis is structurally insufficient.** Whether an `on` pattern
   ever fires depends on what an agent writes into the tree at run time. No
   load-time check can prove a user's machine makes progress — it can only catch
   the mechanically-dead shapes (§2's findings 1–8). The worst user-facing
   failures — an agent↔check loop burning tokens all night, a process resting in
   a state whose patterns never match what its own prompt asks the agent to
   produce — need **runtime bounds**, not better proofs.
2. **Severity must be recalibrated for other people's configs.** A new hard
   error is a breaking change: a config that ran yesterday must not brick the
   repo after `npm update`, _especially_ mid-process. Checks that are
   "error-worthy" for a definition we author (§5's shadowed-row, trap-state)
   default to **warnings** for user configs; hard errors stay reserved for
   definitions that cannot execute at all (today's structural rules, plus
   templates that don't compile).
3. **A broken config must never take reporting down with it.** Today
   `compileWorkflowConfig` throws, and everything — including `gtd status` —
   dies with it. For a user mid-flight that's the difference between "gtd tells
   me what's wrong" and "gtd won't even tell me where I am."

The safeguards form four layers, ordered by when they catch the problem:

### 6.1 Authoring time — before the machine ever runs

- **A real JSON Schema.** `schema.json` is generated from `ConfigSchema.ts`,
  where `workflow`/`vars` are `Schema.Unknown` — so the published schema says
  `"title": "unknown"` and editors validate NOTHING about the one key users
  hand-write. Hand-authoring the workflow shape into the schema (states map,
  actor, the four content kinds, `on` as string→string, `retry`
  `{max, otherwise}`, `model`/`file`/`mode`) gives every yaml-language-server
  editor squiggles and autocomplete for free, with zero gtd code. The compiler
  stays the source of truth (the schema can't express "exactly one content kind"
  or cross-state rules); the schema is the fast first net, not a replacement.
  Cheapest, highest-leverage single item in this document.
- **`gtd lint` (a.k.a. "check my machine before I trust it").** Compile the
  config, run every §5 check, print ALL findings (errors + warnings) plus a
  human-readable dump of the graph — states, actors, edges, retry caps, and the
  reachability/terminal classification per state — so an author can _see_ the
  machine they wrote (mermaid `stateDiagram-v2` output fits: renderable in any
  markdown viewer, no new dependency to emit text). Also dry-compiles every Eta
  template. This is where warnings can be exhaustive and loud, because the user
  explicitly asked.

### 6.2 Load time — every invocation, quiet by default

- **The §5 checks with user-config severities**: structural rules and
  template-compile failures stay throwing errors; all graph findings
  (unreachable, trap, shadowed row, retry cycle, autonomous cycle) surface as
  stderr warnings — one line each, prefixed (`gtd: workflow warning: ...`),
  never fatal. Errors keep the current all-findings-in-one-throw behavior.
- **Degrade reporting gracefully**: `gtd status` should still answer with the
  findings when the config is broken (resolve HEAD against nothing, print the
  compile errors as the status) rather than crashing with a stack trace.
  `step`/`run`/`next` keep refusing — acting on a broken machine is worse than
  stopping — but the _reporting_ path must survive any config.

### 6.3 Run time — the bounds static analysis cannot provide

These are the actual safeguards, in the circuit-breaker sense. All three are
pure functions of data the engine already has (`processTrace`, the pending diff,
the definition) — they fit `PatternMachine.step`'s purity discipline.

- **A per-process autonomous-turn budget.** The v2 plan's "chain-depth limit"
  (§3.11: "bound it and hard-error past, say, 32 hops"), reborn for v3: count
  process-trace entries into states whose actor differs from the workflow's
  human-facing rest points — concretely, entries since the last turn authored by
  a DIFFERENT actor than the loop's autonomous pair, or simplest and honest:
  total trace length. Past a cap (workflow-overridable via a reserved-ish var or
  top-level config key, default generous — e.g. 50), `step` refuses with a new
  refusal reason (`"budget"`) naming the count and how to raise the cap. This is
  the one safeguard that holds NO MATTER WHAT the user's graph looks like — the
  livelock heuristic (§3.3) can then stay a soft warning without leaving a hole.
- **Stall detection in the engine, not the skill.** `skills/loop/SKILL.md`
  currently tells the driver, in prose, to stop when the same state+content
  repeats with no new commits. Promote the signal: `gtd next --json` (and
  `status --json`) can report `"revisits": <n>` — how many times the current
  state already appears in the process trace. Any driver (not just one that read
  the skill carefully) can then apply its own stop rule; the skill's prose
  heuristic becomes one consumer of a first-class field. No behavior change in
  the engine's own decisions.
- **Self-explaining refusals.** A no-match refusal already lists the state's
  declared patterns; for a user debugging their own machine, also list the
  pending changes that failed to match (status + path, first N). "Your tree has
  `M src/x.ts` but this state only matches `A .gtd/FORMAT.md`" turns the most
  common custom-workflow dead end from a mystery into a diff-vs-pattern
  diagnosis the user can act on immediately.

### 6.4 Recovery — no config may trap the repository

Already true, worth asserting and documenting as a guarantee: the machine's
whole state is HEAD's commit subject, so a hand-authored commit
(`git commit --allow-empty -m "gtd(human): <state>"` for any defined non-commit
state, or any non-gtd subject to fall back to the initial state) exits ANY state
a broken config strands a process in. A user's workflow can waste turns; it
cannot brick a repo. An e2e scenario pinning this (hand-commit out of an
intentionally-trapped custom workflow) makes the guarantee load-bearing instead
of incidental — and it is the reason every graph finding in §6.2 can afford to
be a warning.

### What deliberately stays out

- No sandboxing or vetting of `script:` content — the workflow author is
  trusted; scripts already run verbatim by design (`gtd run`).
- No engine interpretation of actor names for the budget/livelock rules beyond
  counting — the actor vocabulary stays unblessed.
- No auto-repair ("we removed your unreachable state") — findings report; the
  user decides.

### Revised priority (user-safeguard lens)

1. JSON Schema for the `workflow:` shape (§6.1) — editor-time, zero engine code.
2. Warning channel + graceful `gtd status` degradation (§6.2) — the
   architectural enabler.
3. Autonomous-turn budget refusal (§6.3) — the unconditional backstop.
4. Graph warnings from §5, demoted to warning severity (§6.2).
5. Refusal diagnostics + `revisits` in `--json` (§6.3).
6. `gtd lint` with graph dump (§6.1) — subsumes nothing above, packages all of
   it for the authoring moment.
