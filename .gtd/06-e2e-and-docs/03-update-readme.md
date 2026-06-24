# Update README for markerless, edge-driven review-process + `review-incomplete`

Reflect the new model in `README.md`: drop every `!!` reference, add the
`review-incomplete` leaf, and describe review-process as edge-driven.

## What to do (`README.md`)

1. **State table** (~lines 56–71):
   - `close-review` row (~line 59): drop the `**and no `!!` comment**` clause.
     New "when it wins": `REVIEW.md` dirty, ALL boxes ticked, and no other change
     (no non-tick REVIEW.md edits, no dirty source, no untracked files).
   - `review-process` row (~line 61): drop the `!!` mention. New "when it wins":
     `REVIEW.md` dirty, all boxes ticked, AND real feedback present (non-tick
     REVIEW.md edits, dirty source, or untracked files). New prompt description:
     the EDGE records the verbatim tree, captures the diff, reverts, removes
     `REVIEW.md`, and closes; the agent only synthesizes `TODO.md` from the
     injected diff. (No "reference commit x / git revert" agent steps.)
   - ADD a `review-incomplete` row: when it wins = `REVIEW.md` dirty but at least
     one box is still unchecked (gates BEFORE the feedback check). Prompt = human
     gate: review everything and tick all boxes, then **STOP** (exit 0).
   - Keep `await-review` row, but make clear it is "nothing touched yet" vs
     `review-incomplete` = "started but boxes left unchecked".

2. **Replace the `> **`!!` follow-up comments**…` prose block** (~lines 109–120)
   with an "any change is feedback" block:
   - There is no marker convention. Any human-review working-tree change is
     feedback. Taxonomy: REVIEW.md prose = **global** feedback; source comments =
     **local** feedback; source code changes = **suggestions** to verify, not
     apply verbatim.
   - Unchecked boxes gate first → `review-incomplete`. All ticked + no other
     change → `close-review`. All ticked + real feedback → `review-process`.
   - `review-process` is EDGE-DRIVEN: the gtd process commits the verbatim tree
     (`docs(review): record raw feedback for <base>`), captures the diff in
     memory, `git revert`s it, removes `REVIEW.md`, and closes
     (`chore(gtd): close approved review for <short-sha>`) — all before the agent
     runs. The agent only turns the injected diff into `TODO.md`. On revert
     conflict the edge aborts and exits 1. Recovery: `git show <record-sha>`.
   - Keep the note that `reviewPresent` suppresses `code-changes` (source edits
     arrive uncommitted and are folded into the verbatim record commit).

3. **Mermaid diagram** (~lines 193–221):
   - Relabel `Resolve -->|REVIEW.md ticks only, no !!|` to `|REVIEW.md all boxes
     ticked, no other change|`.
   - Relabel the `review-process` edge/node: `|all ticked + real feedback|` and a
     node describing the EDGE flow (record → capture diff → revert → close →
     agent synthesizes TODO.md). Drop the `no !!` / `approved + !!` labels.
   - ADD a `review-incomplete` node + edge: `|REVIEW.md dirty, unchecked box
     remains| ReviewIncomplete[review-incomplete: human gate]:::terminal`.
   - Ensure ordering reads `await-review` (unmodified) vs `review-incomplete`
     (unchecked) vs `close-review` (ticked, no change) vs `review-process`
     (ticked + feedback).

4. **Prose "A typical feature" step 9** (~lines 261–267): drop "drop `!!`
   comments"; describe the markerless taxonomy and that `review-process` is now
   edge-driven (agent only synthesizes `TODO.md`). Remove the "reference commit x
   / git reverts x" agent-side description, replacing with the edge description.

5. Grep the whole README for any remaining `!!` and remove/replace each.

## Acceptance criteria

- [ ] No `!!` reference anywhere in `README.md`.
- [ ] `review-incomplete` row + mermaid node/edge added.
- [ ] `close-review` / `review-process` table rows + mermaid labels reflect the
      markerless, edge-driven model.
- [ ] Prose section replaced with the "any change is feedback" + global/local/
      suggestion taxonomy and edge-driven description.

## Files

- `README.md`

## Constraints

- File-disjoint from both e2e tasks in this package.
- Per global instructions, the README must reflect every significant change —
  this task is that reflection for the whole work stream.
