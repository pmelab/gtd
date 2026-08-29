Task 8 was not done at all, and three graders are weaker than the spec
contracts. Tasks 1–7 otherwise land as written.

## Task 8 is entirely undone — the baseline was never re-recorded

`evals/baseline.json` still holds exactly the two pre-rekey cells:

```
"gemini-3.5|clean":     { "passed": 4, "total": 4 }
"gemini-3.5|violation": { "passed": 4, "total": 4 }
```

`recordedAt` is `2026-08-29T11:22:35.457Z`, and `git log -- evals/baseline.json`
shows its last change was commit `819447e1`, an earlier lap — before any of the
eight new case files existed. Four of task 8's checkboxes fail:

- It carries 2 cells, not 18.
- Both `gemini-3.5|clean` and `gemini-3.5|violation` still remain.
- No key is shaped `gemini-3.5|<case>|<variant>`.
- `recordedAt` does not correspond to a run of this config.

This is exactly the risk task 1 named: the rekey and the record had to ship
together. As committed, `npm run eval` reds with 2 baseline cells missing from
the run plus 18 run cells unrecorded — 20 gate violations. Run `npm run eval`
once at `--max-concurrency 2`, then `npm run eval:baseline`, and commit the
result. Do not hand-edit the JSON, and do not record a suspiciously low cell —
re-run it.

## `packages-item-building`'s violation rubric grades an empty string

`evals/cases/packages-item-building.mjs` correctly declares no `artifact`, so
`readFeedback` in `evals/run-turn.mjs` returns `feedback: ""`. But
`evals/promptfooconfig.yaml`'s `packages-item-building` / `violation` entry
still carries an `llm-rubric` whose transform is
`structurallyOk ? feedback : "STRUCTURAL FAILURE"` — on a structurally-ok turn
the judge receives `""` and is asked whether `src/formatName.ts` implements
`formatName`. That cell can never pass, and it burns a judge call to fail.

Either drop the tier-3 rubric from that entry (the case has no artifact to
judge), or give the case an `artifact` of `src/formatName.ts` so the rubric has
the code it claims to read. Task 5's checkbox "declares no `artifact`, and its
grader does not look for one" points at the first option; the config was not
updated to match.

## The tier-2 grep floor is vacuous for all three coder cases that have an artifact

`checkPlantedIdentifier` (and `identifierOk` in `evals/run-turn.mjs`) greps the
artifact for `plantedIdentifier`. In all three coder cases the identifier is
already present verbatim in the `base` file the fixture commits, before the
agent runs:

- `build-fix`: `MaxRetriesExceededError` — `base["src/retryFetch.ts"]` opens
  with `export class MaxRetriesExceededError extends Error {}`.
- `packages-item-fix-spec`: `EmptyNameError` — `base["src/greet.ts"]` opens with
  `export class EmptyNameError extends Error {}`.
- `packages-item-fix-suite`: `AmountParseError` — `base["src/parseAmount.ts"]`
  opens with `export class AmountParseError extends Error {}`.

So a turn that edits any unrelated repo file passes tiers 1 and 2 and bills a
full-size judge call. Task 2's checkbox "the tier-2 grep floor still runs before
the judge is called" is satisfied literally and defeated in effect. Pick a
planted identifier the fix must INTRODUCE (for example
`throw new MaxRetriesExceededError`, or the exception subclass name declared
only in the feedback file and not in `base`), so the grep can actually fail.

## `isStructurallyOk` omits the out-of-bounds check, so the wrong move still bills the judge

`checkOutOfBounds` lives in `SHARED_CHECKS` and correctly fails the javascript
assert, but `isStructurallyOk` in `evals/run-turn.mjs` runs only four checks and
never looks at `caseDef.outOfBounds`. A turn that touched the planted
out-of-bounds file reports `structurallyOk: true`, so the tier-3 rubric is
called at full size on a turn the free tier already knows is wrong. Task 2
states `isStructurallyOk`'s job is to gate the expensive judge behind the free
checks. Add the out-of-bounds test to it.

## `outOfBounds` is undocumented in the "To add a case" list

`docs/development.md`'s case-shape paragraph enumerates `state`, `base`,
`variants`, `expect[variant].gtdFiles`, `expect[variant].otherFiles`,
`artifact`, and `plantedIdentifier` — but not `outOfBounds`, which four of the
nine cases now declare and which is load-bearing for every coder case's grader.
Add it to that list.
