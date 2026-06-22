# Task: Widen GtdPackageFact with inlined task contents and populate it in the edge

Extend the packages fact so each `GtdPackageFact` carries the FULL CONTENTS of
its task `.md` files plus a flag for whether a `COMMIT_MSG.md` is present, and
populate it in the Effect edge (`getPackages`). This is the data that package
`02-render-named-package` will render into the execute prompt. This package does
NOT change `Prompt.ts` or `execute.md` — it only widens the fact and populates
it, proving the new fields flow through the pure machine onto `GtdContext`.

## Shared contract (PINNED — package 02 render depends on this EXACT shape)

`GtdPackageFact` in `src/Machine.ts` gains two fields (existing fields kept
verbatim for backward compat with the Context listing in `Prompt.ts`):

```ts
export interface GtdPackageFact {
  readonly name: string
  /** Task .md filenames, sorted (UNCHANGED — still drives the Context listing). */
  readonly tasks: ReadonlyArray<string>
  /** Full contents of each task .md file, parallel-sorted to `tasks`. */
  readonly taskContents: ReadonlyArray<{ readonly name: string; readonly content: string }>
  /** Whether the package dir contains a COMMIT_MSG.md. */
  readonly hasCommitMsg: boolean
}
```

- `taskContents[i].name === tasks[i]` (same sort order — `.sort()` on filenames).
- `content` is the raw file string, no trimming or transformation.
- Populate for EVERY package (uniform; the render package only consumes
  `packages[0]`, but the edge stays simple and the fact stays complete).
- `packages` is sorted ascending by dir name, so `packages[0]` is lowest-numbered.

## Implementation

- `src/Machine.ts`: widen the `GtdPackageFact` interface exactly as above. TYPES
  ONLY — no new guard, no IO, no state. `applyPayload` already passes `packages`
  straight through; the wider shape flows automatically. Confirm `initialContext`
  and the `Prompt.test.ts` `baseContext` helper still type-check (they use
  `packages: []`, which stays valid).
- `src/Events.ts` → `getPackages(fs)`: after computing `tasks`, read each task
  file's contents via `fs.readFileString(`${packagePath}/${taskFile}`)` (map
  errors to `Error` consistent with the surrounding `.mapError` style), build
  `taskContents`, and set `hasCommitMsg = files.includes("COMMIT_MSG.md")`.
  Push the widened fact.

## Acceptance criteria

- [ ] `GtdPackageFact` has `taskContents` and `hasCommitMsg` exactly as the
      contract above; `tsc`/typecheck passes.
- [ ] `getPackages` populates `taskContents` (name + raw content, sorted to match
      `tasks`) and `hasCommitMsg` for every package.
- [ ] Vitest proving the new fields flow end-to-end through the machine: a test
      that builds events with a packages fact carrying `taskContents`/`hasCommitMsg`
      and asserts `resolve(events).context.packages[0].taskContents` /
      `.hasCommitMsg` survive `applyPayload` (add to `src/Machine.test.ts`). If an
      edge-level test seam exists for `getPackages`, also add a vitest fixture
      (`.gtd/01-foo/01-task.md` + `COMMIT_MSG.md`) asserting the inlined content
      and flag are read.
- [ ] No machine guard/state/IO added; `applyPayload` behavior unchanged.

## Constraints / edge cases

- Package with NO task files: `tasks` and `taskContents` both empty arrays;
  `hasCommitMsg` still reflects `COMMIT_MSG.md` presence. Do not error.
- `isTaskFile` semantics unchanged (`.md` and not `COMMIT_MSG.md`);
  `COMMIT_MSG.md` is NOT a task but its presence sets `hasCommitMsg`.
- Deterministic (sorted) reading order so downstream prompt output is stable.

## Relevant files

- `src/Machine.ts` (interface widening only)
- `src/Events.ts` (`getPackages`)
- `src/Machine.test.ts` (+ `src/Events.test.ts` if an edge seam exists)
