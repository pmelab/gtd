# Implementation plan: full δ(label, diff)

> **Status (updated during implementation):**
>
> - **Phase 0+A — LANDED.** Phase 0's table review surfaced a major
>   simplification the plan's draft table over-engineered: the actor is already
>   part of every turn label (`gtd(human): X` ≠ `gtd(agent): X`), so only labels
>   whose OWN diff disambiguated their meaning needed splitting — six new labels
>   (`grilling-accepted`, `architecting-accepted`, `review-approved`,
>   `review-feedback`, `agentic-approved`, `agentic-findings`) instead of the
>   drafted ~30-state redraw. Turn capture is rule-driven (`captureRules` per
>   state), inert-by-default with opt-in `empty` rules, the fixpoint is a label
>   fact, `headTurnIsEmpty` / `headTurnReviewSubstantive` are deleted, and the
>   FEEDBACK.md interrupt dissolved into the verdict labels (a fallback rung
>   keeps rider/crash recovery).
> - **Phase B — LANDED.** Template probes are pending-diff matchers
>   (`squashMsgDirty` / `learningMsgDirty`); content inspection is down to
>   FEEDBACK.md emptiness and REVIEW.md checkbox-only, both consumed at capture.
>   The effects-as-diffs invariant holds structurally (every `perform()` arm
>   ends in a commit or a stop).
> - **Phase C1 — LANDED.** `gtd: escalated`: a red check at the cap writes
>   ERRORS.md and labels the escalation at write time (runTest AND
>   runHealthCheck). `gtd: test-failed`/`gtd: health-check` classify
>   unconditionally, the ERRORS interrupt dissolved (fallback recovery rung
>   kept), `ClassifyFlags.errorsPresent` and the at-cap health carve-out are
>   deleted.
> - **Phase C2 — REMAINING (mapped).** Green outcome at write time: `runTest`
>   gains `onGreen: "tests-green" | "agentic-review" | "close-package"`,
>   computed in the fill-in from `packagesPresent` + `forceApprove` (dispatch
>   already has both; apply the fill to the fallback-recovery `runTest` too).
>   Force path performs the close INLINE (one `gtd: close-package` commit —
>   sequences shrink by the green marker). New machine label
>   `gtd: agentic-review` (routing rule: rest agentic-review/agent);
>   `tests-green` becomes health-path-only, its routing rule settle-only. NOTE:
>   `isTestsGreenCheckpoint` in `src/program.ts` (the step-agent loop's
>   stop-at-checkpoint guard) keys on `headThisHop === "gtd: tests-green"` — it
>   must key on the new agentic-review label. E2e: 32 `gtd: tests-green`
>   literals across 14 feature files — package-context ones become
>   `gtd: agentic-review`, health-context ones stay, force-path sequence rows
>   are removed.
> - **Phase C3 — REMAINING.** Counter trailers
>   (`Gtd-Counters: t=n/cap r=n/cap h=n/cap` computed from the previous label's
>   trailer), then `foldCounters` and the `CommitEvent` flags are deleted; caps
>   and force-approve read the trailer at dispatch. Do after C2 (force-approve's
>   dispatch move is a prerequisite).
> - **Phase D — REMAINING.** The δ conformance property test lands once C3
>   removes the history fold from resolution: permute everything except the
>   nearest label (+trailers) and the pending diff; assert identical output.

> Companion to `configurable-state-machine.md` Appendix C. Decisions taken:
> **full purity** (all five moves, including counters and config at write time),
> **keep the corruption refusal** (steering files + no label → hard error),
> **split states are the public vocabulary** (labels, `gtd status`, `--json`,
> docs), **phased rollout** with every phase landing green.
>
> Target invariant, stated once: at every resolution,
> `next = δ(nearest label (incl. its trailers), pending diff)` — the invoker
> authenticates but adds no information; counters, config outcomes, and branch
> decisions are baked into labels at write time; the external world enters only
> through diffs; exactly two sanctioned impurities remain (the boundary-skip
> walk and the corruption refusal).

## 1. The target machine (draft label/state table)

States have exactly ONE awaited actor (rest) or ONE machine act —
`awaits: "dynamic"` is abolished. Labels are the transitions; `stateOf(label)`
is a total map. Names are draft — Phase 0 finalizes them.

