# Plan: Speed up the cucumber e2e suite via in-memory service layers

## Problem

The e2e suite (`npm run test:e2e`, 126 scenarios / 17 feature files under
`tests/integration/features/`) takes 7m16s serial, 4m30s with `--parallel 4`
(plateaus at 8 workers, ~44% CPU — spawn-bound). The suite grows structurally
(AGENTS.md policy: a cucumber scenario per feature), so per-scenario cost
compounds.

### Measured time distribution (2026-07-03, M-series mac)

Method:
`npx cucumber-js --config tests/integration/cucumber.mjs --format json:/tmp/results.json`,
then sum step durations per scenario/feature.

- 66% (291s of 438s step time) = 161 "When I run gtd" steps, avg 1.8s each:
  - ~0.5s node startup + parse of the 17.6MB `scripts/gtd.bundle.mjs`
  - rest: each gtd run spawns 10–25 git subprocesses (~70–140ms each on
    macOS/APFS) + prettier formatting of steering files
- ~33%: per-scenario setup, mostly `Given a commit ...` steps (~139ms per
  commit)
- Ruled out: fsync (`GIT_TEST_FSYNC=0` measured, no change); Node compile cache
  (no measurable gain)
- Slowest features: journeys 82s (5 scenarios), review 72s (21), testing 49s
  (12), config 40s (19), environment 36s (11)

## Current architecture (facts the plan builds on)

- All side effects go through Effect `Context.Tag` services — the seam already
  exists, no production refactor needed:
  - `GitService` (`src/Git.ts`): 20-op interface, `GitService.Live` spawns git
    via `@effect/platform` `CommandExecutor`
  - `TestRunner` (`src/TestRunner.ts`), `ConfigService` (`src/Config.ts`,
    cosmiconfig-based)
  - File access via `FileSystem.FileSystem` tag (`src/Events.ts`,
    `src/State.ts`, `src/Format.ts`, `src/main.ts`)
  - The state machine (`src/Machine.ts`) is pure; `src/Events.ts` is the Effect
    edge (gatherState/gatherEvents/executeAction)
- The pure machine is already heavily unit-tested in vitest (fast):
  `Machine.test.ts` (108 tests), `Machine.property.test.ts`, `Events.test.ts`
  (269 tests). Cucumber's unique value is the integration surface, not machine
  logic.
- Cucumber runs gtd as a subprocess: `tests/integration/support/world.ts`
  `runGtd()` does `spawnSync(node, [scripts/gtd.js, ...])` in a per-scenario
  `mkdtempSync` repo (created in `common.steps.ts` "Given a test project",
  cleaned in `hooks.ts` After).
- Prompts emitted by gtd inline real `git diff` output, and scenarios assert on
  that text verbatim (e.g. `stdout contains "src/calc.ts"`,
  `stdout does not contain "a/TODO.md"`). Any mock git must reproduce the diff
  text — this is the central fidelity problem the plan resolves by _sharing the
  renderer_ instead of imitating `git diff`.
- `Git.test.ts` (382 lines) already tests `GitService.Live` against real temp
  repos — it is the "live half" of a future contract suite.
- Repo uses node/npm only (bun was removed 2026-07-03). Note: `cucumber.mjs`
  `paths` config overrides positional CLI args — to run a single feature, edit
  config or use `--name`.

## Approach

Split `GitService` into read and write halves, share a gtd-owned diff renderer
between live and in-memory implementations, and run the bulk of cucumber
scenarios in-process against in-memory layers. Keep a small `@live` tier on real
git for scenarios whose value IS real-git integration.

### Key decisions (already made, with rationale)

- **Diff fidelity by construction, not by contract.** Extract a pure
  jsdiff-based renderer used by BOTH implementations; content pairs
  `(path, before, after)` come from git plumbing (live) or the snapshot store
  (in-memory). The inlined diff is LLM-consumed context, never piped to
  `git apply`, so a stable gtd-owned format is fine — and it stops prompt output
  varying with the user's git version/config. Scenario assertions get updated
  once to the new format.
- **No isomorphic-git.** Evaluated (v1.38.x, actively maintained): it has NO
  diff-text generation (the hard part), and with rendering shared, a hand-rolled
  snapshot model (~300 lines, zero deps) covers everything the in-memory tier
  needs. It also must not back production: it skips client-side hooks
  (husky/lint-staged — this repo itself uses them), reads no global gitconfig
  (user identity/signing breaks), no submodules/gitattributes/autocrlf/reftable,
  and `statusMatrix` is slow on large real repos.
