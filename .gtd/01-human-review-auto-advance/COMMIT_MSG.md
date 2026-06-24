fix(gtd): make human-review auto-advance for a clean REVIEW.md baseline

`human-review` was the lone producer leaf declared `type: "final"` with no
`auto-advance` tag, so it STOPped with `REVIEW.md` uncommitted plus a
`.gtd-commit-intent` marker and deferred the commit to the next run's edge. The
human edited `REVIEW.md` during that gate window, and the edge then committed it
WITH the edits baked into the `review(gtd): create review …` commit — leaving an
empty working-vs-committed diff that made the review detection misfire and lost
the feedback.

Give the `human-review` leaf `tags: ["auto-advance"]` so it re-runs gtd within
the same agent session; the existing `commit-pending` edge then commits
`REVIEW.md` CLEAN (`restorePaths: []`) before the human can touch it, and the
re-resolution lands on the `await-review` human gate. This makes review
structurally identical to the planning flow (`new-todo`/`modified-todo` →
edge commit → gate). No new machine logic — just the tag.

Flips the `Machine.test.ts` human-review assertion to `autoAdvance: true`,
replaces the prompt's closing STOP paragraph with the precedent re-run-gtd
instruction, inverts the `auto-advance.feature` STOP scenario, and updates the
README leaf table + mermaid decision tree (human-review is no longer a terminal
STOP; `await-review` is the human gate).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
