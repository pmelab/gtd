---
status: grilling
---

# Follow-up: inject test command into prompts + config cleanups

Feedback from the review of the config system (base `32a006f`).

## Open Questions

### Item 1 — How should `{{TEST_COMMAND}}` be threaded into `buildPrompt`, and which prompts get it?

**Recommendation:** Thread the resolved test command as a fourth parameter to
`buildPrompt`, mirroring `resolveModel`, and substitute it for **all** leaves
(not gated behind `MODEL_STATES` like `{{MODEL}}`):

- Signature:
  ```ts
  export const buildPrompt = (
    result: ResolveResult,
    override?: PromptOverride,
    resolveModel: (state: ModelState) => string = builtinResolveModel,
    testCommand: string = DEFAULT_TEST_COMMAND, // re-exported from Config.ts
  ): string => { ... }
  ```
- Substitution: after section selection, do
  `section.replaceAll("{{TEST_COMMAND}}", testCommand)` unconditionally (the
  `{{MODEL}}` substitution is gated by `MODEL_STATES` because only those 5
  sections contain `{{MODEL}}`; `{{TEST_COMMAND}}` appears in a _different_ set
  of sections, none of which are model-states, so it needs its own unconditional
  pass). `replaceAll` on a section with no placeholder is a cheap no-op, so a
  single unconditional pass over the chosen section is safe.
- `main.ts` already holds `config` — pass `config.testCommand` as the 4th arg at
  both `buildPrompt` call sites (lines 41 and 46).

**Which prompts get the injection (an AGENT runs tests there):**

- `src/prompts/execute-simple.md` — Step 2 testing-subagent (agent runs tests).
- `src/prompts/close-review.md` — "Test gate (run first)" (agent runs tests).
- `src/prompts/verified.md` — "Test gate (run first)" / step 1 (agent runs
  tests).
- `src/prompts/escalate.md` — step 1 "Re-run the test suite" (agent runs tests).

**Which prompts do NOT get it:**

- `human-review`, `execute` — the **edge** runs `testCommand` deterministically
  (`main.ts` `TEST_GATED_LEAVES`); the agent never invokes it, so no
  placeholder.
- `new-todo.md` / `modified-todo.md` — their "Test gate (run first)" prose
  currently points at "AGENTS.md / package.json / Makefile", **not** `.gtdrc`,
  so they were untouched by package 04. **Sub-question:** these are _also_
  agent-run test gates — should they get `{{TEST_COMMAND}}` too for consistency,
  or stay as generic "determine from AGENTS.md"? Recommendation: inject into
  them as well, since an agent runs tests there and the whole point is to stop
  telling agents to discover the command. This is a small additive change, not a
  revert.

**Open decision for you:** (a) confirm the 4-prompt revert set is right; (b)
confirm whether to _also_ inject into `new-todo`/`modified-todo` (recommend
yes); (c) confirm the placeholder name `{{TEST_COMMAND}}`.

<!-- user answers here -->

### Item 2 — Keep the hand-rolled `deepMerge`/`walkUp`, or drop it for a cosmiconfig-native approach?

**Recommendation:** **Keep the custom walk+merge.** Confirmed against
cosmiconfig v9.0.2: `search()` stops at the **first** config found and never
merges across levels. v9's only merge mechanism is the explicit `$import` key
(one file importing another as a base) — that requires the _user_ to wire up
imports in their config files, which cannot satisfy the implicit cwd→home
auto-merge with innermost-wins semantics that gtd needs and that
`Config.test.ts` asserts (ancestor sets `testCommand` + `planning`, child
overrides only `testCommand`, both survive merged — line 53-66). Dropping
`deepMerge` and relying on `$import` would (1) break the existing multi-level
merge tests, (2) force users to hand-author import chains, (3) lose the
automatic home-dir global config layer.

The `!!` explicitly accepts "even if it does not 100% meet the requirements,"
but here the loss is not cosmetic — it removes the core feature (transparent
layered config). Recommend we **document the finding and keep
`deepMerge`+`walkUp`**, and resolve the `!!` by deleting the `!!` comment (and
adding a short code comment explaining cosmiconfig has no native auto-merge, so
the walk+merge is intentional).

**Open decision for you:** accept "keep custom merge + document why"
(recommended), or do you still want the cosmiconfig-`$import`-only approach
despite losing implicit layering?

<!-- user answers here -->

### Item 3 — Collapse `new-todo` + `modified-todo` into one `grilling` model key, or leave as-is?

**Recommendation:** This is an `!!` _observation_, so default to **leave the
state machine alone but narrow the config surface**. The two are genuinely
distinct _states_ (different prompts, different machine guards `todoInitial` vs
`todoRegrill`, targets `new-todo`/`modified-todo` in `Machine.ts:238-244`) and
both are auto-advance finals — collapsing the **states** would be a large, risky
refactor touching the union, machine, prompts, and many tests for no behavioural
gain.

The _real_ redundancy the `!!` points at is in the **per-state model override
surface**: both map to the `planning` tier (`stateTier`), so exposing separate
`models.states["new-todo"]` and `models.states["modified-todo"]` keys lets a
user set two different models for what is conceptually one "grilling" step. Two
viable options:

