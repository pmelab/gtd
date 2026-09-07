# Spec feedback — 02 Worktree discovery and the fleet screen

Implementation is sound and all 80 `src/serve/` unit tests pass. Two acceptance
checkboxes have no test behind them.

## 1. T2 — "the spawned read never mutates the worktree" is unasserted

`src/serve/Beat.test.ts` scripts every `run` call as a fake, so nothing in the
suite ever proves the real read is read-only. There is no test anywhere — unit,
story, or `tests/integration/features/serve.feature` — that runs a beat read
against a real worktree and checks HEAD, the ref set, and the working tree are
unchanged afterwards.

This matters because `liveRunInWorktree` is `bash -c <command>` with the
worktree as cwd: the four commands it issues today (`gtd next --json` plus three
`git rev-parse`/`git log` reads) are read-only by inspection only. Add a test
that snapshots `git rev-parse HEAD`, `git show-ref`, and
`git status --porcelain` before and after one live `BeatCache.read`, and asserts
all three identical.

## 2. T6 — "a row shows repository, branch, label and rest age" is unasserted

`src/web/screens/Fleet.stories.tsx` renders rows in five stories but never
asserts a row's own content. `AllFourBuckets` checks only the four bucket
headings; `QuietCollapsesBehindItsCount` incidentally matches the label text
`"reviewing a PR"`. Repository, branch, and the rest-age string that `restAge()`
computes ("5m", "3h", "2d") are never checked by any story.

Add assertions to a story rendering
`okRow({ repo: "gtd", branch: "main", label: "reviewing a PR", rest: <5 minutes ago> })`
that the row shows the repo, the branch, the label, and `"5m"` — the age string,
not the raw ISO timestamp.
