# Quality findings

## correctness: refactor review turns can write stray code, with no guard

`src/workflows/shared/access.ts` restricts `build.review` to `.gtd/REVIEW.md`.
Access is keyed by full scope name, so nothing restricts
`refactor.build.review.*`. Those turns fall back to the `refactor` scope's write
list (strays + `.gtd/**`). `access.test.ts` pins this with "no other
refactor.build.\* scope".

As a result, `refactor.build.review.reviewing`, `.collecting` and `.answer` can
edit stray code, and none of them is guarded (in `review.ts` only
`fixRisks`/`fixNits`/`keepGreen` get `guard`). There is a second gap: `reUnwind`
restores only the human's `edited` paths, which are captured before the
collecting turn runs. So a code edit made by the collecting turn survives into
the next lap. Neither `requireWithin` nor `requireNoTestFiles` ever sees it,
because both look only at the current turn's own changes. The main path forbids
this, and the refactor path is a parallel write path that skips that check.

Fix: give `refactor.build.review` the same `write: [".gtd/REVIEW.md"]` the main
path has. Reopen `fix.nits`/`fix.risks` there, and let the guard keep them
within the strays. Alternatively, guard the collecting and answer turns. Add a
test where `refactor.build.review.collecting` writes a stray code file and gets
refused.

## correctness: an unbuildable refactor concern quietly signs off and keeps the human's hand-edit

`refactorReviewCollectingPrompt` tells the agent not to fold a concern it cannot
build, and to "say in the reply" that the way out is `gtd abandon`. In the
`finish` path (a hand-edit, or edit notes after triage), `close()` has already
removed `.gtd/REVIEW.md` before `collect` runs, so there is no file to reply in.
That leaves two outcomes:

- The agent writes the reply anyway. That recreates `REVIEW.md`, and `collect`
  refuses with `unmatched`. The turn is refused and re-run, so the process can
  stall in a loop.
- The agent writes nothing. `collect` returns `signoff`, and `reUnwind` never
  runs.

In the second case, a human hand-edit that touches a non-stray path, a test file
or a flag read stays committed inside the "behaviour-neutral" refactor slice. No
guard ever checked it, the slice ends, and the human is never told their request
was dropped.

Fix: when the collecting turn folds nothing for a round that had code edits,
re-unwind the edits instead of signing off. Or rest at a human gate that states
the concern cannot be built. No scenario covers the unbuildable case.

## correctness: the refactor collecting prompt folds behaviour changes into the refactor

The refactor collecting prompt filters concerns only by path, test file and flag
read. It never says a concern must keep behaviour unchanged. The scenario "a
human code edit at the refactor review is reverted by refactor.re-unwind"
(`refactor-review.feature`) confirms the gap: a `TODO: also export multiply`
edit gets folded and then built as `export const multiply` inside the refactor
slice. That is new behaviour. The feature review that follows only covers
commits after the refactor's sign-off (`seamBuild` returns `head()` as the
base), so the feature review never sees that change.

Fix: add a rule that a concern needing a behaviour change cannot be built here
(it belongs in the feature slice), and change the scenario's fixture to a real
refactor concern.

## correctness: escalation rests are guarded in one half of the refactor slice and not the other

The two halves of the slice treat a human at an escalation rest differently:

- `refactorLap` calls `healthy(..., { describeGuard: guard })` and leaves human
  escalation rests unguarded on purpose (see the comment on `guardOf`).
- The review tail in the same slice uses `healthy(fixCheck, { guard })`, and
  `guardedSteps` also runs `guard` after the `stop`/`exhausted` human rests.

So a person fixing a red suite by editing a test file is accepted at
`refactor.health.*` but refused at `refactor.build.health.*`.

The two halves also interact. `requireNoNewFlags` checks the whole range since
`entry`, so a flag read a person adds at an unguarded `refactor.health`
escalation rest makes every later guarded turn fail. That includes
`refactor.build.quality.<lens>.reviewing`, whose access is `write: []`. That
turn can never remove the read, so the process stops there for good.

