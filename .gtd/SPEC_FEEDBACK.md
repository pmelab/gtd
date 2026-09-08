# Spec feedback: 03 — the client opens on the step

The previous round's defect is fixed: `App.stories.tsx`'s story is renamed
`ReviewModeOpensDirectlyOnTheReviewScreen`, and no `Fleet` reference survives in
`src/`. Re-verified this round: `apply` is a mandatory member with radio / hunk
/ chunk semantics and `anchor-not-found` refusals, `writeValue` reuses
`verifyForWrite` and adds no `WriteRefusalReason`, `setValue` takes no
`worktreePath` and throws the same `WriteNoteRefusal` `api.ts#writeRefusalFrom`
already reads, `App.tsx` holds no navigation state, both `HandedBackPanel`s are
terminal, the chunk check-all is exactly one `setValue` call at the chunk
anchor, the on-disk scenario and both reload-survival stories exist, and
`npm test` is green across all 10 turbo tasks (92 storybook tests pass).

One defect.

## A free-text answer is written raw, so any whitespace or newline in it reds `format:check`

`src/web/screens/Question.tsx:268`

`commitFreeText` sends `text: freeText` — the textarea's raw value — while the
same function's guard one line above, and the `answered` predicate at line 303,
both run it through `normalizeAnswerText`. The write is the one path that
doesn't. `QA_FORMAT.apply` then splices that raw string over the option's label
span verbatim (confirmed: `apply` produces a single `newText` edit carrying the
string unchanged), so the human's own keystrokes land byte-for-byte on a
`- [x] ` list-item line in `.gtd/PLAN.md`.

Two shapes a phone user produces trivially both leave that file a non-oxfmt
fixed point, which AGENTS.md's `.gtd/` rule says reds `start-gate`,
`review-gate` and `fix-precheck` alike:

- trailing whitespace — `- [x] my answer   ` → `oxfmt --check` exits 1
- a newline typed in the textarea — `- [x] line one\nline two` → `oxfmt --check`
  exits 1

The trimmed single-line form (`- [x] my answer`) IS a fixed point, so the answer
content itself is never the problem — only the un-normalized bytes are.
`QA_FORMAT.validate` returns zero findings on both broken shapes, so nothing
catches this before the gate does.

Neither the requirement nor T3's own bullets mention sanitizing, but the human
answering on the phone is exactly the actor who cannot fix the file afterward,
and the failure is silent at write time.

Two candidate sites — pick one, don't split the rule across both:

- `Question.tsx:268`, sending the same normalized value the predicate already
  computes (collapsing interior newlines, not just trimming —
  `normalizeAnswerText` only trims today, so it does not by itself fix the
  multi-line case)
- `OpenQuestions.ts#questionsApply`, collapsing `opts.text` to one line before
  building `replaceOptionTextEdit` — server-side, so any client gets the guard

Whichever site takes it needs a test that pins the multi-line and
trailing-whitespace inputs specifically; the existing free-text stories all
commit clean single-line text.
