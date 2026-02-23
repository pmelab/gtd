# Explorative Phase Between Seed and Planning

## Action Items

### E2E Tests: Cucumber Coverage

- [ ] Add Cucumber e2e scenario for `EXPLORE` prefix parsing and display

  - Add scenario to `workflow.feature` verifying `🧭` emoji appears in git log
    after an explore step; verify `DecisionTree` banner output includes the
    EXPLORE label
  - Tests: scenario asserts `git log contains "🧭"` and output contains the
    explore banner label

- [ ] Add Cucumber e2e scenario for `inferStep` explore transitions
      (`SEED→explore`, `EXPLORE→plan`, `EXPLORE→HUMAN→explore`)

  - Add `Given a seeded project` setup helper in `project-setup.ts` that commits
    only the 🌱 seed; add `Given an explored project` helper that adds a 🧭
    EXPLORE commit on top
  - Three separate scenarios: (1) after seed → next step is explore, (2) after
    explore → next step is plan, (3) after explore+HUMAN edit → next step is
    explore again
  - Tests: each scenario asserts the correct next step banner in output (e.g.
    "Exploring…") without actually invoking the agent (use `--dry-run` if
    available, or stub agent)

- [ ] Add Cucumber e2e scenario for `prevNonHumanPrefix` resolution via git log

  - Add `setupExploredWithHumanEdits` helper in `project-setup.ts` that builds
    history: 🌱 → 🧭 → 💬 (HUMAN edits TODO.md)
  - Scenario verifies that after the 💬 commit, running gtd infers `explore`
    (not `plan`), proving `prevNonHumanPrefix` correctly skipped the HUMAN
    commit
  - Tests: scenario asserts output step is "Exploring…" / banner contains
    EXPLORE, and git log shows 🧭 as last non-HUMAN prefix

- [ ] Add Cucumber e2e scenario for the explore command (agent invoked, TODO.md
      updated, EXPLORE commit created)

  - Add `setupSeeded` helper (🌱 commit only) and a stubbed/real agent config
    pointing to a lightweight model in CI
  - Scenario: given seeded project → run gtd → assert TODO.md was overwritten
    with agent output, last commit prefix is 🧭
  - Tests: `"TODO.md" contains` some expected explore output;
    `last commit prefix is "🧭"`

- [ ] Add Cucumber e2e scenario for re-explore flow
      (`EXPLORE→HUMAN→EXPLORE→plan`)

  - Add `setupExplored` helper; scenario makes HUMAN edit to TODO.md (append
    blockquote), runs gtd (should re-explore), then runs gtd again (should plan)
  - Tests: after first run `last commit prefix is "🧭"`; after second run
    `last commit prefix is "🤖"`

- [ ] Add Cucumber e2e scenario for `modelExplore` config field resolving
      correct model when mode is `"explore"`
  - Write a `.gtd.json` config with `modelExplore: "claude-haiku-4-5"` into the
    test project; run gtd from seeded state
  - Scenario verifies the agent was invoked with the haiku model (check via
    agent log output or a config-dump flag if available)
  - Tests: scenario asserts output or agent invocation log references the
    configured model name

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

- [x] Extend `InferStepInput` with
      `prevNonHumanPrefix: CommitPrefix | undefined`

  - Walk git log from HEAD skipping HUMAN commits until a non-HUMAN commit is
    found
  - Tests: `prevNonHumanPrefix` resolves to EXPLORE when log is
    `EXPLORE → HUMAN → HUMAN`

- [x] Update `inferStep` with explore transitions:
  - `lastCommitPrefix === SEED` → `"explore"`
  - `lastCommitPrefix === EXPLORE` → `"plan"`
  - `lastCommitPrefix === HUMAN && prevNonHumanPrefix === EXPLORE` → `"explore"`
  - All other HUMAN/FEEDBACK cases remain `"plan"` (backwards compatible)
  - Tests: unit-test each new branch in isolation; confirm existing HUMAN→plan
    and FEEDBACK→plan cases still pass

### State Gathering: prevNonHumanPrefix

- [x] In `gatherState()` in `cli.ts`, resolve `prevNonHumanPrefix` via git log
      walk and pass it into `InferStepInput`
  - Use `git log --format=%s` and iterate until a non-HUMAN prefix is found (max
    20 commits as guard)
  - Tests: integration test where git history has HUMAN commits after EXPLORE —
    `gatherState` returns correct `prevNonHumanPrefix`

### Explore Command

- [x] Create `src/commands/explore.ts` implementing the explore phase

  - Read current TODO.md (the seed idea)
  - Invoke agent in `mode="explore"` with the explore prompt
  - Write agent response back to TODO.md (replace content — agent owns the
    output format)
  - Atomic commit with EXPLORE prefix
  - Tests: mock agent returns options text; assert TODO.md updated and commit
    message has EXPLORE emoji

- [x] Add explore prompt at `src/prompts/explore.md`

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

- [x] Wire `"explore"` step in `runStep()` in `cli.ts` and `dispatch()` /
      `printBanner()`
  - Add `explore` case alongside `plan`, `build`, `learn`, `cleanup`
  - Tests: E2E scenario `seed → explore → (user edits TODO.md) → explore → plan`
    reaches plan on the third invocation

### Config: modelExplore

- [x] Add optional `modelExplore` field to `GtdConfig` and `AgentInvocation`
      `mode` union
  - Follow the same pattern as `modelPlan`, `modelBuild`, etc.
  - Update JSON schema / config defaults
  - Tests: config with `modelExplore: "claude-opus-4-5"` resolves correct model
    in `AgentService.invoke` when mode is `"explore"`
