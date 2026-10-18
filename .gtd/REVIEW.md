# Review: 637abf0

<!-- base: f8fbd73b6a21ab4e6b9450ba60aa316d00baf914 -->

**Three call shapes move to options objects; production code and docs use the
new form; `tsc --noEmit` is clean.** **Every test call site still uses the old
positional form** — the refactor lap forbade test edits, so REQUIREMENTS'
"update every call site" is met only for `src/` and `docs/`.

## `buildTail` takes `base` plus an options object

`fixFirst` and `green` join `BuildTailOptions`, both defaulting to `false`. A
`@deprecated` overload keeps `buildTail(fixFirst, base, green?, options?)`, and
a string first argument picks the new form at runtime. Either form produces the
same `tail(...)` call.

- [ ] ./src/workflows/feature/review.ts#259-262 — `fixFirst` / `green` added to
      `BuildTailOptions`, with their defaults documented
- [ ] ./src/workflows/feature/review.ts#280-310 — Risk: **the new form is
      unmigrated in tests, and nothing tests new-form `fixFirst: true`, the
      exact shape the docs now show.** The overload and its runtime dispatch are
      correct: old-form `fourth` is spread first, so `fixFirst`/`green` always
      win. REQUIREMENTS §1 says to update every call site, yet these still use
      the old form: `src/workflows/feature/review.test.ts:796,853`,
      `src/workflows/feature/feature.test.ts:134`,
      `tests/integration/support/steps/review-severity.steps.ts:30,35`, and
      about 70 inline configs across `tests/integration/features/*.feature`.
      Migrate them. Keep exactly one test pinning the deprecated positional form
      (for example `review.test.ts:853`).
- [ ] ./src/workflows/feature/feature.ts#42-42 — `planAndBuild` lap passes
      `{ green: true, lap? }`
- [ ] ./src/workflows/feature/feature.ts#59-59 — naive slice passes
      `{ green: true, lensBase }`
- [ ] ./src/workflows/feature/feature.ts#72-76 — feedback loop passes
      `{ green: true, lap: "feedback", lensBase? }`
- [ ] ./src/workflows/feature/refactor.ts#284-285 — refactor tail passes
      `green: true` in its existing options literal
- [ ] ./docs/configuration.md#437-437 — hotfix example now shows
      `buildTail(start(), { fixFirst: true })`; the docs show only the new form,
      as specified

## `implement` takes an options object

`ImplementOptions { reference?, tier?, amend? }` is new and public through
`export * from "./feature/seam.js"`. A `@deprecated` overload keeps the
positional form. A non-null object picks the new form; `implement()` means the
same in both forms.

- [ ] ./src/workflows/feature/seam.ts#44-84 — Risk: **`seam.test.ts:244` still
      calls `implement(reference, tier, amend)`, so no unit test exercises the
      options form.** REQUIREMENTS §2 lists `seam.test.ts` for migration, with
      one test kept to pin the old form. Move the prompt tests to
      `implement({ reference, tier, amend })` and add one old-form case.
      Dispatch and body are otherwise unchanged.
- [ ] ./src/workflows/feature/feature.ts#57-57 — naive slice calls
      `implement({ reference: seam.reference, tier })`
- [ ] ./src/workflows/feature/feature.ts#71-71 — feedback loop calls
      `implement({ tier, amend: true })`

## `refactorBuildingPrompt` takes an options object

The prompt body moves into `refactorBuildingPromptOf`, which destructures
`RefactorBuildingArgs`. The prompt text itself is unchanged.

- [ ] ./src/workflows/shared/text.ts#460-497 — Risk: **REQUIREMENTS §3 says this
      internal function switches outright with no compatibility path, but a
      `@deprecated` positional overload was kept, with silent `strays ?? []` /
      `pattern ?? ""` fallbacks.** The overload exists only because
      `src/workflows/shared/text.test.ts:1064,1074,1075` still use the old form.
      Delete the overload and the fallbacks, export the destructuring function
      as `refactorBuildingPrompt`, and migrate those three test calls.
- [ ] ./src/workflows/feature/refactor.ts#219-225 — `refactorLap` passes
      `{ pkg, strays, pattern, reference, feedback }`
