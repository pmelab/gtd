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

## spec-challenge: "docs show only the new form" misses the shipped authoring skill

REQUIREMENTS concern 4 limits the docs update to `docs/configuration.md` and the
README, and the refactor package froze its scope to the same list. But
`skills/authoring/SKILL.md` ships in the npm package (`"skills/"` in
`package.json` `files`; `docs/configuration.md` tells users to copy it) and
repeats the same hotfix example, still as
`return afterTail(await buildTail(true, start()))` (line 59). So the one doc
written for coding agents still teaches the `@deprecated` form, contrary to the
spec's "docs show only the new form". The same file's `planAndBuild` example
(line 241, `if ((await buildTail(false)) === "signoff") return`) was already
wrong before this change (no `base`, and the outcome is an object with
`verdict`, not a string). It is the same call shape, so fix it here too: switch
both to `buildTail(base, { … })`.

## spec-challenge: `fixFirst`/`green` move into a type the public entry does not export

Concern 1 makes `BuildTailOptions` the documented way to call the public
`buildTail` (`fixFirst` and `green` now live there). But
`src/workflows/index.ts` re-exports only `buildTail, type ReviewOutcome` from
`review.ts`, so config authors cannot name `BuildTailOptions`.
`ImplementOptions` is exported, because `seam.ts` is re-exported with
`export *`. COMPATIBILITY.md puts entrypoint exports' types under package
SemVer, so the options shape is now public API with no name for it. Either add
`type BuildTailOptions` to the `index.ts` re-export (additive, minor) or record
why it stays unnamed. Non-blocking.
