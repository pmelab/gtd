test(gtd): align e2e, README, and bundle with machine-directed actions

Update the cucumber e2e suite to assert post-loop observables (git-log subjects +
the next leaf's prompt) for the now edge-driven cleanup/close-review/code-changes
states, prove human-review no longer runs the test suite, and cover the no-agent
hop cap and the Part B generalized commit. Refresh the README state table and
decision tree to describe the EdgeAction model, the execute-only test gate, the
no-agent hop cap, and the generalized post-agent commit. Rebuild the distributed
bundle so the installed skill and e2e run the current code.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
