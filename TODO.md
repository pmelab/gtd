# Explorative Phase Between Seed and Planning

## Action Items

### CommitPrefix: Add EXPLORE

- [x] Add `EXPLORE` prefix (🧭) to `CommitPrefix.ts` with name, emoji, and
      parsing support

  - Add to the prefix map alongside SEED, HUMAN, PLAN, etc.
  - Tests: parse round-trip —
    `parseCommitPrefix(formatCommitPrefix(EXPLORE, "msg"))` returns `EXPLORE`

- [x] Update `DecisionTree.ts` display labels to include EXPLORE
  - Add a human-readable label for the new prefix in `formatDecisionTrace`
  - Tests: `formatDecisionTrace` with `lastCommitPrefix=EXPLORE` renders without
    "unknown prefix" fallback

### InferStep: Transition Logic

- [ ] Extend `InferStepInput` with
      `prevNonHumanPrefix: CommitPrefix | undefined`

  - Walk git log from HEAD skipping HUMAN commits until a non-HUMAN commit is
    found
  - Tests: `prevNonHumanPrefix` resolves to EXPLORE when log is
    `EXPLORE → HUMAN → HUMAN`

- [ ] Update `inferStep` with explore transitions:
  - `lastCommitPrefix === SEED` → `"explore"`
  - `lastCommitPrefix === EXPLORE` → `"plan"`
  - `lastCommitPrefix === HUMAN && prevNonHumanPrefix === EXPLORE` → `"explore"`
  - All other HUMAN/FEEDBACK cases remain `"plan"` (backwards compatible)
  - Tests: unit-test each new branch in isolation; confirm existing HUMAN→plan
    and FEEDBACK→plan cases still pass

### State Gathering: prevNonHumanPrefix

- [ ] In `gatherState()` in `cli.ts`, resolve `prevNonHumanPrefix` via git log
      walk and pass it into `InferStepInput`
  - Use `git log --format=%s` and iterate until a non-HUMAN prefix is found (max
    20 commits as guard)
  - Tests: integration test where git history has HUMAN commits after EXPLORE —
    `gatherState` returns correct `prevNonHumanPrefix`

### Explore Command

- [ ] Create `src/commands/explore.ts` implementing the explore phase

  - Read current TODO.md (the seed idea)
  - Invoke agent in `mode="explore"` with the explore prompt
  - Write agent response back to TODO.md (replace content — agent owns the
    output format)
  - Atomic commit with EXPLORE prefix
  - Tests: mock agent returns options text; assert TODO.md updated and commit
    message has EXPLORE emoji

- [ ] Add explore prompt at `src/prompts/explore.md`

  - Instruct agent to analyze the seed, propose 2–4 distinct approaches with
    tradeoffs
  - Instruct agent to perform web research on how to solve the task before
    proposing approaches — research results should inform the options presented
  - When re-exploring (EXPLORE→HUMAN→EXPLORE), pass both the current TODO.md
    content and the git diff of the user's edits so the agent sees annotations
  - Output is free-form markdown (no required section structure) so the user can
    annotate it before the next run
  - Tests: prompt template renders without placeholder errors given minimal seed
    content; re-explore variant includes diff in rendered prompt

- [ ] Wire `"explore"` step in `runStep()` in `cli.ts` and `dispatch()` /
      `printBanner()`
  - Add `explore` case alongside `plan`, `build`, `learn`, `cleanup`
  - Tests: E2E scenario `seed → explore → (user edits TODO.md) → explore → plan`
    reaches plan on the third invocation

### Config: modelExplore

- [ ] Add optional `modelExplore` field to `GtdConfig` and `AgentInvocation`
      `mode` union
  - Follow the same pattern as `modelPlan`, `modelBuild`, etc.
  - Update JSON schema / config defaults
  - Tests: config with `modelExplore: "claude-opus-4-5"` resolves correct model
    in `AgentService.invoke` when mode is `"explore"`
