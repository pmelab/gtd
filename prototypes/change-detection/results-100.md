# Change detection prototype — results

2026-11-14T06:41:41.188Z · linux 6.18.60 · node v24.20.0 · git version 2.54.0 · 100 worktrees in 2 projects · debounce 50 ms · poll every 1000 ms

Each cell: missed worktrees (vs. `git worktree list` truth) · worst latency after the op returned · signals raised.

| scenario | changed | hook | watch | poll | note |
| --- | --- | --- | --- | --- | --- |
| commit in a worktree | 1 | ok · 66 ms · 55 sig | ok · 63 ms · 161 sig | ok · 418 ms · 0 sig |  |
| gtd-style landing: commit-tree + update-ref | 1 | ok · 62 ms · 1 sig | ok · 54 ms · 1 sig | ok · 948 ms · 0 sig |  |
| switch to a new branch | 1 | ok · 63 ms · 4 sig | ok · 16 ms · 6 sig | ok · 416 ms · 0 sig |  |
| new nested branch dir (a/b/c) | 1 | ok · 77 ms · 4 sig | ok · 9 ms · 2 sig | ok · 884 ms · 0 sig |  |
| reset --hard HEAD~1 | 1 | ok · 57 ms · 4 sig | **missed 1** · 0 sig | ok · 384 ms · 0 sig |  |
| detach, then commit | 1 | ok · 61 ms · 5 sig | ok · 40 ms · 2 sig | ok · 864 ms · 0 sig |  |
| branch moved from ANOTHER worktree (update-ref in main) | 1 | ok · 76 ms · 1 sig | **missed 1** · 0 sig | ok · 391 ms · 0 sig | bench's hook names the worktree that RAN git (main), not w5: rows stay stale unless the server rechecks the whole project |
| pack-refs --all (no state change) | 0 | ok · 6 sig | ok · 6 sig | ok · 0 sig |  |
| commit after refs are packed | 1 | ok · 60 ms · 2 sig | ok · 32 ms · 1 sig | ok · 411 ms · 0 sig |  |
| fetch updates remote refs only | 0 | ok · 1 sig | ok · 0 sig | ok · 0 sig |  |
| gc (objects + refs) | 0 | ok · 3 sig | ok · 8 sig | ok · 0 sig |  |
| worktree add | 1 | ok · 67 ms · 6 sig | ok · 0 ms · 2 sig | ok · 708 ms · 0 sig |  |
| worktree remove | 1 | **missed 1** · 0 sig | ok · 60 ms · 3 sig | ok · 256 ms · 0 sig |  |
| commit with -c core.hooksPath=/dev/null | 1 | **missed 1** · 0 sig | **missed 1** · 0 sig | ok · 810 ms · 0 sig |  |
| commit in a project with a tracked core.hooksPath (husky) | 1 | **missed 1** · 0 sig | ok · 73 ms · 161 sig | ok · 338 ms · 0 sig |  |
| edit a file, no commit (dirty tree) | 0 | ok · 0 sig | ok · 0 sig | ok · 0 sig | invisible to all three: no ref moves. gtd next turns a message rest into a capture on a dirty tree |
| server down: 2 commits, then restart | 2 | ok · 58 ms · 4 sig | ok · 13 ms · 0 sig | ok · 30 ms · 0 sig | hook replays its log from the saved offset; watch/poll need the startup rescan |
| burst: 5 commits in each of 100 worktrees, all at once | 100 | **missed 50** · 0 ms · 719 sig | **missed 2** · 0 ms · 1578 sig | ok · 0 ms · 0 sig |  |

- recheck cost (`git worktree list --porcelain`, one project of 50 worktrees): avg 49.2 ms over 66 runs
- poll cost: 2 rechecks per 1000 ms, whether or not anything changed
- watch: 114 fs.watch handles at the end (per project: the git dir, worktrees/, each refs/ directory; plus 1 per worktree)
