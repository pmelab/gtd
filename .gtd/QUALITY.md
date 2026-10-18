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
