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
