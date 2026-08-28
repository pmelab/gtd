# Spec feedback — 02-baseline-gate

## 1. `typecheck` now depends on `evals/**` but does not declare it — a stale green caches

`tests/tooling/eval-baseline.test.ts` imports
`../../evals/compare-baseline.mjs`. `tsconfig.json` has `allowJs: true` and
includes `tests`, so `tsc --noEmit` pulls that `.mjs` in and type-checks the
test against its real exports. But `turbo.json`'s `typecheck` task declares
`inputs: ["src/**", "tests/**", "*.ts"]` — no `evals/**`.

Proof the coupling is real: renaming `export function compareCells` to
`compareCellsX` in `evals/compare-baseline.mjs` makes `npx tsc --noEmit` fail
with `TS2724 ... has no exported member named 'compareCells'`. With only
`evals/**` changed and `src/**`/`tests/**` untouched, Turborepo replays the
cached green instead of catching it.

This is the exact failure mode AGENTS.md names ("under-declared `inputs` cache a
stale green"). `lint`, `deadcode` and `test:unit` all already list `evals/**`;
`typecheck` is the one that was missed.

Fix: add `"evals/**"` to `turbo.json`'s `typecheck` inputs. Pin it in
`tests/tooling/turbo.test.ts` the same way `docs/**` is pinned, so it cannot be
dropped again.

## 2. Task 2's last bullet is unfulfilled by the reader itself

Spec, task 2: "Prints the per-cell counts and never a total spanning fixtures or
models."

`evals/compare-baseline.mjs` prints per-cell counts only on a violation. On a
green run, `compare()` prints one line —
`eval: no regression against evals/baseline.json` — and no counts. A human who
runs `node evals/compare-baseline.mjs` on its own (e.g. to re-check after
`npm run eval:baseline`) sees no rates at all. Inside `npm run eval` the counts
come from `evals/report.mjs`, a different module.

Fix: have `compare()` print the per-cell `key: passed/total` lines it just read.
Do not create a second copy of the matrix in `npm run eval` output — either
route it through `printCells` and drop `eval.mjs`'s separate `printReport()`
call, or gate the reader's own printing so the composed command still prints the
matrix exactly once. Keep the no-aggregate rule: never a line summing across
fixtures or models.
