## correctness: `refactorBuildingPrompt` grew a compat path the requirements forbid

`src/workflows/shared/text.ts` keeps a `@deprecated` positional overload of
`refactorBuildingPrompt`. REQUIREMENTS concern 3 says this internal function
"switches outright, no compatibility path", and the reference (`a8c7122c`) did
exactly that. The overload exists only because this package could not touch
`src/workflows/shared/text.test.ts`, which still calls the positional form
(lines 1064, 1074, 1075).

The legacy branch also falls back silently: `strays ?? []` and `pattern ?? ""`.
A positional call that leaves out `pattern` builds a prompt with an empty flag
pattern instead of failing to type-check or throwing.

Fix: when the build migrates `text.test.ts` to the object form, delete the
positional overload and the dispatcher, and keep one signature taking
`RefactorBuildingArgs`. Nothing in the refactor plan schedules this, so without
that step the scaffolding ships.

## correctness: no runtime coverage of the new forms beyond `feature.ts`

Right now every test still calls the deprecated positional forms:
`review.test.ts:796,853`, `seam.test.ts:244`, `feature.test.ts:134`, the
`buildTail(true|false, start())` configs in
`tests/integration/features/*.feature`, and `review-severity.steps.ts:30,35`. So
the new-form branches are guarded only through the production callers in
`feature.ts` and `refactor.ts`, which always pass `green: true` and never
`fixFirst`.

- If `buildTail(base, { fixFirst: true })` dropped `fixFirst`, i.e.
  `options.fixFirst ?? false` always evaluated to false, no test would fail. The
  only caller using it is the docs hotfix example, which nothing runs.
- No test checks that the two forms produce the same tail for the same inputs
  (concern 1, "Behaviour unchanged").
- No test calls `implement({...})` directly. `implement()` with no argument,
  which concern 2 says must mean the same in both forms, is never called.

The build must migrate these call sites as REQUIREMENTS lists, and leave exactly
one test pinning each deprecated form (`buildTail`, `implement`).

## correctness (nit): legacy `buildTail` overload accepts conflicting `fixFirst`/`green`

The deprecated overload types its 4th parameter as `BuildTailOptions`, which now
contains `fixFirst` and `green`. So
`buildTail(false, base, false, { fixFirst: true })` type-checks, and the
positional values silently win: `{ ...fourth, fixFirst: first, green: third }`.
Type the legacy overload's options as
`Omit<BuildTailOptions, "fixFirst" | "green">` so the conflict cannot be
written.

## ponytail-review: confirms the correctness findings; one lean nit

Traced every caller of `buildTail`, `implement` and `refactorBuildingPrompt`
(src, tests, docs). Runtime dispatch is right for each shape: a string first
argument selects the new `buildTail` form, `implement()` and
`implement(undefined, …)` both reach `{ reference: undefined }`, and `start()`
is a sync `string`, so the docs hotfix example selects the new form. No new bug
beyond the three correctness chunks above, which stand: they are the work left
(drop the `refactorBuildingPrompt` compat path, migrate the listed test and
`.feature` call sites, keep one pin per deprecated form, narrow the legacy
`buildTail` options type).

Lean (nit): `implementWith` (`src/workflows/feature/seam.ts`) and
`refactorBuildingPromptOf` (`src/workflows/shared/text.ts`) exist only so the
overload body can forward to them. Once the `refactorBuildingPrompt` overload is
deleted, `refactorBuildingPromptOf` collapses back into the one exported
function; `implement`'s implementation signature can normalise `first` into a
local and run `scope(...)` itself. About -6 lines, no behaviour change.

## conventions: the new public `buildTail(base, options)` form has no `@inmem` scenario

AGENTS.md, Testing: "create cucumber.js scenarios for each new feature, tagged
`@inmem`". `buildTail` is public API — exported from `@pmelab/gtd/workflows`
(`src/workflows/index.ts:27`) and called from a user's `gtd.config.ts`. This
change adds the object form `buildTail(base, { fixFirst, green, … })` and
documents it as the way to write a config (`docs/configuration.md` hotfix
example), but no `.feature` file anywhere calls it. Every config in
`tests/integration/features/*.feature` still uses the deprecated positional form
(`scope-access`, `conversational-review`, `workflow-module-reuse`,
`review-closing-signoff`, `judge-truncated-sections`,
`conversational-code-threads`, `review-triage-signoff`, …).

The sharpest case is `workflow-module-reuse.feature:22`. It is the scenario that
mirrors the documented hotfix example
(`afterTail(await buildTail(true, start()))`), and the doc now shows a different
call (`buildTail(start(), { fixFirst: true })`). So the documented config is the
one form no scenario runs, and dropping `fixFirst` in the new form's dispatch
would leave every scenario green.

Fix: switch `workflow-module-reuse.feature`'s hotfix config, and the other
`.feature` configs, to the object form so the documented call is exercised
through a real `gtd.config.ts`. Keep at most one `@inmem` scenario on the
deprecated positional form while it still ships. This is the `.feature` half of
the migration the correctness chunk asks for.
