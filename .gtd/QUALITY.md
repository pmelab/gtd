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
