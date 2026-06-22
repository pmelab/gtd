# Task: TestRunner Effect service wrapping `npm run test`

Create a new Effect service that runs the hardcoded test command `npm run test`,
captures combined stdout+stderr and the exit code, and exposes the result to the
edge. This is pure plumbing IO; it follows the existing `GitService` pattern
exactly.

## Files

- `src/TestRunner.ts` (NEW) — the service.
- `src/TestRunner.test.ts` (NEW) — unit coverage.

## Contract (other tasks in this package depend on this exact shape — do not deviate)

Export from `src/TestRunner.ts`:

```ts
export interface TestResult {
  readonly exitCode: number
  /** Combined stdout+stderr, captured verbatim. */
  readonly output: string
}

export interface TestRunnerOperations {
  /** Runs `npm run test`, never fails the Effect — non-zero exit is data, not error. */
  readonly run: () => Effect.Effect<TestResult>
}

export class TestRunner extends Context.Tag("TestRunner")<
  TestRunner,
  TestRunnerOperations
>() {
  static Live: Layer.Layer<TestRunner, never, CommandExecutor.CommandExecutor>
}
```

## Implementation notes

- Use `@effect/platform` `Command`/`CommandExecutor`, mirroring `src/Git.ts`
  (`Context.Tag` + `static Live = Layer.effect(...)`).
- Command is hardcoded: `Command.make("npm", "run", "test")`. No env override,
  no inference, no config — per the plan.
- Capture BOTH stdout and stderr (merge into one `output` string) and the exit
  code. A non-zero exit code MUST be returned as `TestResult` data, never raised
  as an Effect error — the edge branches on `exitCode`, so the Effect must
  succeed in both green and red cases.
- Keep it IO-free of git/fs concerns; it only runs the test command.

## Acceptance criteria

- [ ] `src/TestRunner.ts` exports `TestResult`, `TestRunnerOperations`,
      `TestRunner` (Context.Tag) and `TestRunner.Live` (Layer) with the contract
      signatures above.
- [ ] The command run is exactly `npm run test` (assert in a unit test, e.g. by
      providing a stub `CommandExecutor` or running against a temp project whose
      `package.json` has a `test` script that writes a sentinel).
- [ ] `run()` on a project whose `test` script exits 0 yields
      `{ exitCode: 0, output: <captured> }`.
- [ ] `run()` on a project whose `test` script exits non-zero yields
      `{ exitCode: <non-zero>, output: <captured> }` and the Effect SUCCEEDS
      (does not fail) — captured output is present.
- [ ] `npm run typecheck` passes for the new file.

## Constraints / edge cases

- Do NOT add any IO to `src/Machine.ts` — this service is the IO boundary.
- Do NOT wire this into `main.ts`/`State.ts` here — task 03 owns the edge
  wiring against the contract above; that task and this one run in parallel.
