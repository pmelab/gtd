# Design exploration: a fully configurable state machine

> Status: exploration, not a commitment. This document maps the building blocks
> a configuration-driven workflow engine would need so that the current v2
> machine becomes nothing more than the **default configuration**, and a user
> can define their own states, edges, conditions, and human gates.

## 1. What "the state machine" actually is today

Before designing a configurable version, it's worth being precise about what
would be configured. gtd's machine is **not** a classic FSM with a stored state
pointer. It is a pure re-derivation:

```
state = resolve( parse(first-parent history) + snapshot(working tree) + config )
```

Nothing is persisted except ordinary git commits; every invocation re-derives
the entire decision from scratch. That property buys crash-safety, human
tamper-tolerance, and v1 backward compatibility — and any configurable design
must preserve it, or it isn't the same product.

Concretely, the engine has three layers:

| Layer                | Where            | What it does                                                                                                                        |
| -------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Fact gathering**   | `src/Events.ts`  | IO edge: reads git history + working tree into `CommitEvent[]` flags and a `ResolvePayload` fact snapshot                           |
| **Pure resolution**  | `src/Machine.ts` | folds counters, checks illegal combinations, classifies HEAD (rest vs mid-chain), applies the precedence ladder, layers turn-taking |
| **Effect execution** | `src/Events.ts`  | `perform(EdgeAction)`: a closed set of side-effect opcodes (capture turn, routing commit, run tests, squash, …)                     |

The observation that makes configurability tractable: **most of the middle layer
is already data, not code.** `counterRules`, the illegal-combination rule lists,
`ROUTING_SUBJECT`, `TURN_GATES`, `INERT_EMPTY_AGENT_GATES`, `GATE_OVERRIDES`,
`STATE_TEMPLATE`, `MODEL_STATE`, and the entry-point pick order are all literal
tables today. `classifyHead` is a hand-unrolled table. What remains as genuine
code is a handful of precedence exceptions and the turn-taking layer. A
configurable machine is therefore less "rewrite the engine" and more "promote
the existing tables into a compiled artifact of a user-facing schema, and find
declarative homes for the ~20% that isn't table-shaped yet."

## 2. The shape of the proposal

Users author a **workflow definition** (states + edges + conditions, statechart
style). A **compile step** turns it into the internal tables the engine already
runs on:

```
workflow definition (user config)
        │  compile (validate totality, ambiguity, reachability)
        ▼
┌─────────────────────────────────────────────────────────┐
│ generated subject grammar   (turn gates, routing phases) │
│ head-classification table   (classifyHead rows)          │
│ interrupt/precedence rules  (steering-file ladder)       │
│ counter fold rules          (counterRules)               │
│ illegal-combination rules   (assertLegal)                │
│ prompt/model bindings       (STATE_TEMPLATE, MODEL_STATE)│
│ turn-taking parameters      (empty-turn policies, entry) │
└─────────────────────────────────────────────────────────┘
        ▼
same pure resolve() interpreter, now table-driven end to end
```

The commit log stays the only persistence. Turn and routing subjects are
**generated from the configured state/edge names**, and the boundary rule is
preserved: any subject outside the configured closed grammar is an inert
boundary commit. This is load-bearing (see §7 on config-change hazards) — it is
the same mechanism that already makes v1 history inert under v2.

Two design stances worth naming and rejecting:

- **Generic statechart runtime (XState-style) with a persisted state pointer.**
  Simple to configure, but abandons derive-from-history: crash recovery, human
  edits landing as ordinary commits, and `gtd next` as a pure query all break.
  Rejected.
- **Arbitrary user-defined effects (scripts as actions).** Turns the workflow
  into a CI system and destroys the safety analysis (an action's effect on the
  next resolution becomes unknowable). Rejected in favor of a **closed primitive
  toolbox** (§3.7) — like GitHub Actions, where the _graph_ is yours but the
  _runner semantics_ are built in. Custom behavior enters through prompts,
  templates, commands (`testCommand`-style strings), and artifacts — not through
  new opcodes.

## 3. The building blocks

Eleven blocks. Each lists what it generalizes from the current machine.

### 3.1 Actors

The turn-taking universe. Today: `human` and `agent`, hard-coded into the
subject grammar `gtd(<actor>): <gate>`, the invoker commands (`gtd step`,
`gtd step-agent`), and the refusal logic.

```yaml
actors:
  human: { kind: interactive } # gtd step
  agent: { kind: autonomous } # gtd step-agent
```

Keep the set fixed at these two for v1 of configurability. The building block
exists so a later version can add named roles (e.g. a second autonomous
`reviewer` actor invoked as `gtd step-agent --as reviewer`), but nothing in the
current functionality needs it, and multi-actor turn-taking multiplies the
refusal/fixpoint matrix.

### 3.2 Artifacts (steering files)

The single richest block. Every steering file becomes a declared **artifact**,
and almost everything the machine currently knows about files falls out of the
declaration:

```yaml
artifacts:
  todo:
    path: .gtd/TODO.md
    validator: open-questions # named, built-in validators (see below)
    format: true # run `gtd format` on capture
  architecture:
    path: .gtd/ARCHITECTURE.md
    validator: open-questions
    format: true
  plan:
    path: .gtd/PLAN.md
    entryOnly: true # may never coexist with anything else
  review:
    path: .gtd/REVIEW.md
    validator: review-doc
    probes: [checkbox-only-diff] # content probes this artifact opts into
  feedback:
    path: .gtd/FEEDBACK.md
    probes: [empty]
    consumedByTurn: fixing # precedence exception (see §3.6)
  errors:
    path: .gtd/ERRORS.md
  health:
    path: .gtd/HEALTH.md
    consumedByTurn: health-fixing
  squashMsg:
    path: .gtd/SQUASH_MSG.md
    template: templates/squash-msg.md # written by write-template; probe
    probes: [template-unmodified] # `template-unmodified` guards use it
  learnings:
    path: .gtd/LEARNINGS.md
    template: templates/learnings.md
    probes: [template-unmodified]

  packages: # the one non-file artifact KIND
    kind: package-set
    path: .gtd/
```