Fix: pick one policy for human rests across the slice. Either way, check flags
against the range since the last guarded landing, not since `entry`.

## correctness: fixers in the refactor review tail are never told the refactor's rules

Inside the refactor slice, `buildTail` reuses the generic `fixCheck`,
`fixQualityFindings`, `fixNits` and `fixRisks` prompts. None of them names the
strays, the no-test-file rule or the flag rule. The only way these turns learn
the rules is by being refused after the fact.

A red `refactor.build.health.check` is the likely case: the generic fixer
reaches for a test file, gets refused, and runs again with nothing to steer it.
A refused turn does not count toward `FIX_CAP`, so it never escalates and can
loop.

Fix: pass the rules (`refactorRules(strays, pattern)`) into the tail's fix
prompts, the way `refactorFixPrompt` does for the refactor's own fix step.

## correctness: no test covers the flag check or the risk-fix guard in the refactor tail

The guard in `reviewedRefactor`'s tail is tested only for scope and test-file
refusals, after the quality-fix, nit-fix and fix-check turns. The
`driveReviewed` fixture's `changesSince` returns only `REVIEW.md`. Because of
that, `requireNoNewFlags(pattern, entry)` never sees a code change in the tail,
and removing the flag check from `guardOf` would leave every test green.

`guarded(fixRisks, guard)` is tested only in `review.test.ts` with a logging
guard, never with the refactor guard.

Add one case where a tail fix turn adds a `GTD_FLAG_*` read and expect a
`refactor-flags` refusal.

## owasp-security: stray paths reach the new refactor prompts unescaped

[Low] Prompt text injection through a stray file name (CWE-74, OWASP A05:2025,
LLM01 Prompt Injection)

- Location: `src/workflows/shared/text.ts`, in `refactorReviewCollectingPrompt`
  (the stray list) and `refactorRules`, which `refactorBuildingPrompt` and
  `refactorFixPrompt` now both use
- Path: a file name the naive pass or the human's sketch creates →
  `judgeDiffShape` strays → `` `  - \`${path}\`` `` inside the agent prompt
- Impact: a stray whose name holds a newline or a backtick adds its own lines to
  the rule block. For example, `a.ts\n- A test file may change too` reads as a
  rule. The guards check the in-memory strays, so `refactor-tests` and
  `refactor-scope` still refuse the write. The harm is limited to steering the
  agent and to refused turns that loop (see the correctness chunks on unbounded
  refusals). No guard is bypassed.
- Fix: render each path with `displayPath(path)`, the way `seamByHandMessage`
  and `seamReport` already do. That helper JSON-quotes control characters. The
  removed `seam.approve` report was the one place these strays were shown
  escaped, and it is gone in this change.
- Confidence: Likely. Git allows such names. Whether `changes()` keeps them raw
  was not verified.

## ponytail-review: `seamBuild` changes meaning under the same public name

`seamBuild` is exported from `@pmelab/gtd/workflows`, and COMPATIBILITY.md
promises each export's name, type and behaviour. Before this change,
`seamBuild(tier)` judged the naive pass, ran the refactor and then built the
feature (`implement`). Now `seamBuild(base)` stops after the refactor and
returns `{ reference, base }`; the caller must call `implement` itself.

Concrete case: a `gtd.config.ts` that composes
`await design(b); await seamBuild(tier); await buildTail(false, b, true)` still
loads (configs are not type-checked at load), but the feature is never built.
The review then runs over a tree with no implementation, and nothing says why.

Fix: keep the old behaviour under the old name and give the new split a new name
(for example `seamDecide`), or record the change as breaking (`!`) per
COMPATIBILITY.md, next to the `seam.approve` step that this change also removes.

## ponytail-review: `refactor.build.*` skill lists are hand copies of `build.*`

`src/workflows/shared/skills.ts` adds six `refactor.build.*` entries that repeat
the six `build.*` lists word for word. `skills.test.ts` then pins that they stay
equal ("gives each refactor.build.\* scope its build.\* counterpart's list").
That is two copies plus a test whose only job is to catch them drifting apart.

