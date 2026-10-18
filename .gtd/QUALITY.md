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