### Entry (from `start` = no labeled commit reachable)

| From state | Diff matcher (invoker: human) | Label written                    | Enters state         |
| ---------- | ----------------------------- | -------------------------------- | -------------------- |
| start      | adds `.gtd/HEALTH.md`         | `gtd(human): health-entry`       | health-briefed       |
| start      | adds `.gtd/PLAN.md`           | `gtd(human): plan-entry`         | seed-from-plan (act) |
| start      | adds `.gtd/ARCHITECTURE.md`   | `gtd(human): architecting-entry` | architecting-draft   |
| start      | anything else (dirty)         | `gtd(human): grilling-entry`     | grilling-draft       |

`start` with steering files present but NO reachable label → **corruption
refusal** (the one retained guess-refusal; supersedes today's illegal-
combination table for the no-label case).

### Grilling / architecting (the dynamic-gate split)

| From state (awaits)     | Diff matcher                | Label                           | Enters               |
| ----------------------- | --------------------------- | ------------------------------- | -------------------- |
| grilling-draft (agent)  | touches TODO.md (validated) | `gtd(agent): grilling-draft`    | grilling-answer      |
| grilling-answer (human) | non-empty                   | `gtd(human): grilling-answered` | grilling-draft       |
| grilling-answer (human) | **empty**                   | `gtd(human): grilling-accepted` | seed-from-todo (act) |
| seed-from-todo (act)    | writes ARCH, deletes TODO   | `gtd: architecting`             | architecting-draft   |

Architecting mirrors it (`architecting-draft/-answered/-accepted`, accepted →
`gtd: grilled` → decompose). The empty-turn _meaning_ is now a declared
diff-matcher rule (`empty`), not a classification of HEAD's past diff —
`headTurnIsEmpty` and `headTurnReviewSubstantive` are deleted from
`ResolvePayload`.

### Build / test / fix loop (counters ride labels — see §2)

| From state         | Trigger                        | Label                           | Enters             |
| ------------------ | ------------------------------ | ------------------------------- | ------------------ |
| decompose (agent)  | adds package dirs              | `gtd(agent): decomposed`        | consume-arch (act) |
| consume-arch (act) | removes ARCH                   | `gtd: building`                 | building           |
| building (agent)   | code diff                      | `gtd(agent): building`          | testing (act)      |
| testing (act)      | red below cap, writes FEEDBACK | `gtd: test-failed` + trailers   | fixing             |
| testing (act)      | red at cap, writes ERRORS      | `gtd: escalated`                | escalate           |
| testing (act)      | green, pkgs, threshold reached | `gtd: close-package`            | close-pkg (act)    |
| testing (act)      | green, pkgs                    | `gtd: agentic-review`           | agentic-review     |
| testing (act)      | green, no pkgs (health rerun)  | settle label (§ settle)         | —                  |
| fixing (agent)     | any diff                       | `gtd(agent): fixing` + trailers | testing (act)      |
| escalate (human)   | deletes ERRORS.md              | `gtd(human): escalate-resumed`  | testing (act)      |

`gtd: tests-green` and `gtd: test-failed`'s read-time branches are gone: **the
check decides and labels** (write-time config + counters). The force-approve
guard moves from `routingRules["tests-green"]` into the `runTest` act.

### Agentic review (emptiness read from the DIFF)

| From state             | Diff matcher                   | Label                          | Enters          |
| ---------------------- | ------------------------------ | ------------------------------ | --------------- |
| agentic-review (agent) | adds FEEDBACK, zero content    | `gtd(agent): agentic-approved` | close-pkg (act) |
| agentic-review (agent) | adds FEEDBACK, non-empty       | `gtd(agent): agentic-findings` | fixing          |
| close-pkg (act)        | rm pkg+FEEDBACK; pkgs remain   | `gtd: building`                | building        |
| close-pkg (act)        | none remain, reviewable        | `gtd: review-record`           | review-record   |
| close-pkg (act)        | none remain, nothing to review | settle label                   | —               |

The delete-dispute (`pendingFeedbackDeletion`) becomes a matcher row on the
fixing state (deletes/empties FEEDBACK → still a fixing turn), not a payload
special case.