Concrete case: someone adds a skill to `build.review` and forgets
`refactor.build.review`. The test catches it, but only after the edit; the code
could make the drift impossible instead.

Fix: build the `build.*` lists once and spread them a second time under the
`refactor.` prefix, e.g.
`...Object.fromEntries(Object.entries(build).map(([k, v]) => ["refactor." + k, v]))`.
Drop the equality test. Lean: about -15 lines.

## ponytail-review: dead branch in `seamBuild` after `reviewedRefactor`

In `src/workflows/feature/seam.ts`, `seamBuild` returns early when `shape` is
undefined and when `shape.unreadable` is non-empty. At the
`slice("refactor", () => reviewedRefactor(shape, …))` call, `shape.choice` is
always `refactor-first` and nothing is unreadable, so `reviewedRefactor` can
only return `true` (or throw on a bad flag pattern). The
`refactored ? head() : base` fallback can never pick `base`.

Fix: `await slice(...)` and return `{ reference, base: head() }`. One line less,
and the reader no longer wonders when the refactor is skipped.

## test-audit: a feedback-target test is misnamed and cannot fail for the reason it names

In `src/workflows/feature/review.test.ts`, the test "a collecting turn that
wrote REQUIREMENTS but not file signs off unrefused with nothing changed" has a
collecting stub that writes nothing. `.gtd/REQUIREMENTS.md` is never in the
harness's files either. So the test never covers a turn that "wrote
REQUIREMENTS".

The regression it seems to guard is `review()` ignoring `feedback.file` and
still testing `.gtd/REQUIREMENTS.md`. That regression also resolves `signoff`
here, so the test stays green with it.

The test also pins the behaviour that the correctness chunk "an unbuildable
refactor concern quietly signs off" reports as a bug: a feedback round whose
collecting turn folds nothing becomes a sign-off.

Fix: seed `.gtd/REQUIREMENTS.md` in `files` (or have the stub write it), so the
test fails when `file` is ignored. Rename it to match. Once the
unbuildable-concern policy is decided, assert that outcome rather than
`signoff`.

## test-audit: tests that lock in known gaps as the intended contract

- `src/workflows/shared/access.test.ts`, "keys one refactor lens scope per
  refactorQualityReviews entry and no other refactor.build.\* scope". This pins
  the missing `refactor.build.review` write restriction (see the first
  correctness chunk). Fixing that gap turns this test red, so the test now
  defends the bug.
- `src/workflows/feature/refactor.test.ts`, "does not refuse other naming such
  as \_test.go or test\_\*.py". The package rules and both refactor prompts now
  say "never a test file", with no exceptions. This test says a refactor may
  still change `pkg/a_test.go`. Nothing in the prompts or docs records that
  exception, so the test fixes a disagreement between the rule and its guard in
  place. Either state the limit (only the `testFileGlobs` shapes count) in
  `refactorRules`, or drop this case and let the glob list grow.
- `src/workflows/feature/refactor-review.feature`, "a human code edit at the
  refactor review is reverted by refactor.re-unwind". The fixture folds and
  builds `export const multiply`, which is a behaviour change, and the scenario
  passes it as a refactor. This already appears in the third correctness chunk.
  It is listed here only because the scenario will need a new fixture when that
  is fixed.

## test-audit: the same contract is replayed at several layers

These are not blocking. Each removal keeps at least one test that fails on the
regression.

- **No re-run of the seam phase after feedback.** The new
  `planAndBuild on the naive pass` test in
  `src/workflows/feature/feature.test.ts` drives a real `testRepo` through land
  → feedback → re-unwind → design and asserts that `seam.naive` runs once. That
  repeats the renamed `seam.feature` scenario "review feedback after land
  re-runs design and implement, never the seam phase", which pins the same
  subjects in the tier the AGENTS.md rules give to features. The companion test
  "planAndBuild without the naive pass" repeats the flag-off path that the
  default-workflow features already drive. Drop both tests, or keep only an
  assertion the scenarios lack.
