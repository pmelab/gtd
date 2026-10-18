# Quality findings

## correctness: refactor collecting prompt still promises a sign-off the `dropped` refusal now forbids

`src/workflows/shared/text.ts` `buildReviewCollectingPrompt` (refactor
`actionable` block) still tells the agent "If actionable and a concern can be
built: write `.gtd/REFACTOR.md` … If not: finish without writing anything —
changing nothing is the sign-off". But `reviewedRefactor` now sets
`dropped: t.refactorDroppedRefusal`, and `collect` in
`src/workflow-kit/review.ts` refuses every empty landing on the two paths that
pass a `Requested` (the `edit`-note path in `routeNotes`, and the hand-edit path
in `finish`, whose `paths` is never empty). So the prompt's "not actionable /
nothing buildable → change nothing" branch, followed exactly, is always refused
there, and the refusal names `gtd abandon` (throwing away the naive pass,
refactor and review) as the only way out. An agent following the prompt cannot
reach the sign-off it was promised; e.g. a whitespace-only or throwaway
hand-edit (`isCodeEdit` counts any non-thread diff), which the prompt invites
the agent to judge as approval, now forces an abandon where it used to sign off.
Fix: make the refactor block say plainly that a round with an edit note or a
hand-edit must write `.gtd/REFACTOR.md` (or the landing is refused), and keep
"changing nothing is the sign-off" only for the note-without-requested-change
case — or drop `paths` from the hand-edit `Requested` when the agent may judge
the edit non-actionable.

## correctness: a partly unbuildable round drops concerns silently; the doc comment claims they are refused

`buildReviewCollectingPrompt`'s doc comment says "a concern outside the fence is
refused at landing, so the prompt only says not to fold it". That holds only
when the collecting turn writes nothing at all: `collect` returns `"feedback"`
as soon as `read(p.feedback) !== undefined`. A round with two `edit` notes, one
buildable and one outside the strays fence, writes `.gtd/REFACTOR.md` with only
the first, lands, and the second concern vanishes with no refusal and no reply.
The change also removed the old prompt line "Say in the reply that the way out
is `gtd abandon` and a restart", so the human no longer gets any signal that a
note was dropped. Either correct the comment (and accept the silent drop
deliberately), or have the refactor target compare the folded concerns against
`Requested` / keep the reply instruction so a partial drop surfaces.

## correctness: hand-edit `Requested.notes` lists every note, not the `edit` notes its type promises

`Requested` is documented as "the `edit` notes it carried and the code paths the
human hand-edited", but `finish` builds it as
`{ notes, paths: edited.map(...) }` with
`notes = reviewNotes(baselineText, record)` — every note of the round, before
triage, praise and questions included. `refactorDroppedRefusal` then lists a
praise note ("looks good") under "the refactor review asked for a change".
Nit-level, but the refusal text misstates what the human asked for. Filter or
relabel (e.g. list them as "notes on this round"), or fix the interface comment.

## correctness (nit): `demoteHeadings` does not nest an h1, and toggles fences across marker types

`src/workflows/feature/refactor.ts` `demoteHeadings`: the comment says every
heading "drops a level" so it nests under `## Review feedback`, but a collected
`# X` becomes `## X`, a sibling of `## Review feedback`, not a child — the
derived package then reads the collected concerns as a new top-level section
after the feedback. Shift by `max(1, 3 - minLevel)` (or always map to `### +`)
if nesting is the invariant. Separately, the fence toggle matches either marker
(`/^\s*(```|~~~)/`), so a `~~~` line inside a ` ``` ` block flips state and the
headings after it are left undemoted (or a `#` line inside code is demoted).
Track the opening marker. Tests cover `##`/`###` input only, so neither case is
pinned.

## owasp-security: on `refactor-first` the refactor's diff now escapes the security lens by default

