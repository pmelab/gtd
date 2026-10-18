# Review: 0457c18

<!-- base: f8fbd73b6a21ab4e6b9450ba60aa316d00baf914 -->

**Three call shapes move to options objects; production code and docs use the
new form; behaviour is unchanged.** **The risk-fix round (3e5e930) changed
nothing, and correctly so:** all three earlier risks needed test edits, and the
refactor lap refuses any test-file change (`requireNoTestFiles`, "never a test
file"). Test-file strays reach the implement turn through the naive tip, so the
test migration lands there. The earlier `Risk:` marks are dropped as refactor
defects and listed below as follow-ups for that turn.

**Follow-up for the implement turn, not this lap:** migrate the old-form calls
in `src/workflows/feature/review.test.ts:796`, `feature.test.ts:134`,
`seam.test.ts:244`, `shared/text.test.ts:1064,1074,1075`,
`tests/integration/support/steps/review-severity.steps.ts:30,35`, and **68
`buildTail(true|false, …)` calls across 14 `.feature` files**; keep exactly one
test each pinning the deprecated `buildTail` and `implement` forms; delete the
`refactorBuildingPrompt` positional overload.

## `buildTail` takes `base` plus an options object

`fixFirst` and `green` join `BuildTailOptions`, both defaulting to `false`. A
`@deprecated` overload keeps `buildTail(fixFirst, base, green?, options?)`; a
string first argument picks the new form at runtime. Either form produces the
same `tail(...)` call.

- [ ] ./src/workflows/feature/review.ts#259-262 — `fixFirst` / `green` added to
      `BuildTailOptions`, with their defaults documented
- [ ] ./src/workflows/feature/review.ts#280-310 — overload plus runtime
      dispatch. Old-form `fourth` spreads first, so positional
      `fixFirst`/`green` always win. **No test yet calls the new form, and none
      covers new-form `fixFirst: true`, the exact shape the docs show** — the
      implement turn's migration closes this
- [ ] ./src/workflows/feature/feature.ts#42-42 — `planAndBuild` lap passes
      `{ green: true, lap? }`
- [ ] ./src/workflows/feature/feature.ts#59-59 — naive slice passes
      `{ green: true, lensBase }`
- [ ] ./src/workflows/feature/feature.ts#72-76 — feedback loop passes
      `{ green: true, lap: "feedback", lensBase? }`
- [ ] ./src/workflows/feature/refactor.ts#284-286 — refactor tail passes
      `green: true` in its existing options literal
- [ ] ./docs/configuration.md#437-437 — hotfix example now shows
      `buildTail(start(), { fixFirst: true })`; docs show only the new form, as
      specified; README has no call-shape mention

## `implement` takes an options object

`ImplementOptions { reference?, tier?, amend? }` is new and public through
`export * from "./feature/seam.js"`. A `@deprecated` overload keeps the
positional form. A non-null object picks the new form; `implement()` means the
same in both forms.

- [ ] ./src/workflows/feature/seam.ts#44-84 — options type, overloads, dispatch;
      body unchanged. **`seam.test.ts:244` still uses the positional form, so no
      unit test exercises the options form yet** — implement-turn follow-up
- [ ] ./src/workflows/feature/feature.ts#57-57 — naive slice calls
      `implement({ reference: seam.reference, tier })`
- [ ] ./src/workflows/feature/feature.ts#71-71 — feedback loop calls
      `implement({ tier, amend: true })`

## `refactorBuildingPrompt` takes an options object

The prompt body moves into `refactorBuildingPromptOf`, which destructures
`RefactorBuildingArgs`. Prompt text is unchanged; the existing `text.test.ts`
cases pin it.

- [ ] ./src/workflows/shared/text.ts#460-497 — **a `@deprecated` positional
      overload with silent `strays ?? []` / `pattern ?? ""` fallbacks stays,
      against REQUIREMENTS §3's "no compatibility path".** It exists only
      because `text.test.ts:1064,1074,1075` use the old form and this lap may
      not touch tests. The implement turn must delete the overload and
      fallbacks, export the destructuring function as `refactorBuildingPrompt`,
      and migrate those calls
- [ ] ./src/workflows/feature/refactor.ts#219-225 — `refactorLap` passes
      `{ pkg, strays, pattern, reference, feedback }`
