Fix PR 391 review: 1 single-branch ship retargets only a PR based on a recorded
gtdStack slice branch. 2 stack mode retargets a thrown draft too. 3 commits ship
with no process unsets gtdStack. 4 resume rebuilds a missing slice branch only
when HEAD is the recorded top, else refuses. 5 driver.md: commits hint only for
lower PRs, top needs rename; squash-merge and stale lower PR caveats