Each declared artifact automatically contributes **facts** to the guard
vocabulary (§3.4): `todo.exists`, `todo.committed`, `feedback.present`,
`feedback.empty`, `feedback.pendingDeletion`, `review.checkboxOnly`,
`squashMsg.isTemplate`, `packages.present`, `packages.modified`,
`packages.remaining`, … — exactly the `ResolvePayload` fields that exist today,
but _generated per artifact_ instead of hand-listed.

Three deliberately closed sub-vocabularies live here:

- **Content probes** — the machine inspects file content in exactly three ways
  today (FEEDBACK.md whitespace-emptiness, REVIEW.md checkbox-only diffs,
  template-unmodified checks). These stay a closed, named set. No user
  expression language ever reads file content; "file presence steers, content
  doesn't" survives as a design invariant with three opt-in exceptions.
- **Validators** — `open-questions` and `review-doc` are named built-ins (backed
  by `src/OpenQuestions.ts` / `src/ReviewDoc.ts`). A plausible later extension
  is a small declarative markdown-structure schema ("required `##` section",
  "first body line matches …"), but named validators reproduce today's behavior.
- **`package-set`** — packages are not a file; they are an ordered directory
  protocol (`01-*/`, task files, close-lowest-first) with their own facts and
  their own effect primitive (`close-package`). Modeling them as a special
  artifact _kind_ keeps the machine honest about that instead of pretending a
  directory tree is a boolean.

Mutual-exclusion ("illegal combinations") is declared as conflict sets, not 30
hand-written pairs — the compiler expands `entryOnly` and explicit `conflicts`
groups into the pairwise rule list `assertLegal` runs today:

```yaml
conflicts:
  - [health, packages, review, feedback, errors, todo, architecture, plan] # health vs world
  - [todo, architecture] # lifecycle stages of one document
  - [feedback, review]
  - requires: { feedback: packages } # FEEDBACK.md without packages → error
```

### 3.3 Commit-event flags and counters

`gatherEvents` currently derives six flags per commit (`isErrors`, `isFeedback`,
`isPackageStart`, `removedErrors`, `isHealthCheck`, `isTestsGreen`), and
`foldCounters` folds three counters from them with declarative reset/increment
rules. Both generalize cleanly:

```yaml
commitFlags:
  packageStart: { routing: [planning, package-done] }
  feedbackRound:
    { turn: { actor: agent, gate: agentic-review }, diffTouches: feedback }
  errorsRound: { routing: [errors] }
  removedErrors: { diffDeletes: errors }
  healthRound: { routing: [health-check] }
  testsGreen: { routing: [tests-green] }

counters:
  testFix:
    {
      resetOn: [packageStart, feedbackRound, removedErrors],
      incrementOn: [errorsRound],
    }
  reviewFix: { resetOn: [packageStart], incrementOn: [feedbackRound] }
  healthFix:
    {
      resetOn: [packageStart, removedErrors, testsGreen],
      incrementOn: [healthRound],
    }
```

A commit-flag predicate needs exactly three matchers to cover everything that
exists: _subject is routing phase X_, _subject is turn (actor, gate)_, and _diff
touches / deletes artifact Y_. `counterRules` in `Machine.ts` already has
precisely this shape — this block is a rename, not an invention. User- defined
counters plus `counterAtLeast` guards (§3.4) are what make custom
budget/threshold loops ("escalate to a human after N rounds of X") expressible
without code.

### 3.4 Facts and guard expressions

The guard vocabulary is the union of:

- artifact-derived facts (§3.2),
- built-in tree/head facts: `tree.clean`, `code.dirty`, `head.turnEmpty`,
  `head.isTurn(actor, gate)`, `head.isRouting(phase)`, `head.isBoundary`,
  `reviewable` (base + non-empty diff + commits since last done),