- **Production writer stays subprocess git.** The git binary is the correctness
  guarantee for user-facing commits (hooks, identity, signing — see the `run()`
  comment in `src/Git.ts` for historical bugs). Production has no latency
  pressure: gtd runs between multi-second LLM turns.
- **Live-tier features** (tag `@live`): `environment.feature` (pre-commit hooks,
  submodules, CRLF, detached HEAD, subdirectory cwd, not-a-repo),
  `formatting.feature` (bundled prettier against real node_modules),
  `transport.feature` (HEAD reset), plus 1–2 smoke journeys from
  `journeys.feature`. Everything else is machine-seam + prompt-content testing
  and is mock-safe.

## Work packages

- [ ] Quick win: add `parallel: 4` to `tests/integration/cucumber.mjs` (measured
      7m16s → 4m30s; scenarios are already isolated via mkdtemp)
- [ ] Fix the 2 pre-existing `squashing.feature` failures ("Happy path —
      Squashing prompt fires after gtd: done" and its sibling): the squash
      prompt now legitimately contains the string "git reset --soft" inside the
      "Do not run `git reset --soft` or `git commit` yourself" instruction, but
      the scenarios assert `stdout does not contain "git     reset --soft"` /
      `"git commit"`. Decide: tighten assertions (e.g. assert absence of an
      _instruction to run_ it) or reword the prompt.
- [ ] Extract shared diff renderer: pure module rendering
      `(path, before, after)` file pairs into a stable unified-diff-like format
      (jsdiff `structuredPatch` or similar); switch `GitService.Live`
      `diffHead`/`diffRef`/`diffPath` to gather content (plumbing:
      `git show <ref>:<path>`, worktree reads, `git ls-files     --others` for
      untracked — replaces the intent-to-add trick) and render through it; keep
      `:(exclude)` semantics as path filtering in JS; update scenario assertions
      to the new format
- [ ] Split `GitService` into `GitReader` (statusPorcelain, diffHead, diffRef,
      diffPath, lastCommitSubject, hasCommits, resolveRef, topLevel,
      resolveDefaultBranch, mergeBase, isAncestor, lastDeletionOf,
      commitHistory) and `GitWriter` (commitAllWithPrefix, softResetTo,
      mixedResetHead, resetHard, revertNoCommit, removeGtdDir,
      removePackageDir); provide a combined layer so `Events.ts` callers are
      unchanged
- [ ] Implement `InMemoryRepo` snapshot store: commits as
      `{ hash, message, files: Map<path, content>, parent }`, plus worktree +
      index maps; merge-base via ancestor walk; `revertNoCommit` via inverse
      delta; branch refs for softReset/default-branch. Provide
      `GitReader.InMemory` / `GitWriter.InMemory` and an in-memory
      `FileSystem.FileSystem` layer backed by the same store
- [ ] Parameterize `Git.test.ts` into a contract suite running every spec
      against Live (temp repo) and InMemory; remaining contract surface after
      the shared renderer: porcelain text format, commitHistory ordering +
      `removedErrors` flag, reset/revert semantics, empty-repo edge cases
- [ ] In-memory `TestRunner` layer understanding the command shapes scenarios
      actually use (`true`, `false`, `test -f <marker>` / `bash gate.sh` against
      the mock fs); scenarios with exotic gates stay `@live`
- [ ] In-memory config layer reading `.gtdrc` from the mock fs (reuse the
      `fakeConfig` pattern from `Events.test.ts`; note AGENTS.md:
      `agenticReview*` travel as ResolvePayload fields, not Context tags)
- [ ] In-process cucumber world: run the Effect program directly with InMemory
      layers, capture stdout via a test sink layer, reset module-level state
      between scenarios (the `ensureNewline` dirty flag in the stdout handler is
      a known global — see AGENTS.md "Stdout / Newline Handling"); step
      definitions dispatch to in-memory repo or real git by tier so feature
      files stay unchanged (AGENTS.md: Given steps stay composable/generic,
      content visible in scenario text)
- [ ] Tag live-tier features `@live`, run them with today's spawnSync world;
      migrate the rest to the mock tier feature by feature, slowest first
      (journeys, review, testing, config)

## Open Questions

<!-- none yet -->

## Expected outcome

Mock tier (~100 scenarios) in seconds; live tier (~25 scenarios) ~40s at 4
workers; CI total ~1min. New scenarios default to the mock tier so suite growth
stays cheap; the live tier remains the honest integration net.
