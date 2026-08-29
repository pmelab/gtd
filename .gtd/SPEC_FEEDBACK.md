Task 8 is still entirely undone, so the package does not satisfy its own spec.
Everything else from the previous round is resolved.

## Task 8: the baseline was never re-recorded

`evals/baseline.json` is byte-identical to the two-cell file the previous
package recorded — its last commit is `819447e1`, which predates `8fc724bb`, the
commit that first added any of this package's case files:

```
recordedAt: 2026-08-29T11:22:35.457Z
gemini-3.5|clean:     4/4
gemini-3.5|violation: 4/4
```

Four of task 8's checkboxes fail outright:

- It carries **2 cells, not 18**.
- Both keys are the **old `gemini-3.5|<variant>` shape**; the spec requires
  every key be `gemini-3.5|<case>|<variant>` and requires no old key remain.
- `recordedAt` is **11:22Z, before any new case file existed**, so it cannot
  correspond to a run of this package's cases.
- The gate fails. `node evals/compare-baseline.mjs` against the results file on
  disk reports **20 violations**: 18 run cells "not recorded in baseline" plus 2
  baseline cells missing from the run. Task 1 named this exact risk ("the rekey
  and the record ship together") and it landed unmitigated.

## The existing `evals/results.json` must not be recorded from

That file is the 15:38 run and eight of its cells are red:

```
build-fix|clean 0/4                   build-fix|violation 0/4
build-review-collecting|clean 0/4     build-review-collecting|violation 2/4
build-review-reviewing|violation 1/4  design-triage|clean 0/4
packages-item-fix-spec|violation 0/4  packages-item-fix-suite|clean 1/4
packages-item-fix-suite|violation 0/4
```

Fixes have landed since that run — `9efc8954` and `8add864e` fixed `build-fix`'s
oxfmt "Expected at least one target file" crash, the `build-review-collecting`
identifier, and the `plantedIdentifier` grep floors — and `16743975` onward
rescoped `outOfBounds` per variant. **Run `npm run eval` fresh before recording
anything.** Recording from the file on disk writes those stale zeros in as the
permanent floor, which the spec names as the one thing never to do: a cell
recorded below its true rate can never rise again, because
`evals/compare-baseline.mjs` only fails on a rate that drops.

Then `npm run eval:baseline` once, for the whole package — never one record per
case — and confirm `npm run eval` passes its own gate against the recorded file.
`--max-concurrency` stays at 2.
