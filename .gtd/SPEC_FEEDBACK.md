# Spec feedback — 02-baseline-gate

The gate's logic, CLI, tests, and docs match the spec. Two build-integration
problems remain.

## 1. `test:unit` under-declares `inputs` — editing the gate caches a stale green

`tests/tooling/eval-baseline.test.ts` imports
`../../evals/compare-baseline.mjs`, but `turbo.json`'s `test:unit` task lists
only `src/**`, `tests/tooling/**`, `tests/vitest.*.ts`, `vitest.config.ts`,
`turbo.json`, `docs/**` — no `evals/**`.

Reproduced: appended a line to `evals/compare-baseline.mjs`, re-ran
`npx turbo run test:unit` → `1 cached, 1 total >>> FULL TURBO`. A broken
regression gate reads green on a cached result.

This is the exact failure AGENTS.md names ("under-declared `inputs` cache a
stale green", canonical example `docs/**`). `lint`'s inputs were correctly
extended with `evals/**` in this package; `test:unit` was not.

Fix: add `evals/**` to `test:unit`'s `inputs` in `turbo.json`.

## 2. `deadcode` under-declares `inputs` for the same reason

`.fallowrc.json` now declares `evals/*.mjs` as fallow entry points, so
`deadcode` analyses those files. `turbo.json`'s `deadcode` inputs are `src/**`,
`tests/**`, `*.ts`, `.fallowrc.json` — again no `evals/**`. Dead code introduced
in an `evals/*.mjs` file does not invalidate the cache.

Fix: add `evals/**` to `deadcode`'s `inputs`.

## 3. Minor — a test name claims coverage the test does not have

`tests/tooling/eval-baseline.test.ts`, `record() CLI entry point` → "rewrites
the baseline as an oxfmt fixed point, byte-identical on a re-record with no
change". The body calls `record()` once, then `compare()`, and asserts `compare`
left the file untouched. It never re-records, and never asserts the written file
is an oxfmt fixed point.

Either rename it to what it tests (`compare()` never rewrites the baseline), or
add the second `record()` call and the byte-identity assertion the name promises
— acceptance criterion 4 ("the result is an oxfmt fixed point, so `format:check`
stays green") is currently only implied by `record()` shelling out to
`oxfmt --write`, not asserted.
