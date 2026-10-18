## correctness: deprecated `buildTail(true, …)` mapping is unpinned

`src/workflows/feature/review.ts` legacy branch builds
`{ ...fourth, fixFirst: first, green: third }`. The only test of the positional
form (`review.test.ts`, "the deprecated positional form runs the same tail as
the options form") calls `buildTail(false, "base", true, options)`, so deleting
`fixFirst: first` leaves it green: `fixFirst` falls back to `false`, the value
the test already passes. Every `.feature` config moved to the new form, so no
test anywhere still calls the old form with `true`. That is the exact shape the
old hotfix docs example taught (`buildTail(true, start())`), so it is the legacy
call user configs most likely contain. Add a legacy-vs-options case with
`fixFirst: true` (e.g. assert that both forms send the same first agent request,
the fix turn).

## test-audit: both new deprecated-form tests pin less than their names claim

- `seam.test.ts`, "the deprecated positional form renders the same prompt as the
  options form", calls `implement("abc", "high", true)`. With `amend: true`
  `implementBuildingPrompt` drops the `git show` line, and `"high"` renders the
  same text as an omitted tier, so only `amend` shows up in the prompt. If the
  legacy branch's `{ reference: first, tier, amend }` dropped or swapped
  `reference` or `tier`, the test would still pass. Use arguments where each one
  shows up, e.g. `("abc", "low")` (git show line plus "Add no release flag") and
  a separate `amend` case.
- `review.test.ts`, "the deprecated positional form runs the same tail as the
  options form": `lensPrompts` only records `quality.*` agent prompts, and the
  fixture's `read` makes the health check green. So `green: third` is unpinned,
  as well as the `fixFirst: first` mapping already noted under correctness: a
  `false` green only adds an unrecorded `health.check` step. The test pins only
  the `...fourth` spread and `base`. To make it cover the mapping it claims,
  record every request name (not just `quality.*`) and compare the legacy and
  options forms with `fixFirst: true` and `green: false`.