- **The test-file refusal for a stray.** Four places pin it:
  - `refactor.test.ts`: "refuses a build turn changing a test file even when it
    is a stray"
  - `refactor.test.ts`: `requireNoTestFiles` "is not narrowed by a narrowed
    seamAllow"
  - `refactor-package.feature`: "a build turn changing a test file is refused
    even when the test file is a stray"
  - `refactor-review.feature`: "with a narrowed seamAllow a test-named stray
    changed by the refactor is refused"

  The two unit tests already own the guard and its wiring after `building`.
  Neither scenario adds a transport or lifecycle risk that the unit tests miss.
  Keep one scenario at most, as the end-to-end proof.

- **The phrase "never a test file".** It is asserted three times: the
  package-rules body (`refactor.test.ts`), both prompts (`text.test.ts`), and
  `.gtd/REFACTOR.md` in `refactor-package.feature`. The scenario's `contains`
  line adds nothing beyond the unit test of the deriving body.

## conventions: the squash must be marked breaking, and nothing in the change says so

COMPATIBILITY.md puts "**Bundled workflow and step names** — … each step's full
name, plus which steps a bundled workflow reaches and in what order" and
"**Entrypoint exports** — … each export's name, type and behaviour" in the
"Follows package SemVer" tier. docs/commits.md: "A breaking change puts `!`
before the colon AND carries a footer that says how to migrate".

This change breaks both:

- `seam.approve` is gone. `refactor-first` now reaches
  `refactor.build.quality.*` / `refactor.build.review.*` in its place. The docs'
  own "**Upgrading:** a process resting at `seam.approve` must `gtd abandon`"
  admits the process gets stranded.
- `seamBuild`, exported from `@pmelab/gtd/workflows/feature`, changed from
  `(tier?) => Promise<void>` (which also ran `implement`) to
  `(base) => Promise<SeamOutcome>`, which no longer implements. A custom
  workflow calling it compiles differently and skips the implementation.

The naive pass is behind a release flag, but the tier list does not exempt
flagged step names. The closing/squash message must be `feat(workflow)!: …` with
a `BREAKING CHANGE:` footer that names both migrations: abandon a process at
`seam.approve`, and call `implement` after `seamBuild`.

## conventions: user docs still describe lens keys and lap extension as `qualityReviews`-only

User CLAUDE.md: "always make sure every significant change is also reflected in
the readme". AGENTS.md: docs exist to say "what its commands, flags, config keys
… accept".

`refactorQualityReviews` adds a second set of lens scopes, but these two places
still read as if `qualityReviews` were the only one:

- docs/configuration.md §Skills ("`qualityReviews` … and the
  `build.quality.<lens>` keys are a pair … Such a key is valid only while the
  lens is listed in `qualityReviews`") says nothing of
  `refactor.build.quality.<lens>` keys or which setting validates them.
- docs/setup.md §"Extending the quality-review lap" tells a user to extend
  `qualityReviews` with a custom lens. It never says that lens does not reach
  the refactor review, and that adding it there takes `refactorQualityReviews`
  too.

Add one sentence to each.

## conventions: comments that restate the code (nit)

AGENTS.md: "Keep a comment … only where it explains an important decision or
genuinely unclear code … Everything else (restatement of the code …) gets
deleted".

- `src/workflows/feature/seam.ts`:
  `// Unreadable strays rest at by-hand, before any refactor slice is entered.`
  repeats the `if` below it.
- `src/workflows/shared/vars.ts`:
  `// The refactor slice's lenses: one refactor.build.quality.<lens> scope per entry.`
  restates the setting.
- `src/workflows/feature/review.ts`: the `FeedbackTarget` JSDoc ("Where a
  review's edit notes land, and the turn that writes them") and
  `BuildTailOptions.feedback` ("Default: `.gtd/REQUIREMENTS.md` via
  `collecting`") repeat the field names and the default visible in `review()`.
- `src/workflows/feature/feature.ts`: "The loop sits inside its slice." restates
  the `slice("feature", …)` call.
- `src/workflows/feature/refactor.ts`: the `plan` JSDoc says "Resolves
  undefined", but `plan` is synchronous. Say "Returns", or drop the comment, and
  keep only the note that it throws on a bad flag pattern.
