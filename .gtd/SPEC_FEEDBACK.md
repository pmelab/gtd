# Spec feedback — 01-worktree-head-token

Tasks 1–4 and most of Task 5 conform: `commonGitDir` resolution, the
`head-unresolved` read refusal, the named read-refusal sentences, the single
`moved: "sha"` retry and its wiring, and the `Try again` banner are all
implemented and tested. `test:unit` (2103 passed), `test:web` (114 passed),
`format:check`, `lint` and `tsc --noEmit` are green.

One Task 5 acceptance criterion is unmet.

## Task 5 — the three pinned `Question.stories.tsx` assertions were not moved

The criterion: "`Question.stories.tsx` lines 591, 622 and 697 assert the new
text and still prove the banner appears for a genuine content-hash change."

All three refusals are still `{ reason: "stale-token", moved: "sha" }`
(`src/web/screens/Question.stories.tsx` lines 582, 613 and 658), and all three
assertions still read
`toHaveTextContent("Someone else committed a change underneath you")` (lines
590, 621, 696).

Two concrete problems:

- That substring is byte-identical to the OLD sha sentence's opening, so the
  assertions do not pin the new text at all. Reverting
  `Refusal.tsx#messageFor`'s sha branch to
  `"… — reload to see the latest before trying again."` leaves every one of
  these three stories green. The regression the spec asked these lines to catch
  is uncaught.
- None of the three exercises a content-hash refusal, which is what the spec
  named as the thing that must stay pinned ("What is pinned is that a genuine
  `content-hash` change still shows the banner"). Coverage of the banner for a
  genuine concurrent edit exists only in `Plan.stories.tsx`, not here.

Fix: switch those three refusals to `moved: "content-hash"` and assert the new
content-hash sentence ("The file's content changed underneath you"), plus a
`not.toHaveTextContent("reload")` check as `Plan.stories.tsx:627` already does.
If one of the three is genuinely about the post-retry sha path, keep it on `sha`
but assert the distinctive tail ("the automatic retry still didn't land"), not
the shared prefix.