`lensBase` narrows the feature slice's quality lap to `seam.base`, which on
`refactor-first` is `head()` after the refactor's sign-off
(`src/workflows/feature/seam.ts` `seamBuild`), so the feature lap no longer sees
the refactor's commits. The refactor's own lap covers them, but only through
`refactorQualityReviews`, whose default
(`correctness, ponytail-review, conventions` in `src/workflows/shared/vars.ts`)
has no `owasp-security` (nor `test-audit`, `spec-challenge`). Before this change
the feature lap ran from `start()` and reviewed the refactor's diff through
every `qualityReviews` lens. With defaults, a refactor that changes a stray's
escaping, validation or auth helper is never reviewed by the security lens; only
the human refactor review sees it. The behaviour-neutral fence and the flag
count do not substitute: they bound which files change and how many flag reads
there are, not whether a rewritten sanitiser still sanitises. Low (lost review
coverage, no direct exploit path). Fix: add `owasp-security` to the
`refactorQualityReviews` default, or keep the feature lap's base at `start()`
for lenses not in `refactorQualityReviews`. And say in `docs/configuration.md`
that a lens left out of `refactorQualityReviews` never sees the refactor. No
test pins the gap: the new lens-base tests check only that the base is
`c0`/`seam.base`, not which lenses cover the refactor range.

## owasp-security (low): refactor fix scopes pass raw stray paths as write globs; a test pins the widening

`fixAccess: { write: [...p.strays, ".gtd/**"] }`
(`src/workflows/feature/refactor.ts` `reviewedRefactor`) feeds stray paths
straight into the access globs. A stray whose name has glob metacharacters (the
new scenario "a nit fix in the refactor slice that changes a non-stray is
refused, though a glob stray widens the write access" uses a file named
`src/*.ts`) gives the nit and risk fix turns a `next --json` `access.write` that
covers every `src/*.ts`. The literal `requireWithin(strays)` guard still refuses
the landing (the scenario shows `refactor-scope`), so this is not exploitable in
gtd. But a driver that sandboxes the agent by `access.write` lets it write files
gtd later rejects, and the scenario asserts the wide glob is advertised
(`contains "src/*.ts"`) instead of the literal path. Same root as the existing
`refactor` scope entry. This change made fix turns tighter overall: they were
`{}` (unrestricted) before. Fix: glob-escape each stray when building `access`
(`[`, `]`, `*`, `?`, `{`, `}`, `!`), and make the scenario assert the escaped
literal.

## ponytail-review (lean): `fixNits` / `fixRisks` branch on `access` for nothing, and the refactor builds its write list twice

`fixNits` (`src/workflows/feature/steps.ts`) and `fixRisks`
(`src/workflows/shared/steps.ts`) each wrap the agent call in a closure and pick
`fixing("review.fix.nits.fixing")` when `access` is undefined, else
`scope({ name: "review.fix.nits", access }, () => fixing("fixing"))`. Both
branches give the same full step name and the same memory scope (`memoryScopeOf`
reads the full name), and `ScopeOptions.access` already takes `undefined`, which
sets no own access, so resolution falls to the bundled `build.review.fix.nits` /
`.risks` entry exactly as the unscoped call does. Fix: always call
`scope({ name: "review.fix.nits", access }, () => t.agentWithSkills("fixing", …))`
(same for risks) and drop the closure and ternary — about 8 lines across both,
and one code path for the existing `review.test.ts` / `refactor.test.ts`
step-name and scope assertions to pin. Separately, `reviewedRefactor`
(`src/workflows/feature/refactor.ts`) spells
`{ write: [...p.strays, ".gtd/**"] }` twice (the `refactor` scope and
`fixAccess`); they must change together, so bind it once.

## test-audit: fix-access tests pin the `access === undefined` ternary, not the resolved access