- counters: `counter(name)`,
- config parameters: `param(name)` — the `agenticReview` / `fixAttemptCap` /
  `reviewThreshold` / `squash` / `learning` values, which stay ordinary scalar
  config and travel to the resolver exactly as they do today (payload fields,
  per AGENTS.md's config-vs-mode-flag rule).

Guards are a small structured boolean AST — JSON/YAML, not an embedded
expression string, in keeping with schema-validated config and mutation-tested
code:

```yaml
when:
  {
    all: [{ not: { param: agenticReview } }],
    any: [{ counterAtLeast: { counter: reviewFix, param: reviewThreshold } }],
  }
```

(Sugar for common forms — `when: feedback.empty` — is a parser nicety, not a
semantic feature.) The force-approve rule, today a code comment thicket, becomes
one named, reusable guard:

```yaml
guards:
  forceApprove:
    any:
      - { not: { param: agenticReview } }
      - { counterAtLeast: { counter: reviewFix, param: reviewThreshold } }
```

### 3.5 States

```yaml
states:
  grilling:
    awaits: dynamic # resolved per-edge; grilling awaits human OR agent
    prompts:
      agent: prompts/grilling-agent.md
      human: prompts/grilling-answers.md
    model: planning # tier ref; per-state override still possible
    emptyAgentTurn: inert # the INERT_EMPTY_AGENT_GATES membership
    validateAgentTurn: open-questions # refuse agent capture on malformed doc
  await-review:
    awaits: human
    prompts: { human: prompts/await-review.md }
    gate: review # GATE_OVERRIDES: turn authored under another gate name
  squashing:
    awaits: agent
    prompts: { agent: prompts/squashing.md }
    model: planning
    emptyAgentTurn: { inertWhen: squashMsg.isTemplate } # conditional inertness
  health-fixing:
    awaits: agent
    emptyAgentTurn:
      { signal: true, inertWhen: { head.isTurn: [human, health-fixing] } }
  testing: { kind: edge-only } # never a rest; never renders a prompt
  close-package: { kind: edge-only }
  idle:
    awaits: human
    prompts: { human: prompts/idle.md }
```

Everything `PROMPT_STATES`, `MODEL_STATE`, `STATE_IS_OWN_GATE`,
`GATE_OVERRIDES`, and `INERT_EMPTY_AGENT_GATES` encode today collapses into
per-state declarations. The **empty-turn policy** deserves emphasis: the current
machine's most subtle invariant (AGENTS.md "Turn Capture") is that each gate
explicitly decides whether a clean-tree capture is a signal or a no-op, guarded
at BOTH the capture layer and the classification layer. Making it a mandatory
per-state field — with `inertWhen` guards for the conditional cases — forces
every custom machine author to make that decision explicitly, and lets the
compiler enforce that both layers read the same declaration (they already share
`isInertEmptyAgentRest`; the config keeps them shared).

### 3.6 Edges (the transition rules)

Resolution today happens in three passes, and the config mirrors them as three
edge families. Order matters in each family and is preserved as written.

**(a) Interrupt rules** — the steering-file precedence ladder: fire on facts
regardless of HEAD, top priority first. Each rule may carry `unless` exceptions;
the common one ("the turn that consumes this artifact must not be pre-empted by
the artifact's own presence") is auto-generated from the artifact's
`consumedByTurn` declaration:

```yaml
interrupts:
  - when: errors.present
    rest: { state: escalate }
  - when: health.present            # unless auto-generated: head is gtd(agent): health-fixing
    rest: { state: health-fixing }
  - when: { any: [feedback.present, feedback.pendingDeletion] }
    unless: { all: [guard: forceApprove, head.isRouting: tests-green] }
    branch:
      - when: { head.isRouting: tests-green }     # uncaptured reviewer write
        rest: { state: agentic-review }
      - when: { all: [feedback.emptyEffective, { not: fact: inFixLoop }] }
        chain: { state: close-package, action: close-package }
      - rest: { state: fixing }
```

**(b) Head rules** — the `classifyHead` table: match the parsed HEAD subject,
branch on guards, land on a **rest** (a state + awaited actor) or a **chain** (a
state label + one effect the driver performs before re-resolving — "mid-chain"
today):

```yaml
onTurn:
  - match: { actor: human, gate: grilling }
    branch:
      - when: head.turnEmpty
        chain:
          state: grilling
          action: { route: architecting, seed: { from: todo, to: architecture, banner: seeded-from-todo } }
      - rest: { state: grilling, awaits: agent }
  - match: { actor: agent, gate: grilled }
    branch:
      - when: packages.present
        chain: { state: grilled, action: { route: planning, remove: [architecture] } }
      - rest: { state: grilled, awaits: agent }    # guard: no packages → re-emit prompt
  - match: { actor: human, gate: review }
    branch:
      - when: fact: reviewSubstantive
        chain: { state: review, action: { route: review-feedback, remove: [review] } }
      - chain: { state: review, action: { route: done, remove: [review] } }

onRouting:
  - match: tests-green
    branch:
      - when: packages.present
        branch:
          - when: { guard: forceApprove }
            chain: { state: close-package, action: close-package }
          - rest: { state: agentic-review, awaits: agent }
      - use: afterCycleSettles          # named, reusable rule (learning → squash → idle)
  - match: awaiting-review
    rest: { state: await-review, awaits: human }
```

`use:` names a shared sub-rule — `nextAfterReviewOrLearning` in today's code
(the learning-then-squash-then-idle decision reached from three different
routing subjects) is exactly such a reusable fragment.

**(c) Fallback rules** — the boundary-HEAD ladder that runs when neither an
interrupt nor a head rule fired: `packages.modified → planning`,
`todo.exists → grilling`, `architecture.exists → architecting`,
`plan.exists → grilled (awaits human)`, the operational-recovery checkpoint
rule, `reviewable → review`, else `idle`, else **corruption error**. Same
ordered-rule shape as interrupts. The final "no rule matched → hard error, do
not guess" is engine behavior, not configurable — a custom machine keeps the
steering-misuse contract for free.

**Entry points** are a fourth, tiny rule list consumed by the turn-taking layer
(which artifact in a dirty boundary tree selects which entry gate):

```yaml
entry:
  - { when: health.exists, gate: health-fixing }
  - { when: plan.exists, gate: grilled }
  - { when: architecture.exists, gate: architecting }
  - { gate: grilling } # default
```

The compiler verifies the entry artifacts are pairwise-conflicting (§3.2), so
the pick is provably unambiguous — today that's a prose promise.

### 3.7 Effect primitives (the closed toolbox)

Config composes effects; it never defines new ones. The current eight
`EdgeAction` variants generalize into six parameterized opcodes:

| Primitive        | Parameters                                                                                                                                        | Generalizes                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `capture-turn`   | actor, gate (engine-chosen; not really config-facing)                                                                                             | `captureTurn`                                   |
| `route`          | routing phase; `remove: [artifact…]`; `seed: {from, to, banner}`                                                                                  | `commitRouting` + its five booleans             |
| `run-check`      | command ref; `green: route \| stop \| chain`; `red: {write: artifact, cap: {counter, param, write: artifact}, route}`; `removeFirst: [artifact…]` | `runTest` AND `runHealthCheck`                  |
| `write-template` | artifact (must declare `template:`); route                                                                                                        | `writeSquashTemplate` / `writeLearningTemplate` |
| `squash`         | base anchor (engine-computed cycle base); message-from artifact                                                                                   | `squashCommit`                                  |
| `close-package`  | (package-set artifact)                                                                                                                            | `closePackage`                                  |

`run-check` is the significant unification: `runTest` and `runHealthCheck` are
already the same shape (run command → green routes / red writes an artifact,
escalating to a different artifact at a counter cap), differing only in which
artifacts and which follow-up. Parameterizing it also unlocks the most-wanted
custom machines for free: **multiple named checks** (lint gate, typecheck gate,
e2e gate as separate states with separate budgets and separate commands) — today
impossible without forking the code.

Commands are declared alongside `testCommand`:

```yaml
commands:
  test: npm run test
  lint: npm run lint # available to custom run-check edges
```

### 3.8 The turn-taking engine (fixed, parameterized — not configurable)

Everything in `applyTurnTaking` stays engine code: invoker-vs-awaited refusal in
both directions, the fixpoint (idempotent re-invocation), the dirty-boundary
entry capture, pending-human-edits-ride-along, and `invoker: "none"` purity. It
is _parameterized_ by config (empty-turn policies, entry rules, per-gate
validators) but its skeleton is the product's safety core — the analysis in
AGENTS.md about guarding both layers exists precisely because this logic is easy
to get fatally wrong. A user configures _which_ gates exist and _who_ they
await; they do not configure what turn-taking means.

Likewise the **review checkout window** stays wired only in `program.ts`
(program-edge concern, per the architecture rule); config can at most toggle it
per human gate (`checkoutWindow: true` on `await-review`).

### 3.9 Prompts and models

Already halfway configurable (model tiers/states in `.gtdrc`). The remaining
moves:

- Per-state template **paths** in config, resolving user files with fallback to
  the built-ins (which ship as the default config's templates).
- A documented, versioned **view-model contract**: templates receive `context`
  (counters, packages, diffs, feedback content, decision log — the
  `ResolveContext` fields), `model`, `fenceFor`, and the shared partials
  (`@header`, `@diff`, `@package`, `@agent-turn`, …) stay available.
- Model tiers become config-defined names (`planning`, `execution` today) that
  states reference; the existing `models.states` override mechanism survives
  unchanged.

Custom states then get prompts the same way built-in ones do; a state without a
prompt and without `kind: edge-only` is a compile error.

### 3.10 The subject grammar (generated, namespaced)

`TurnGate` and `RoutingPhase` closed sets are generated from the config: every
state with an actor gate contributes a turn subject; every `route:` target
contributes a routing subject. Two rules preserve today's guarantees:

- **Closed-world parsing**: `parseSubject` matches only the configured sets;
  everything else is a boundary commit. v1 compatibility and "inert unknown
  subjects" survive automatically — including subjects from a _previous
  configuration_ (see §7).
- **Reserved namespace**: generated subjects keep the `gtd(actor): gate` /
  `gtd: phase` shapes. The compiler rejects state/phase names that collide with
  each other or with the parameterized `reviewing <hash>` anchor.

### 3.11 The compiler (static validation)

The piece that makes user-authored machines survivable. At load time (cached;
this runs on every invocation), validate:

- **Schema** — effect-schema decode with `onExcessProperty: "error"`, exactly
  like `ConfigSchema` today; every referenced artifact/guard/counter/command/
  state exists; no dangling `route:` targets.
- **Totality** — every routing phase emitted by some edge has an `onRouting`
  classification; every rest state has a prompt for its awaited actor(s); every
  state is reachable from an entry point; every `run-check` red path writes a
  declared artifact.
- **Ambiguity** — interrupt/fallback rules are ordered (documented semantics),
  but two `onTurn` matches for the same (actor, gate) with non-disjoint guard
  branches get flagged.
- **Livelock bounds** — full progress proofs are out of reach, but two cheap
  checks catch the classic traps: (1) every agent-awaited rest whose gate's
  empty turn is inert must have _some_ dirty-tree path forward, and (2) every
  counter used in a cap guard must have a reset flag reachable from the capped
  loop. Plus a runtime chain-depth limit (the driver already loops gather →
  resolve → perform; bound it and hard-error past, say, 32 hops).
- **Entry unambiguity** — entry-rule artifacts pairwise conflict (§3.6).

## 4. What the default configuration looks like

The full default config reproduces all 21 states / 12 gates / 17 routing phases;
the sketch below shows one representative slice of each family to make the
flavor concrete (grilling hand-off, the test loop, the human review gate):

```yaml
# gtd.workflow.yaml — excerpt of the shipped default
actors: { human: { kind: interactive }, agent: { kind: autonomous } }

commands: { test: "npm run test" }

params:
  fixAttemptCap: { default: 3 }
  reviewThreshold: { default: 3 }
  agenticReview: { default: true }
  squash: { default: true }
  learning: { default: true }

artifacts:
  todo: { path: .gtd/TODO.md, validator: open-questions, format: true }
  architecture:
    { path: .gtd/ARCHITECTURE.md, validator: open-questions, format: true }
  feedback: { path: .gtd/FEEDBACK.md, probes: [empty], consumedByTurn: fixing }
  errors: { path: .gtd/ERRORS.md }
  review:
    {
      path: .gtd/REVIEW.md,
      validator: review-doc,
      probes: [checkbox-only-diff],
    }
  packages: { kind: package-set, path: .gtd/ }

counters:
  testFix:
    {
      resetOn: [packageStart, feedbackRound, removedErrors],
      incrementOn: [errorsRound],
    }
  reviewFix: { resetOn: [packageStart], incrementOn: [feedbackRound] }

guards:
  forceApprove:
    any:
      - { not: { param: agenticReview } }
      - { counterAtLeast: { counter: reviewFix, param: reviewThreshold } }

states:
  grilling:
    awaits: dynamic
    prompts:
      { agent: prompts/grilling-agent.md, human: prompts/grilling-answers.md }
    model: planning
    emptyAgentTurn: inert
    validateAgentTurn: open-questions
  building:
    awaits: agent
    prompts: { agent: prompts/building.md }
    model: execution
    emptyAgentTurn: inert
  fixing:
    awaits: agent
    prompts: { agent: prompts/fixing.md }
    model: execution
    emptyAgentTurn: inert
  escalate:
    awaits: human
    prompts: { human: prompts/escalate.md }
  agentic-review:
    awaits: agent
    prompts: { agent: prompts/agentic-review.md }
    model: planning
    emptyAgentTurn: inert
  await-review:
    awaits: human
    prompts: { human: prompts/await-review.md }
    gate: review
    checkoutWindow: true
  testing: { kind: edge-only }
  close-package: { kind: edge-only }

interrupts:
  - { when: errors.present, rest: { state: escalate } }
  - when: { any: [feedback.present, feedback.pendingDeletion] }
    unless: { all: [{ guard: forceApprove }, { head.isRouting: tests-green }] }
    branch:
      - {
          when: { head.isRouting: tests-green },
          rest: { state: agentic-review },
        }
      - when: { all: [feedback.emptyEffective, { not: { fact: inFixLoop } }] }
        chain: { state: close-package, action: close-package }
      - rest: { state: fixing }

onTurn:
  - match: { actor: agent, gate: building }
    chain:
      state: building
      action:
        run-check:
          command: test
          removeFirst: [feedback]
          green: { route: tests-green }
          red:
            write: feedback
            cap: { counter: testFix, param: fixAttemptCap, write: errors }
            route: errors
  - match: { actor: human, gate: review }
    branch:
      - when: { fact: reviewSubstantive }
        chain:
          {
            state: review,
            action: { route: review-feedback, remove: [review] },
          }
      - chain: { state: review, action: { route: done, remove: [review] } }

onRouting:
  - match: planning
    rest: { state: building, awaits: agent }
  - match: errors
    branch:
      - { when: errors.present, rest: { state: escalate } }
      - rest: { state: fixing, awaits: agent }
  - match: tests-green
    branch:
      - when: packages.present
        branch:
          - {
              when: { guard: forceApprove },
              chain: { state: close-package, action: close-package },
            }
          - rest: { state: agentic-review, awaits: agent }
      - use: afterCycleSettles
  - match: awaiting-review
    rest: { state: await-review, awaits: human }

fallback:
  - {
      when: { all: [packages.present, packages.modified] },
      rest: { state: planning },
    }
  - { when: todo.exists, rest: { state: grilling, awaits: agent } }
  - { when: architecture.exists, rest: { state: architecting, awaits: agent } }
  - { when: { fact: reviewable }, rest: { state: review, awaits: agent } }
  - rest: { state: idle }

entry:
  - { when: health.exists, gate: health-fixing }
  - { when: plan.exists, gate: grilled }
  - { when: architecture.exists, gate: architecting }
  - { gate: grilling }
```

## 5. What a user-built machine looks like

A team that wants a minimal loop — no grilling, no learning, no squash, plus a
**security sign-off** human gate after the automated review — writes roughly:

```yaml
artifacts:
  spec: { path: .gtd/SPEC.md }
  security: { path: .gtd/SECURITY.md, probes: [checkbox-only-diff] }
  feedback: { path: .gtd/FEEDBACK.md, probes: [empty], consumedByTurn: fixing }
  errors: { path: .gtd/ERRORS.md }
  packages: { kind: package-set, path: .gtd/ }

states:
  planning:
    {
      awaits: agent,
      prompts: { agent: prompts/plan.md },
      model: planning,
      emptyAgentTurn: inert,
    }
  building:
    {
      awaits: agent,
      prompts: { agent: prompts/build.md },
      model: execution,
      emptyAgentTurn: inert,
    }
  fixing:
    {
      awaits: agent,
      prompts: { agent: prompts/fix.md },
      model: execution,
      emptyAgentTurn: inert,
    }
  security-review:
    awaits: agent
    prompts: { agent: prompts/security-review.md } # agent writes .gtd/SECURITY.md findings
    model: planning
    emptyAgentTurn: inert
  await-signoff:
    awaits: human
    prompts: { human: prompts/await-signoff.md }
    gate: security-review
    checkoutWindow: true
  escalate: { awaits: human, prompts: { human: prompts/escalate.md } }
  idle: { awaits: human, prompts: { human: prompts/idle.md } }
# … edges: spec.exists → planning; building turn → run-check(test);
# tests-green → security-review; agent security turn (security.present) →
# route awaiting-signoff; human signoff turn: checkbox-only/empty → done,
# substantive → route back to fixing with the human's diff as feedback.
```

The point of the example: the _human gate_ is just a state that `awaits: human`
with a checkout window and an empty-turn-is-approval convention — the same three
declarations the built-in review gate uses. Nothing about human gating is
special-cased anymore.

## 6. The hard 20% — honest inventory

Things in today's machine that resist naive table-ization, and where each lands:

| Today's special case                                                | Home in the design                                                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `headIsFixerTurn` / `headIsHealthFixerTurn` precedence exceptions   | auto-generated `unless` from artifact `consumedByTurn` (§3.2)                                                                |
| force-approve interplay with a lingering FEEDBACK.md at tests-green | named guard + explicit `unless` on the interrupt rule (§3.6) — stays visibly ugly, which is honest                           |
| delete-dispute (`pendingFeedbackDeletion` ≈ emptied file)           | artifact-derived fact `*.pendingDeletion` + the `emptyEffective` composite                                                   |
| empty-turn signal vs inert, per gate, guarded at two layers         | mandatory per-state `emptyAgentTurn` policy; compiler wires both layers (§3.5)                                               |
| health-fix same-chain re-test carve-outs in `applyTurnTaking`       | the genuinely hardest fit; likely a `run-check` edge annotation (`resumeChain: true`) rather than pure rules — needs a spike |
| operational-recovery (boundary commit atop a building checkpoint)   | engine-level fallback rule parameterized by "checkpoint gates" (states may declare `checkpoint: true`)                       |
| squash-base / review-base / healthFixBase anchor computation        | stays engine code — cycle-base discovery is history analysis, not policy                                                     |
| review checkout window                                              | program-edge, per-gate boolean only (§3.8)                                                                                   |
| decision-log accumulation, prompt-cache-friendly concatenation      | stays engine code; exposed to templates as a context field                                                                   |

If the health-fix carve-outs prove un-declarable, the fallback position is a
small set of engine-recognized **loop idioms** (a "check loop" macro that
expands to state + interrupt + carve-out) rather than leaking special cases into
user configs.

## 7. Hazards specific to configurability

**Config changes mid-history.** The machine's reading of history depends on the
config; edit the config and yesterday's subjects may fall out of the closed
grammar. The boundary rule makes this _degrade safely_ (unknown subjects go
inert — same mechanism as v1 compat) but a rename mid-cycle can still strand a
live cycle at an unresolvable rest. Mitigations, cheapest first: (1) document
"change workflow config only at idle"; (2) the compiler warns when the current
repo state resolves differently (or stops resolving) under the new config — it
can literally run both resolutions and diff them; (3) optionally record a config
content-hash in routing commits so the engine can _detect_ (not replay)
cross-config history. Full config-versioned replay is not worth it — squash
already collapses cycles, so history exposure is short.

**Livelocks and junk-commit loops.** Today's guards against
empty-turn-consumes-state disasters are hand-analyzed. The compiler checks in
§3.11 catch the mechanical cases; the chain-depth bound catches the rest at
runtime with a hard error instead of an infinite driver loop.

**Testing story.** Three layers: (1) a **golden equivalence suite** — the
existing `Machine.test.ts` / property tests run against both the legacy
hardcoded resolver and the interpreter-with-default-config, asserting identical
`Result`s for the same event streams (this is the migration's safety net, and
`resolve()`'s purity makes it cheap); (2) the existing cucumber features keep
passing unchanged against the default config, since the CLI surface doesn't
move; (3) for _user_ configs, the engine ships generic property checks (every
generated stream either progresses, rests awaiting an actor, refuses, or
hard-errors — never silently loops), runnable as `gtd workflow check`.

**Complexity budget.** The interpreter + compiler is a real cost; mutation
testing an interpreter is harder than mutation testing unrolled branches. The
counterweight: the unrolled branches are _already_ ~1800 lines whose safety
rests on prose comments, and every new feature (learning, health, PLAN.md entry)
has grown them by touching seven files (AGENTS.md's own removal checklist is the
symptom). Table-driving shrinks the change surface of the next feature to "edit
the default config."

## 8. Migration path

1. **Internal table extraction (no behavior change).** Finish what's started:
   fold `classifyHead`'s branches into literal rule rows; derive
   `ResolvePayload` artifact facts from an internal artifact table; generate
   `TurnGate`/`RoutingPhase`/illegal-combination lists from it. Golden tests pin
   equivalence. This step is valuable even if configurability never ships — it
   collapses the seven-file change surface.
2. **Interpreter + shipped default config.** Define the schema, write the
   compiler, express the default machine in it, and switch `resolve()` to the
   compiled tables. The legacy resolver stays as the test oracle for one
   release.
3. **Read user config.** Allow overrides of the _safe_ subset first: prompts,
   commands, params, model tiers, toggling shipped optional stages (learning/
   squash/health/agentic-review already have kill-switches — they become
   config-graph presence instead).
4. **Full custom machines.** Open states/edges/artifacts, ship
   `gtd workflow check`, document the view-model and primitive contracts.

Each step is independently shippable, and steps 1–2 carry zero user-visible risk
while retiring most of the implementation risk.

## Appendix A: the configuration surface, state by state

### A.1 Where the configuration lives

The workflow definition is a separate, **committed** file — the machine's
reading of history depends on it, so it must travel with the repo:

```
gtd.workflow.yaml        # the workflow definition (states, edges, artifacts…)
.gtdrc.json              # scalar knobs, unchanged: testCommand, params, models
prompts/…                # user template overrides (optional)
```

`.gtdrc` keeps what it has today (per-user/per-machine layering via the cwd→home
walk makes sense for models and commands); the workflow file has no layering —
one repo, one machine. Absent `gtd.workflow.yaml`, the shipped default
definition applies, which is byte-for-byte the current v2 behavior.

Top-level keys of the workflow file:

| Key           | Contents                                                         |
| ------------- | ---------------------------------------------------------------- |
| `actors`      | the turn-taking universe (fixed: `human`, `agent`)               |
| `commands`    | named shell commands `run-check` edges may reference             |
| `params`      | typed scalar parameters guards may reference (defaults + bounds) |
| `artifacts`   | steering-file declarations (§3.2)                                |
| `commitFlags` | named commit predicates (§3.3)                                   |
| `counters`    | fold rules over commit flags (§3.3)                              |
| `guards`      | named, reusable guard expressions (§3.4)                         |
| `states`      | the state declarations (this appendix)                           |
| `interrupts`  | ordered steering-file precedence rules (§3.6a)                   |
| `onTurn`      | HEAD-classification rules for turn commits (§3.6b)               |
| `onRouting`   | HEAD-classification rules for routing commits (§3.6b)            |
| `fallback`    | ordered boundary-HEAD ladder (§3.6c)                             |
| `entry`       | dirty-boundary entry-gate selection (§3.6)                       |

Note what is **not** under `states`: transitions. Edges live in the four rule
families, because resolution is history-replay — a state declaration describes
what a rest _is_ (who's awaited, what prompt renders, what an empty turn means),
while the rule families describe how HEAD + facts _select_ one.

### A.2 State property reference

```yaml
states:
  <name>:
    kind: prompt | label
    awaits: human | agent | dynamic
    gate: <turn-gate label>
    prompts: { agent: <path>, human: <path> }
    model: <model-state name>
    emptyAgentTurn: inert | signal | { inertWhen: <guard> } | { signal: true, inertWhen: <guard> }
    validateAgentTurn: <validator name>
    checkoutWindow: <bool>
    checkpoint: <bool>
    stepAction: { human: <action>, agent: <action> }
```

| Property            | Applies to             | Meaning / allowed values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`              | all                    | `prompt` — a real rest: `gtd next` renders a prompt, an actor is awaited. `label` — a name that only appears as the `state:` on chain (mid-chain) rules, for `gtd status`/`--json` display; never rests, never prompts. Replaces today's `PROMPT_STATES` complement (testing, planning, close-package, done, health-check, learning-applied).                                                                                                                                                                                                                                                   |
| `awaits`            | `kind: prompt`         | Which actor's `step` is accepted at this rest. `dynamic` — the awaited actor is decided per-rest by the matching rule (`rest: { state, awaits }`), for the states that alternate (grilling/architecting: agent iterates, human answers). Any other invoker is refused. Source of today's `awaitedActor`.                                                                                                                                                                                                                                                                                        |
| `gate`              | `kind: prompt`         | The `<gate>` label the captured turn commit carries (`gtd(<actor>): <gate>`). Defaults to the state name. Overrides exist for states that _share_ a gate with another state — `await-review` captures under `review`, `await-learning-review` under `learning`. Replaces `STATE_IS_OWN_GATE` + `GATE_OVERRIDES`. Compiler checks the generated grammar for collisions.                                                                                                                                                                                                                          |
| `prompts`           | `kind: prompt`         | Template path per awaitable actor. A state with `awaits: dynamic` must bind both; others exactly one. Templates get the documented view-model (`context`, `model`, `fenceFor`, shared partials). Replaces `STATE_TEMPLATE` + the grilling/architecting actor split in `buildPrompt`.                                                                                                                                                                                                                                                                                                            |
| `model`             | agent-prompting states | Which model-resolution name `{{MODEL}}` resolves against (today's `ModelState`: `grilling`, `architecting`, `decompose`, `building`, `fixing`, `agentic-review`, `clean` — themselves config: each names a tier, overridable per state in `.gtdrc` exactly as now). Human-awaited states carry none. Replaces `MODEL_STATE`.                                                                                                                                                                                                                                                                    |
| `emptyAgentTurn`    | agent-awaited rests    | What a clean-tree `gtd step-agent` means here. `inert` — no-op, zero commits, `gtd next` re-emits (the `INERT_EMPTY_AGENT_GATES` set). `signal` — the empty turn is captured and means something (health-fixing's environmental fix). `inertWhen: <guard>` — conditional (squashing/learning while the template is unmodified; health-fixing while HEAD is the human's entry turn). The compiler wires this into BOTH layers (capture guard and historical-HEAD classification), which today must be kept in sync by hand. **Mandatory** for every agent-awaited rest — the author must decide. |
| `validateAgentTurn` | agent-awaited rests    | Named structural validator run before capturing the agent's turn; malformed → refusal with the error list, zero commits (today: `open-questions` on grilling/architecting, `review-doc` on review). Never applied to human turns.                                                                                                                                                                                                                                                                                                                                                               |
| `checkoutWindow`    | human-awaited rests    | Hold the review checkout window open while this rest is pending (HEAD/index rewound to the review base so editors surface the diff). Program-edge wiring only; the resolver never sees it. Today: hardcoded to `await-review`.                                                                                                                                                                                                                                                                                                                                                                  |
| `checkpoint`        | agent-awaited rests    | This state's turn commit is an operational-recovery resume point: a boundary commit landing on top of it (config fix after a mid-chain crash) re-resolves to this state's continuation instead of hard-erroring. Today: hardcoded to `building`.                                                                                                                                                                                                                                                                                                                                                |
| `stepAction`        | `kind: prompt`         | Escape hatch for the rests where an actor's `step` performs an action _instead of_ capturing a turn. Today's only case: `idle.stepAction.human = run-check` (a human step at idle re-runs the health check, never authoring an empty turn). Kept deliberately rare — most behavior belongs in `onTurn` rules.                                                                                                                                                                                                                                                                                   |

What is deliberately **not** a state property: the awaited-human-empty-turn
meaning (an empty human turn is always captured — whether it means "accept
defaults", "approve", or "resume" is decided by the `onTurn` branch that
classifies the captured commit); transitions; and anything that would let a
state execute arbitrary code.

### A.3 The default machine, all 21 states

```yaml
states:
  # ── grilling: product plan ─────────────────────────────────────────────
  grilling:
    kind: prompt
    awaits: dynamic # agent iterates .gtd/TODO.md; human answers open questions
    prompts:
      agent: prompts/grilling-agent.md
      human: prompts/grilling-answers.md
    model: grilling # planning tier
    emptyAgentTurn: inert
    validateAgentTurn: open-questions

  # ── architecting: technical plan ───────────────────────────────────────
  architecting:
    kind: prompt
    awaits: dynamic
    prompts:
      agent: prompts/architecting-agent.md
      human: prompts/architecting-answers.md
    model: architecting
    emptyAgentTurn: inert
    validateAgentTurn: open-questions

  # ── grilled: decompose into packages ───────────────────────────────────
  grilled:
    kind: prompt
    awaits: agent # the human's grilled turn exists only as the PLAN.md entry (entry rules)
    prompts: { agent: prompts/decompose.md }
    model: decompose
    emptyAgentTurn: inert # no packages written → re-emit; never consume ARCHITECTURE.md

  # ── build lifecycle ────────────────────────────────────────────────────
  planning: { kind: label } # transient: packages present + .gtd/ modified (promptless today)
  building:
    kind: prompt
    awaits: agent
    prompts: { agent: prompts/building.md }
    model: building # execution tier
    emptyAgentTurn: inert
    checkpoint: true # boundary commit atop the building turn resumes the test chain
  testing: { kind: label } # the run-check hop
  fixing:
    kind: prompt
    awaits: agent
    prompts: { agent: prompts/fixing.md }
    model: fixing
    emptyAgentTurn: inert
  escalate:
    kind: prompt
    awaits: human # deleting .gtd/ERRORS.md is the move; onTurn rule chains a fresh run-check
    prompts: { human: prompts/escalate.md }

  # ── per-package review ─────────────────────────────────────────────────
  agentic-review:
    kind: prompt
    awaits: agent # writes .gtd/FEEDBACK.md; empty file = approval (artifact probe)
    prompts: { agent: prompts/agentic-review.md }
    model: agentic-review
    emptyAgentTurn: inert # no FEEDBACK.md written at all is NOT an approval
  close-package: { kind: label }

  # ── cycle-end human review ─────────────────────────────────────────────
  review:
    kind: prompt
    awaits: agent # writes .gtd/REVIEW.md
    prompts: { agent: prompts/review.md }
    model: clean
    emptyAgentTurn: inert
    validateAgentTurn: review-doc
  await-review:
    kind: prompt
    awaits: human
    gate: review # human turn is captured under the shared "review" gate
    prompts: { human: prompts/await-review.md }
    checkoutWindow: true
  done: { kind: label }

  # ── learning ───────────────────────────────────────────────────────────
  learning:
    kind: prompt
    awaits: agent
    prompts: { agent: prompts/learning.md }
    model: clean
    emptyAgentTurn: { inertWhen: learnings.isTemplate }
  await-learning-review:
    kind: prompt
    awaits: human # empty turn = accept draft; there is no reject path (onTurn rule)
    gate: learning
    prompts: { human: prompts/await-learning-review.md }
  learning-apply:
    kind: prompt
    awaits: agent
    prompts: { agent: prompts/learning-apply.md }
    model: clean
    emptyAgentTurn: inert # a doc-edit move: clean tree = nothing to apply yet
  learning-applied: { kind: label }

  # ── squash ─────────────────────────────────────────────────────────────
  squashing:
    kind: prompt
    awaits: agent
    prompts: { agent: prompts/squashing.md }
    model: clean
    emptyAgentTurn: { inertWhen: squashMsg.isTemplate } # never squash the placeholder

  # ── idle / health ──────────────────────────────────────────────────────
  idle:
    kind: prompt
    awaits: human
    prompts: { human: prompts/idle.md }
    stepAction: # human step at idle re-runs the health check, never an empty turn
      human:
        run-check:
          command: test
          green: { stop: true, chainWhen: { fact: healthFixBasePresent } }
          red:
            write: health
            cap: { counter: healthFix, param: fixAttemptCap, write: errors }
            route: health-check
  health-check: { kind: label }
  health-fixing:
    kind: prompt
    awaits: agent # also the HEALTH.md entry gate for a human (entry rules)
    prompts: { agent: prompts/health-fixing.md }
    model: fixing
    emptyAgentTurn: # empty agent turn = environmental fix (remove HEALTH.md, re-test)…
      signal: true
      inertWhen: { head.isTurn: [human, health-fixing] } # …unless the human's entry turn is still unread
```

Reading the table against today's code: `kind` reproduces
`PROMPT_STATES`/`isPromptState`; `awaits` reproduces `awaitedActor` plus the
dynamic grilling/architecting split; `gate` reproduces `gateForState`;
`prompts` + `model` reproduce `STATE_TEMPLATE` + `MODEL_STATE`; `emptyAgentTurn`
reproduces `INERT_EMPTY_AGENT_GATES` + `isInertEmptyAgentRest`'s conditional
cases; `validateAgentTurn` reproduces the two structural-validation refusals in
`applyTurnTaking`; `checkpoint` reproduces the operational-recovery rung;
`stepAction` reproduces the idle health-check carve-out. Every hardcoded
per-state fact in the engine has exactly one home in the declaration — which is
the test the schema was designed against.
