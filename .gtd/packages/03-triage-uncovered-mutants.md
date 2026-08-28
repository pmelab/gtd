# 03 — Triage the 64 uncovered mutants

## Requirement

> ### 5. Triage the 64 uncovered mutants (PRODUCT)
>
> Distinct from every survivor above: **these are lines no test reaches.** Per
> file: `src/Config.ts` (15), `src/PatternConfig.ts` (14), `src/Lsp.ts` (11),
> `src/Edge.ts` (10), `src/ReviewDoc.ts` (5), `src/PatternMachine.ts` (5),
> `src/SteeringMode.ts` (2), `src/OpenQuestions.ts` (2). Weakest files overall
> line up with this: `Config.ts` 72.03%, `Lsp.ts` 73.61%, `ReviewDoc.ts` 73.97%,
> `Edge.ts` 74.37%.
>
> **`reports/mutation/` does not exist in this checkout, and AGENTS.md forbids
> running `test:mutation` autonomously** — so the per-site list has to come from
> somewhere else. Get it from ordinary line coverage over the nine files in
> `stryker.config.json`'s `mutate` array: an unreached line is an unreached
> line, and that is the entire no-coverage subset. No 13-minute run required.
>
> **Delete unreachable branches rather than covering them.** Code no test can
> reach is code no user can reach, and a message that cannot fire is dead weight
> faking robustness. That applies to the 35 string literals too: an unreached
> defensive error string goes, it does not get a test built to reach it.
>
> The scoped condition that decision rests on, and it is not optional: **delete
> only where you can prove from the callers that the branch is unreachable.**
> Line coverage tells you a line was never executed — it cannot tell you apart
> "impossible" from "reachable but untested", and those two resolve opposite
> ways. A site that is merely untested gets a test, same as any concern above.
>
> Risk in one line: **delete a branch that some real path can still reach and
> you convert a clear error message into a crash or a silent wrong answer.**
> Proving unreachability per site is the bulk of the work here, not the
> deleting.
>
> Acceptance: line coverage over the nine mutated files reports zero unreached
> statements, whether a site got a test or got deleted.

## Paths

- `src/Config.ts` (15 mutants), `src/PatternConfig.ts` (14), `src/Lsp.ts` (11),
  `src/Edge.ts` (10), `src/ReviewDoc.ts` (5), `src/PatternMachine.ts` (5),
  `src/SteeringMode.ts` (2), `src/OpenQuestions.ts` (2)
- Their sibling `*.test.ts` files
- `package.json`
- `vitest.config.ts`

## Task 1 — Wire up line coverage

**These are lines no test reaches, not survivors.** `reports/mutation/` does not
exist in this checkout and AGENTS.md forbids running `test:mutation`
autonomously, so the per-site list comes from ordinary line coverage instead: an
unreached line is an unreached line, and that is the entire no-coverage subset.
No 13-minute run required.

**Add `@vitest/coverage-v8` as a devDependency and configure `provider: "v8"`.**
V8, not istanbul — it is vitest's default provider and needs no instrumentation
step in a build that already runs through tsdown.
`reporter: ["text", "json-summary"]`.

**Read the nine-file include list out of `stryker.config.json`'s `mutate` array
inside `vitest.config.ts`** rather than retyping it. One source of truth means
the coverage scope cannot drift from the mutation scope, and it needs no test to
hold it.

**It ships as one `coverage` script and nothing else: no `turbo.json` task, no
`thresholds`, no 100-statement floor, and no entry in the `test` script's task
list.** A floor scoped to these nine files would fire during unrelated
refactors, and `turbo.test.ts` only demands the three-part script/task/test-list
set for tasks that exist — a script with no task is legal and stays out of the
graph.

Risk, blunt: **with no floor, a newly-uncovered statement lands green and stays
invisible until the next deliberate `coverage` run.** Accepted, and it is the
same trade already accepted for the mutation score.

- [ ] `@vitest/coverage-v8` is a devDependency in `package.json`
- [ ] `vitest.config.ts` sets `test.coverage.provider` to `"v8"` and `reporter`
      to `["text", "json-summary"]`
- [ ] `vitest.config.ts` derives the coverage `include` list by reading
      `stryker.config.json`'s `mutate` array, not by retyping the nine paths
- [ ] `package.json` has a `coverage` script
- [ ] `turbo.json` has no `coverage` task
- [ ] `package.json`'s `test` script does not name `coverage`
- [ ] No `thresholds` or `100`-statement floor is configured anywhere
- [ ] `tests/tooling/turbo.test.ts` still passes unchanged

## Task 2 — Prove reachability per site, then test or delete

**Per site: read every caller, then decide.** Reachable-but-untested gets a test
in the module's existing `*.test.ts`. Unreachable gets deleted — **including the
35 string literals, because an unreached defensive error string is dead weight
faking robustness and does not get a test built to reach it.**

**Delete outright. No `never`-typed exhaustiveness assert stands in for the
removed branch** — a guard would keep a line the coverage report then counts as
unreached, defeating this package's acceptance criterion. **The unreachability
proof goes in the commit message, naming the callers that establish it**, which
is the one place a reviewer reads it.

**The scoped condition, and it is not optional: delete only where the callers
prove the branch is unreachable.** Line coverage tells you a line never
executed; it cannot tell "impossible" apart from "reachable but untested", and
those two resolve opposite ways.

**Compile-pressure rule for deletions: if removing a branch forces a new `as`
cast or `!` to typecheck, that is evidence the branch is reachable — stop and
cover it instead.** Deleting must never widen a type to keep the file compiling.

Risk in one line: **delete a branch some real path can still reach and you
convert a clear error message into a crash or a silent wrong answer.** Proving
unreachability per site is the bulk of this package, not the deleting.

- [ ] Every unreached statement in `src/Config.ts` (15 mutants) is either
      covered by a new test or deleted
- [ ] Every unreached statement in `src/PatternConfig.ts` (14) is either covered
      by a new test or deleted
- [ ] Every unreached statement in `src/Lsp.ts` (11) is either covered by a new
      test or deleted
- [ ] Every unreached statement in `src/Edge.ts` (10) is either covered by a new
      test or deleted
- [ ] Every unreached statement in `src/ReviewDoc.ts` (5) is either covered by a
      new test or deleted
- [ ] Every unreached statement in `src/PatternMachine.ts` (5) is either covered
      by a new test or deleted
- [ ] Every unreached statement in `src/SteeringMode.ts` (2) is either covered
      by a new test or deleted
- [ ] Every unreached statement in `src/OpenQuestions.ts` (2) is either covered
      by a new test or deleted
- [ ] The commit message names, per deleted site, the callers that prove it
      unreachable
- [ ] No `never`-typed exhaustiveness assert was introduced in place of a
      deleted branch
- [ ] No deletion introduced a new `as` cast or `!` to keep the file compiling
- [ ] New tests land in the module's existing `*.test.ts` file, not a new file

## Task 3 — Verify the gaps are closed

- [ ] `npm run coverage` reports zero unreached statements across all nine files
      in `stryker.config.json`'s `mutate` array
- [ ] `npm test` is green
- [ ] `npm run deadcode` is green
- [ ] `npm run typecheck` is green with no new casts
