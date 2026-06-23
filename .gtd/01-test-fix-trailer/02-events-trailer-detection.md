# Detect the `Gtd-Test-Fix:` trailer in gatherEvents (rename isFixGtd → isTestFix)

Switch the COMMIT-event flag from "subject is `fix(gtd):`" to "commit carries
the `Gtd-Test-Fix:` trailer", reading the full message via the new
`commitMessages` reader.

## Files

- `src/Events.ts`
- `src/Events.test.ts`

## Details (src/Events.ts, lines ~195-199)

Replace:

```ts
const subjects = yield* git.commitSubjects(Option.getOrUndefined(base))
const commitEvents: Array<GtdEvent> = subjects.map((subject) => ({
  type: "COMMIT",
  isFixGtd: /^fix\(gtd\):/.test(subject),
}))
```

with:

```ts
const messages = yield* git.commitMessages(Option.getOrUndefined(base))
const commitEvents: Array<GtdEvent> = messages.map((message) => ({
  type: "COMMIT",
  isTestFix: /^Gtd-Test-Fix:/m.test(message),
}))
```

- Range/`base` plumbing (lines ~190-193) is unchanged.
- The COMMIT event field is renamed `isFixGtd` → `isTestFix`; this must match the
  type in `src/Machine.ts` (handled by the sibling Machine task — both land in
  this same package commit).

## Details (src/Events.test.ts)

- This file currently only covers `getPackages` (no commit-flag tests). Add a
  new `describe` block exercising the trailer detection via `gatherEvents` over a
  real temp git repo (mirror the temp-repo setup already in the file):
  - a commit whose body carries `Gtd-Test-Fix: 1` → its COMMIT event has
    `isTestFix: true`.
  - a plain `fix(gtd): something` commit with NO trailer → `isTestFix: false`.
  - (optional) a trailing run of trailer commits → all flagged.
- If wiring `gatherEvents` (which needs `GitService` + a default branch) is too
  heavy, instead unit-test the regex contract directly: assert
  `/^Gtd-Test-Fix:/m.test(msg)` is true for a body containing the trailer on its
  own line and false for a bare `fix(gtd):` subject. Keep it a real, meaningful
  test of the new flag source.

## Acceptance criteria

- [ ] `gatherEvents` calls `git.commitMessages` (not `commitSubjects`).
- [ ] COMMIT events use `isTestFix` keyed off `/^Gtd-Test-Fix:/m`.
- [ ] No remaining reference to `isFixGtd` or `/^fix\(gtd\):/` in `src/Events.ts`.
- [ ] `src/Events.test.ts` has a test: trailer present → flagged; bare
      `fix(gtd):` subject → not flagged.
- [ ] `npm run test` passes.

## Constraints / edge cases

- The `m` flag is required: the trailer is on its own body line, not at message
  start. `/^Gtd-Test-Fix:/m` matches start-of-line anywhere in the message.
- File-disjoint: edit only `src/Events.ts` and `src/Events.test.ts`. The COMMIT
  event TYPE lives in `src/Machine.ts` (sibling task) — do not edit it here.