### Human review, learning, squash, health, idle

| From state             | Trigger                              | Label                                                                     | Enters                |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------------------- | --------------------- |
| review-record (agent)  | adds REVIEW.md (validated)           | `gtd(agent): review-record`                                               | await-review (window) |
| await-review (human)   | empty / checkbox-only / deletes R    | `gtd(human): review-approved`                                             | cycle-close (act)     |
| await-review (human)   | anything else                        | `gtd(human): review-feedback`                                             | regrill (act)         |
| cycle-close (act)      | rm REVIEW                            | `gtd: done`                                                               | settle                |
| regrill (act)          | rm REVIEW                            | `gtd: grilling`                                                           | grilling-draft        |
| settle (act)           | learning on + base                   | `gtd: learning` (writes template)                                         | learning-draft        |
| settle (act)           | squash on + base                     | `gtd: squashing` (writes template)                                        | squash-draft          |
| settle (act)           | neither                              | `gtd: idle`                                                               | idle                  |
| learning-draft (agent) | **touches LEARNINGS.md**             | `gtd(agent): learning-draft`                                              | learning-review       |
| squash-draft (agent)   | **touches SQUASH_MSG.md**            | `gtd(agent): squash-draft`                                                | do-squash (act)       |
| idle (human)           | step (clean) → act runs health check | red: `gtd: health-fixing` / cap: `gtd: escalated` / green: stop or settle | …                     |
| health-briefed (agent) | any NON-empty diff                   | `gtd(agent): health-fixed`                                                | testing (act)         |
| health-fixing (agent)  | any diff **or empty**                | `gtd(agent): health-fixed`                                                | testing (act)         |

Two dissolutions worth naming: the template-unmodified probe becomes "diff
touches the template file" (a matcher), and health-fixing's
`inertWhen: humanEntryHead` guard becomes two states — `health-briefed` (entered
via the human's entry; no empty-rule, so an empty agent step is inert by
_absence of a rule_) vs `health-fixing` (entered via a red check; empty-rule
present = environmental-fix signal).

## 2. Counters: commit-message trailers, not subject suffixes

Counters must be derivable from the nearest label alone, but a loop's counter
lives across several states (test-failed → fixing → testing), and
`reviewFixCount` spans the whole package loop. Encoding decision:

- Subjects stay clean (`gtd(agent): fixing`).
- Every label written _inside a counted loop_ carries a structured trailer:

  ```
  gtd(agent): fixing

  Gtd-Counters: t=2/3 r=1/3
  ```

- The writer computes each value from the previous label's trailer (+increment /
  reset per the definition's counter rules); a label with no trailer means
  all-zero (loop entry). `δ` reads label = (subject, trailers).
- `foldCounters` is deleted; caps are checked at act time from the trailer.

Why trailers: subjects remain human-scannable and e2e-assertable; trailers are
already precedent (`Gtd-Decisions`); `git log --format=%B` is already fetched
(decisionLog reuses it — no new subprocess); and squash collapses them away at
cycle end. Wire-format cost acknowledged: changing a budget's _semantics_
becomes a history-compat concern (mitigated: values are `n/cap` so the cap
travels with the count; a config cap change affects only future writes).

## 3. What gets deleted (the payoff)

| Deleted                                                                                                                                                | Replaced by                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| interrupt ladder + fallback ladder                                                                                                                     | `stateOf(label)` + per-state matcher rules; ONE retained refusal           |
| `classifyHead` turn/routing branch rules                                                                                                               | total `stateOf` map (labels are unambiguous)                               |
| `foldCounters` + `CommitEvent` flags (`isErrors`, `isFeedback`, …)                                                                                     | counter trailers                                                           |
| `headTurnIsEmpty`, `headTurnReviewSubstantive`, `pendingFeedbackDeletion`, `squashMsgIsTemplate`, `learningMsgIsTemplate`, `feedbackEmpty` (as guards) | diff matchers at capture time                                              |
| `emptyAgentTurn` policies (`inert`/`inertWhen`)                                                                                                        | inert-by-default: no matching rule = no-op (empty-rules are opt-in)        |
| illegal-combination table (mostly)                                                                                                                     | can't arise: every write commits with its label; kept as capture-time lint |
| `agenticReviewForceApproved` read-time guard, `settle` read-time branches                                                                              | write-time decisions in `runTest`/`closePackage`/`settle` acts             |
| `awaits: "dynamic"`, `GATE_OVERRIDES`-style sharing                                                                                                    | one actor per state                                                        |