- **Option A (minimal, recommended): do nothing in code, just resolve the
  `!!`.** The per-state keys are _optional overrides_; a user who wants one
  model for grilling sets `models.planning` and never touches the state keys.
  The extra granularity is harmless and already documented. Delete the `!!`
  comment.
- **Option B (collapse the config key): introduce a single `grilling` key** that
  overrides both `new-todo` and `modified-todo`. This does NOT touch the state
  machine — only the _config resolution layer_. Sites that change:
  `ModelStatesSchema` (replace the two keys with `grilling`), `resolveModel`'s
  state-override lookup (map both states to the `grilling` key), README config
  docs (line 146-147), SKILL.md (line 56), and `Config.test.ts`. `ModelState`
  union, `stateTier`, `MODEL_STATES`, the prompt files, and `Machine.ts` stay
  unchanged. Cost: the schema key no longer 1:1-matches state names, which is a
  small conceptual wrinkle.

**Open decision for you:** Option A (leave config granular, just clear the `!!`)
or Option B (add a `grilling` override key collapsing the two)? Recommend A
unless you actively dislike the redundant per-state keys.

<!-- user answers here -->

## Plan

### Item 1 — Inject the resolved `testCommand` into prompts

Package 04 added prose telling agents the `.gtdrc` `testCommand` "takes
precedence". Replace that with direct injection of the concrete command, exactly
like the `{{MODEL}}` injection from package 03.

**`src/Prompt.ts` changes:**

- Import `DEFAULT_TEST_COMMAND` from `Config.ts` (currently not exported — add
  the `export` there, or re-declare the literal; prefer exporting to keep a
  single source of truth).
- Add a 4th param `testCommand: string = DEFAULT_TEST_COMMAND` to `buildPrompt`.
- After the existing `{{MODEL}}` substitution, run an **unconditional**
  `section.replaceAll("{{TEST_COMMAND}}", testCommand)` on the selected section
  (and on the `fix-tests` branch's `fixTests` section if it ever references the
  command — verify; it currently does not, so likely no change there).

**`src/Config.ts` change:**

- `export const DEFAULT_TEST_COMMAND = "npm run test"` (currently
  module-private).

**`src/main.ts` changes:**

- Pass `config.testCommand` as the 4th arg at both `buildPrompt` call sites
  (lines 41, 46).

**Prompt edits — replace the ".gtdrc testCommand takes precedence" prose with
the injected `` `{{TEST_COMMAND}}` `` command:**

- `src/prompts/execute-simple.md` — Step 2 bullet 1 ("Determine the test
  command. The `.gtdrc` `testCommand` config takes precedence…") → "Run
  `` `{{TEST_COMMAND}}` ``." (keep the retry/analyze-failures wording).
- `src/prompts/close-review.md` — "Test gate (run first)" para: replace the
  ".gtdrc testCommand takes precedence; otherwise determine from AGENTS.md…"
  sentence with "run `` `{{TEST_COMMAND}}` ``".
- `src/prompts/verified.md` — same test-gate para; also the step-1 "Run tests,
  typecheck, lint" stays, but the discovery sentence becomes "run
  `` `{{TEST_COMMAND}}` ``".
- `src/prompts/escalate.md` — step 1 "Re-run the test suite. The `.gtdrc`…" →
  "Re-run `` `{{TEST_COMMAND}}` `` so the human sees the current failure."

**Pending sub-question (see Open Q item 1b):** also inject into `new-todo.md` /
`modified-todo.md` test-gate paras (currently "determine from AGENTS.md /
package.json / Makefile") for consistency.

### Item 2 — cosmiconfig native merge research

Outcome (pending Open Q item 2): keep `deepMerge` + `walkUp` + `loadMerged`.
Action items if "keep" is confirmed:

- Delete the `!!` comment in `src/Config.ts` (on the `deepMerge` helper).
- Add a one-line comment noting cosmiconfig v9 has no native cross-level
  auto-merge (only explicit `$import`), so the manual walk+merge is intentional.

### Item 3 — `new-todo`/`modified-todo` both grilling

Pending Open Q item 3. If Option A: delete the `!!` comment on `ModelState` in
`src/Config.ts`, no code change. If Option B: see the enumerated sites in the
Open Question (schema key, `resolveModel`, README, SKILL.md, tests).

### Testing

Per AGENTS.md, add cucumber.js scenarios for the new behaviour and extend
`Prompt.test.ts`:

- `buildPrompt` substitutes `{{TEST_COMMAND}}` with the passed command for each
  affected leaf (`close-review`, `verified`, `escalate`, `execute-simple`).
- No affected prompt still contains the literal string `.gtdrc` / "takes
  precedence".
- `human-review` / `execute` prompts contain **no** `{{TEST_COMMAND}}` (edge
  runs it).
- Default param: `buildPrompt` called without the 4th arg falls back to
  `npm run test`.

### Docs (per global CLAUDE.md: reflect significant changes in README)

- README §config and SKILL.md: clarify that agent-run test gates now print the
  resolved command directly (no "read .gtdrc" instruction). Update item-3 docs
  only if Option B is chosen.

## Resolved