`src/workflows/feature/review.test.ts` "without fixAccess the fix turns open no
scope" and `src/workflows/feature/steps.test.ts` "fixNits with access runs in a
review.fix.nits scope, the step named fixing inside it" check how `scope()` is
called, through a fake `pushScope`. The resolved access and full step name are
what count. The ponytail finding's fix (always open the scope, passing `access`
through when it is undefined) changes no behaviour, yet it breaks the "opens no
scope" test. That is an implementation-shape assertion. The real owner is the
scenario "the nit-fix turn in the refactor slice may write the strays and
.gtd/** only". It reads `next --json=access.write` and fails if `fixAccess` is
dropped, because the step then inherits `refactor.build.review`'s
`.gtd/REVIEW.md`. `refactor.test.ts` "runs the nit-fix turn under the strays…"
also covers it. Delete the "opens no scope" test and the `steps.test.ts` one.
`fixRisks`' access has no real-boundary proof. Only the `review.test.ts`
`fixAccess` scope-list test covers it. Add a refactor-slice risk-fix scenario
that asserts `access.write`, then cut that unit test down to the step names.
Separately, nothing backs "only" in that scenario's name. It asserts just two
`contains`.

## test-audit: `lensBase` threading is replayed at every layer it crosses

The contract "each slice's lap reviews from its own base" has a strong owner:
the `@inmem` scenario "each slice's quality lap reviews from that slice's base,
before and after a feature feedback lap". It pins `entry` in the refactor slice,
and `seam.base` in the feature slice before and after `featureFeedback`. The
other owner is `text.test.ts` "reviews from a given base and still names the
process start", which pins the prompt bytes. The same pass-through is asserted
again in `tail.test.ts` (both new `lensBase` cases), in `review.test.ts`
`describe("BuildTailOptions.lensBase")` (two cases plus a bespoke context) and
in `refactor.test.ts` "names the entry commit in every lens prompt…". Each is
pure plumbing that the scenario already fails on. Delete them. `tail.test.ts`
also adds a module-level mutable `prompts` array shared across the `describe`,
which goes away with them. The `text.test.ts` spec-challenge case only asserts
that a constant contains its own literal (`git log <start>..HEAD`), plus a
`started at` line the previous case already pins. Drop it too.

## test-audit: "a feature review edit note collected to nothing signs off" never reaches the feature target

`src/workflows/feature/review.test.ts` passes its own `options.feedback`
(`file: REQUIREMENTS`, no `dropped`). So it tests the same thing as the test
right above it ("a collecting turn that wrote REQUIREMENTS but not file signs
off…") and the kit test "signs off when no dropped refusal is set". It would
still pass if the default feature target in `review()` gained a `dropped`
refusal, which is the regression its name claims to guard. Fix: drive the
default target (no `options.feedback`), overriding the harness's
`review.collecting` effect to write nothing. Or delete the test as a duplicate.

## test-audit (low): duplicate contracts

- `src/workflows/shared/access.test.ts` "leaves the refactor review's fix scopes
  to the refactor's own scope option" restates the exact-map `toEqual` inventory
  right above it, which already fails if either key comes back. Delete it.
- `src/workflows/feature/feature.test.ts` "flag_naive_pass=1 rests at
  design.triage, then implement.building…" and
  `tests/integration/features/workflow-module-reuse.feature` "with the naive
  pass on, afterTail's feedback lap is design → implement, never the seam" own
  the same contract. Keep the scenario, which also proves the published
  `@pmelab/gtd/workflows` import, and keep the unit file's `flag_naive_pass=0`
  case. Drop the unit `=1` case.

## test-audit (low): earlier findings have no test that would catch them

- No test checks the refactor collecting prompt against
  `refactorDroppedRefusal`. The `text.test.ts` refactor-prompt block does not
  assert what the prompt says about an edit-note or hand-edit round that writes
  nothing. This is the correctness contradiction above, and it would have caught
  it.
- The hand-edit scenario "a code hand-edit the collecting turn leaves out…" has
  no review notes. So nothing covers `Requested.notes` carrying praise or
  question notes into the refusal.
- `collect`'s `requested.notes.length + requested.paths.length > 0` guard is
  never tested with an empty `Requested`. Neither caller can build one, so the
  branch is dead or unpinned.
- `refactor.test.ts` covers `demoteHeadings` with `##`/`###` input only (see the
  correctness nit).

The golden `__fixtures__/feature-collecting-prompt.txt` is a legitimate pin.
Rendering `buildReviewCollectingPrompt` at `28cddd15` gives exactly this text,
so the merged prompt kept the feature bytes. It was not generated from the
subject under test.

## conventions: README not updated for the refactor-review refusal

Rule broken (`~/.claude/CLAUDE.md`): "always make sure every significant change
is also reflected in the readme". The change makes a refactor-review round that
carries an `edit` note or a code hand-edit, and whose collecting turn writes
nothing, impossible to sign off. `gtd land` refuses it (`refactor-feedback`),
and the only way out is `gtd abandon`. That is a user-visible behaviour change
with a costly recovery, and it is only in `docs/configuration.md`. The README's
naive-pass paragraph still says just "feedback at the refactor review re-runs
the refactor, never design". Also missing there: each slice's quality lap now
reviews only its own slice. Fix: add one sentence to that README paragraph
saying a refactor-review change the refactor cannot build is refused and means
`gtd abandon`, and that each slice's quality lap covers only that slice.

## conventions (nit): new comments that only restate the code

Rule broken (`AGENTS.md` § Comments): "Keep a comment … only where it explains
an important decision or genuinely unclear code … Everything else (restatement
of the code …) gets deleted, not moved."

- `src/workflows/shared/text.ts` `buildQualityReviewingPrompt`:
  ``/** Reviews from `base` (default `start()`) to the working tree. */``
  repeats the signature's default and the prompt text.
