# Rename isFixGtd → isTestFix in the pure machine + unit tests

Mechanical rename only — no logic change. The machine's contract ("count the
trailing run of flagged COMMIT events") is exactly right; only the flag's name
changes to match the new trailer-based source.

## Files

- `src/Machine.ts`
- `src/Machine.test.ts`

## Details (src/Machine.ts)

- Line ~75: the COMMIT event type
  `| { type: "COMMIT"; isFixGtd: boolean }` → `| { type: "COMMIT"; isTestFix: boolean }`.
- Line ~156: `foldCommit` action — `event.isFixGtd ? ... : 0` → `event.isTestFix ? ... : 0`.
- Leave `MAX_VERIFY_ITERATIONS`, `capReached`, and escalate routing untouched.
- The doc comment on line ~13 ("consecutive `fix(gtd):` verify iterations") may
  be updated to say "test-fix" for accuracy, but this is optional and must not
  change behavior.

## Details (src/Machine.test.ts)

- Line ~4: helper `const commit = (isFixGtd: boolean): GtdEvent => ({ type: "COMMIT", isFixGtd })`
  → rename param/field to `isTestFix`.
- All `commit(true)` / `commit(false)` call sites keep working (positional arg).
- Line ~38 test description `"N trailing isFixGtd:true → N"` → reword to
  `isTestFix`.
- No assertion logic changes — the counter semantics are identical.

## Acceptance criteria

- [ ] No remaining `isFixGtd` reference anywhere in `src/Machine.ts` or
      `src/Machine.test.ts`.
- [ ] COMMIT event type uses `isTestFix: boolean`.
- [ ] `foldCommit` reads `event.isTestFix`.
- [ ] `npm run test` passes (all Machine.test.ts cases green).

## Constraints / edge cases

- This must land in the SAME package commit as the Events task so the renamed
  field name is consistent across the union type and its producer.
- File-disjoint: edit only `src/Machine.ts` and `src/Machine.test.ts`.
