feat(gtd): generalize the post-agent commit as an edge action

Part B: move the post-agent `git commit` out of the execute/decompose/new-todo/
modified-todo/execute-simple/human-review/fix-tests prompts and into the next
cycle's edge as a generalized `commitPending` EdgeAction. The machine folds an
on-disk/committed intent descriptor to pick the disambiguated message and
cleanup (resolving the guard-ordering overlap with code-changes and execute);
the edge computes content-derived messages and performs the commit, package
removal, and `Gtd-Test-Fix:` trailer preservation. The A0 no-agent hop cap
bounds a commit that fails to clear its dirty tree. Machine/Git/Events test
updates land in the same package to stay green.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