`ResolvePayload` shrinks to: invoker, pending-diff facts (per-artifact
touched/added/deleted/empty-add/checkbox-only), steering-file presence (for the
corruption refusal + prompts), config (consumed by ACTS only), and prompt
passthrough (diffs/content for templates — prompts remain impure by design, per
Appendix C §C.4.2).

## 4. Phases

Each phase: full suite green (unit + all 263 e2e scenarios' behavior preserved,
labels/state names mapped), `feat!:` commit, docs synced.

**Phase 0 — Spec (no code).** Finalize the label/state table above as the new
STATES.md §1 (names, matchers, trailer grammar, `stateOf`). Acceptance: a table
review — every current e2e scenario hand-traced onto new labels with no
ambiguity. This is where naming bikesheds happen, deliberately.

**Phase A — State splitting + capture-time turn labels.** (`~21 → ~30` states;
the `dynamic` gates, review approval/feedback, health-briefed split, entry
labels.) Turn capture evaluates diff matchers and writes the decided label;
`stateOf` replaces turn-rule branching; `headTurn*` payload fields deleted.
Machine act labels unchanged in this phase. Biggest e2e churn (every
`gtd(actor): <gate>` assertion), but mechanical per scenario since the exercised
branch is evident from surrounding steps.

**Phase B — Probes → diff matchers + effects-as-diffs invariant.** Template
probes become touch-matchers; feedback emptiness read from the capture diff;
delete-dispute becomes a matcher row. Add the engine invariant (dev/test
assert): every `perform()` must commit a label and/or change files, or return
stop. Mostly internal; small e2e deltas around crash-recovery scenarios (retrace
them explicitly — this is where content-vs-diff divergence lives).

**Phase C — Write-time outcomes + counter trailers.** `tests-green`/
`test-failed` read-time branches move into the acts (labels
`agentic-review`/`close-package`/`escalated`/`test-failed`+trailer);
close-package decides building/review/settle at write time; settle decided at
`done`/green with config in hand; `foldCounters`, commit-event flags, and both
ladders deleted; corruption refusal re-anchored on "steering files present, no
label reachable". Second wire-format break; e2e label updates are
context-dependent this time (a green assertion becomes whichever outcome label
the scenario's context produced) — budget one careful pass.

**Phase D — Conformance + hardening.** (1) The δ property test: generate
histories, then mutate anything _other than_ the nearest label+trailers and the
pending diff (permute older commits, inject boundary commits, vary config where
an act already decided) and assert `resolve` output is byte-identical. This test
IS the purity claim. (2) Compiler checks: `stateOf` total, one actor per state,
every act's outcome set covered, trailer continuity (a counted loop's labels all
carry the vector). (3) STATES.md rewritten as the transition table; upgrading
doc gains the third grammar migration note (old labels → boundary → `start`,
refusal if steering files linger).

## 5. Risks and open items

- **Kill-switch semantics change (accepted):** config flips no longer affect a
  rest already labeled; document loudly in configuration.md.
- **Idle green stop:** a green idle health check commits nothing (today's
  behavior) — fine for δ (no transition happened), but it means `start`/ `idle`
  must be re-derivable cheaply every run; unchanged from today.
- **Review checkout window:** unchanged (program-edge; keyed on the await-review
  state's label).
- **Trailer parsing:** extend `parseSubject` → `parseLabel(subject, body)`; Git
  already returns full messages on the history read — verify no extra subprocess
  creeps in (AGENTS.md decisionLog rule).
- **Squash-base / review-base scans:** remain history reads inside acts and
  prompts (sanctioned impurity); unchanged.
- **Naming risk:** the table above is draft; Phase 0 exists so name changes cost
  a review, not a re-implementation.
- **Rough sizing:** Phase 0 small; A the largest (engine + ~35 feature files); B
  small-medium; C medium with careful e2e mapping; D medium (property test is
  the substance).
