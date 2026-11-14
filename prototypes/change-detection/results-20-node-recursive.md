# Change detection prototype — results

2026-11-14T06:42:10.312Z · linux 6.18.60 · node v24.20.0 · git version 2.54.0 · 20 worktrees in 2 projects · debounce 50 ms · poll every 1000 ms

Each cell: missed worktrees (vs. `git worktree list` truth) · worst latency after the op returned · signals raised.

| scenario | changed | hook | watch | poll | note |
| --- | --- | --- | --- | --- | --- |
| commit in a worktree | 1 | ok · 56 ms · 2 sig | ok · 35 ms · 5 sig | ok · 970 ms · 0 sig |  |
| gtd-style landing: commit-tree + update-ref | 1 | ok · 65 ms · 1 sig | ok · 58 ms · 5 sig | ok · 480 ms · 0 sig |  |
| switch to a new branch | 1 | ok · 58 ms · 4 sig | ok · 16 ms · 5 sig | ok · 0 ms · 0 sig |  |
| new nested branch dir (a/b/c) | 1 | ok · 64 ms · 4 sig | ok · 12 ms · 8 sig | ok · 482 ms · 0 sig |  |
| reset --hard HEAD~1 | 1 | ok · 55 ms · 4 sig | ok · 21 ms · 2 sig | ok · 959 ms · 0 sig |  |
| detach, then commit | 1 | ok · 54 ms · 5 sig | ok · 34 ms · 2 sig | ok · 420 ms · 0 sig |  |
| branch moved from ANOTHER worktree (update-ref in main) | 1 | ok · 62 ms · 1 sig | ok · 58 ms · 5 sig | ok · 934 ms · 0 sig | bench's hook names the worktree that RAN git (main), not w5: rows stay stale unless the server rechecks the whole project |
| pack-refs --all (no state change) | 0 | ok · 15 sig | ok · 39 sig | ok · 0 sig |  |
| commit after refs are packed | 1 | ok · 51 ms · 2 sig | ok · 26 ms · 5 sig | ok · 811 ms · 0 sig |  |
| fetch updates remote refs only | 0 | ok · 1 sig | ok · 0 sig | ok · 0 sig |  |
| gc (objects + refs) | 0 | ok · 3 sig | ok · 23 sig | ok · 0 sig |  |
| worktree add | 1 | ok · 52 ms · 6 sig | ok · 17 ms · 8 sig | ok · 181 ms · 0 sig |  |
| worktree remove | 1 | **missed 1** · 0 sig | ok · 62 ms · 3 sig | ok · 736 ms · 0 sig |  |
| commit with -c core.hooksPath=/dev/null | 1 | **missed 1** · 0 sig | ok · 57 ms · 2 sig | ok · 276 ms · 0 sig |  |
| commit in a project with a tracked core.hooksPath (husky) | 1 | **missed 1** · 0 sig | ok · 56 ms · 4 sig | ok · 814 ms · 0 sig |  |
| edit a file, no commit (dirty tree) | 0 | ok · 0 sig | ok · 0 sig | ok · 0 sig | invisible to all three: no ref moves. gtd next turns a message rest into a capture on a dirty tree |
| server down: 2 commits, then restart | 2 | ok · 56 ms · 4 sig | ok · 5 ms · 0 sig | ok · 12 ms · 0 sig | hook replays its log from the saved offset; watch/poll need the startup rescan |
| burst: 5 commits in each of 20 worktrees, all at once | 20 | **missed 10** · 53 ms · 140 sig | **missed 10** · 35 ms · 186 sig | ok · 563 ms · 0 sig |  |

- recheck cost (`git worktree list --porcelain`, one project of 10 worktrees): avg 11.6 ms over 58 runs
- poll cost: 2 rechecks per 1000 ms, whether or not anything changed
- watch: 26 fs.watch handles at the end (per project: the git dir, worktrees/, each refs/ directory; plus 1 per worktree)
