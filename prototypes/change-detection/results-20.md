# Change detection prototype — results

2026-11-14T06:41:03.120Z · linux 6.18.60 · node v24.20.0 · git version 2.54.0 · 20 worktrees in 2 projects · debounce 50 ms · poll every 1000 ms

Each cell: missed worktrees (vs. `git worktree list` truth) · worst latency after the op returned · signals raised.

| scenario | changed | hook | watch | poll | note |
| --- | --- | --- | --- | --- | --- |
| commit in a worktree | 1 | ok · 57 ms · 2 sig | ok · 35 ms · 4 sig | ok · 971 ms · 0 sig |  |
| gtd-style landing: commit-tree + update-ref | 1 | ok · 64 ms · 1 sig | ok · 59 ms · 4 sig | ok · 476 ms · 0 sig |  |
| switch to a new branch | 1 | ok · 56 ms · 4 sig | ok · 17 ms · 5 sig | ok · 959 ms · 0 sig |  |
| new nested branch dir (a/b/c) | 1 | ok · 61 ms · 4 sig | ok · 3 ms · 2 sig | ok · 418 ms · 0 sig |  |
| reset --hard HEAD~1 | 1 | ok · 62 ms · 4 sig | ok · 0 ms · 4 sig | ok · 892 ms · 0 sig |  |
| detach, then commit | 1 | ok · 59 ms · 5 sig | ok · 0 ms · 2 sig | ok · 317 ms · 0 sig |  |
| branch moved from ANOTHER worktree (update-ref in main) | 1 | ok · 63 ms · 1 sig | ok · 57 ms · 4 sig | ok · 834 ms · 0 sig | bench's hook names the worktree that RAN git (main), not w5: rows stay stale unless the server rechecks the whole project |
| pack-refs --all (no state change) | 0 | ok · 15 sig | ok · 41 sig | ok · 0 sig |  |
| commit after refs are packed | 1 | ok · 60 ms · 2 sig | ok · 0 ms · 1 sig | ok · 629 ms · 0 sig |  |
| fetch updates remote refs only | 0 | ok · 1 sig | ok · 0 sig | ok · 0 sig |  |
| gc (objects + refs) | 0 | ok · 3 sig | ok · 8 sig | ok · 0 sig |  |
| worktree add | 1 | ok · 59 ms · 6 sig | ok · 0 ms · 2 sig | ok · 0 ms · 0 sig |  |
| worktree remove | 1 | **missed 1** · 0 sig | ok · 63 ms · 3 sig | ok · 523 ms · 0 sig |  |
| commit with -c core.hooksPath=/dev/null | 1 | **missed 1** · 0 sig | **missed 1** · 0 sig | ok · 85 ms · 0 sig |  |
| commit in a project with a tracked core.hooksPath (husky) | 1 | **missed 1** · 0 sig | ok · 51 ms · 4 sig | ok · 676 ms · 0 sig |  |
| edit a file, no commit (dirty tree) | 0 | ok · 0 sig | ok · 0 sig | ok · 0 sig | invisible to all three: no ref moves. gtd next turns a message rest into a capture on a dirty tree |
| server down: 2 commits, then restart | 2 | ok · 56 ms · 4 sig | ok · 5 ms · 0 sig | ok · 11 ms · 0 sig | hook replays its log from the saved offset; watch/poll need the startup rescan |
| burst: 5 commits in each of 20 worktrees, all at once | 20 | **missed 10** · 57 ms · 140 sig | ok · 35 ms · 418 sig | ok · 238 ms · 0 sig |  |

- recheck cost (`git worktree list --porcelain`, one project of 10 worktrees): avg 10.6 ms over 60 runs
- poll cost: 2 rechecks per 1000 ms, whether or not anything changed
- watch: 35 fs.watch handles at the end (per project: the git dir, worktrees/, each refs/ directory; plus 1 per worktree)