- `src/workflows/shared/text.ts` `refactorDroppedRefusal`: its JSDoc repeats the
  name and the string it returns.
- `src/workflows/feature/review.ts` `FeedbackTarget.dropped`: its JSDoc copies
  `ReviewPolicy.refusals.dropped`'s comment in `src/workflow-kit/review.ts`.
  Keep one of the two.
- Test-side restatements: `/** The collecting turn writes no package. */` and
  `/** Every scope opened, in order. */` (added in the feature `*.test.ts`
  files).

Delete them. The comment on `buildReviewCollectingPrompt` is worse: it states an
invariant that does not hold, so it is a wrong comment rather than a redundant
one (see the correctness finding on partly unbuildable rounds). The comment on
`afterTail` ("Opens no slice: slices cannot nest") and the one on
`demoteHeadings` explain decisions and are fine.

## spec-challenge: "spec-challenge looks up planning docs from the process start" is not what the brief says once the lap base moves

Decision (ARCHITECTURE `buildQualityReviewingPrompt`, package 04): the lens
prompt reviews from `base` and "names the process start beside `base`", so
`specChallengeBrief` keeps finding planning documents from the process start,
because `design.triage` lands before the slice base. Invariant it breaks: the
brief tells the agent to look things up with `git log <start>..HEAD`, where
"`<start>` is the commit above". In the new prompt the first commit named, the
one in "Review the whole assembled change, from `<base>`", is the slice base.
The process start appears only in a parenthesis after it. On `refactor-first`
the feature lap's base is `seam.base` (`head()` after the refactor sign-off,
`src/workflows/feature/seam.ts`), which is later than `design.triage`'s
`.gtd/REQUIREMENTS.md`. So an agent that reads "the commit above" as the review
base finds no planning documents, and then by the brief's last line "write
nothing", which is a silent approval. `spec-challenge` is in the default
`qualityReviews`, so this hits every default naive `refactor-first` run. The
`text.test.ts` case "the spec-challenge brief looks up planning documents from
the process start" only checks that the constant contains
`git log <start>..HEAD` and that a `started at` line exists. It would still pass
with this ambiguity. Fix: put the process-start SHA into the brief itself (make
`specChallengeBrief` a function of `start()`, or have the brief say "the process
start named in parentheses above, not the review base"), and have the test
assert the start SHA appears in the `git log` line.

## spec-challenge: the shared collecting prompt keeps "reply inside `.gtd/REVIEW.md` — the file stays in the tree", though the round has already closed it

Decision (concern 6 / package 05): one collecting prompt, with the feature
variant byte-identical to before (pinned by
`__fixtures__/feature-collecting-prompt.txt`). The refactor variant drops only
the "say in the reply" line, "because the round closes that file before
collecting runs" (REQUIREMENTS concern 1). Invariant: that premise is true for
every collecting path. `routeNotes`' edits branch calls `r.close()` and
`finish`'s `collectWith` calls `close()` before `collect`
(`src/workflow-kit/review.ts`), and `closeReview`
(`src/workflows/shared/tail.ts`) removes `.gtd/REVIEW.md` and
`.gtd/REVIEW.orig.md`. Yet both variants still say "replies inside
`.gtd/REVIEW.md` (thread replies only; the file stays in the tree)", "delete the
folded threads from `.gtd/REVIEW.md`", "append one `- A:` reply to each
thread…", and "Finish by running `gtd check review .gtd/REVIEW.md`". On the
refactor path this is now harmful, not just stale. An agent that follows it and
recreates `.gtd/REVIEW.md` to append a reply (allowed: the
`refactor.build.review` access is `.gtd/REVIEW.md`), but cannot build the
concern, changes a file without writing `.gtd/REFACTOR.md`. That gets the
`unmatched` refusal ("revert the change, or `gtd abandon`") instead of the new
`dropped` one, so the human never sees which notes were left out. The spec made
this one-line exception on that premise, but the golden fixture pins the
contradiction for the feature variant and nothing checks the refactor variant
against it. Fix: drop the REVIEW.md-reply, delete-threads and `gtd check review`
lines from the refactor variant at least, and decide deliberately whether the
feature golden should keep them. Or else correct the premise in the spec.
