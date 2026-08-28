# Spec feedback — 01 Make the mutation suite runnable

All five tasks land. Verified independently: `npx stryker run --dryRunOnly`
completes (`Initial test run succeeded. Ran 1120 tests`, exit 0, no abort);
`npx vitest run --project unit` exits 0 with no uncaught exception; reverting
`vitest.stryker.config.ts` to the 9-entry array reds
`tests/tooling/setup-files.test.ts` as required; `npm run deadcode` and
`oxfmt --check .` are green with no `.fallowrc.json` edit; `stryker.config.json`
is byte-identical and has no `thresholds`; `turbo.json` grew exactly the three
declared inputs and `tests/tooling/turbo.test.ts` is untouched.

One defect blocks sign-off.

## Stale comment: `tests/integration/support/hooks.ts:30` names a config key that no longer exists

The comment reads:

> This runs once per WORKER (module load, not per-test), so it stays safe under
> the `e2e-inmem` project's `fileParallelism: true` — but it IS a mutation of
> global process state, so any future step definition adding its own
> `process.env` write here would break that parallelism silently. Don't.

**`fileParallelism: true` was deleted from the `e2e-inmem` project in this
range.** `vitest.config.ts` no longer sets the key on either e2e project; the
`e2e-live` serialization moved to the `--no-file-parallelism` CLI flag on
`package.json`'s `test:e2e:live` script. A reader who greps `vitest.config.ts`
for the value this comment cites finds nothing, and cannot tell whether the
invariant still holds or was dropped.

The invariant itself still holds — `e2e-inmem` runs parallel by vitest's
default. Only the pointer is wrong.

Fix: reword line 30 so it states the condition rather than the deleted key —
e.g. "safe under `e2e-inmem`'s parallel file execution (vitest's default; the
project sets no `fileParallelism` override)". Do not re-add the key to
`vitest.config.ts`: per that file's own comment, vitest resolves
`fileParallelism` before projects split, so a project-level value does not take
effect.
