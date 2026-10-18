# 03 — `afterTail` naive feedback lap

## Requirement

**Concern 4.** On the naive path (`flag_naive_pass === "1"`), review feedback
reached through `afterTail` re-plans **design → implement → feature review,
never the seam**. Without the flag, `afterTail` re-plans through `planAndBuild`
as today. `afterTail` opens no slice — its caller's tail ran outside one, and
slices cannot nest.

See `.gtd/ARCHITECTURE.md` — `afterTail`, call stack 4.

## Tasks

### 1. Extract `featureFeedback`

Paths: `src/workflows/feature/feature.ts`

- [ ] Internal `featureFeedback(outcome, lensBase?)` holds the loop now inlined
      in `naivePlanAndBuild`: re-unwind, `design(outcome.base)`, record the risk
      tier, `implement(undefined, tier)`,
      `buildTail(false, outcome.base, true, …)`, until sign-off
- [ ] `naivePlanAndBuild` calls it after its first tail; existing naive unit
      tests stay green (`lensBase` accepted, threaded in package 04)

### 2. `afterTail` branches on the flag

Paths: `src/workflows/feature/feature.ts`,
`src/workflows/feature/feature.test.ts`

- [ ] `afterTail` signature unchanged; calls `featureFeedback(outcome)` when
      `vars.flag_naive_pass === "1"`, else `reUnwind` →
      `planAndBuild(outcome.base)`
- [ ] Opens no `feature` slice
- [ ] Unit: `flag_naive_pass=1` feedback rests at `design.triage`, then
      `implement.building`, reaches no `seam.*` step
- [ ] Unit: `flag_naive_pass=0` feedback runs `architecture.*` and `packages.*`
      as today

### 3. Scenario

Paths: `tests/integration/features/workflow-module-reuse.feature`

- [ ] Custom workflow ending in `afterTail` with `GTD_FLAG_NAIVE_PASS=1`:
      feedback rests at `design.triage`, then `implement.building`; no commit
      subject names `seam.naive` or `seam.judge`

### 4. Docs

Paths: `docs/configuration.md`

- [ ] Naive-pass section says `afterTail`'s feedback lap is design → implement,
      never the seam

## Tests

- unit: `src/workflows/feature/feature.test.ts`
- e2e: `tests/integration/features/workflow-module-reuse.feature`
