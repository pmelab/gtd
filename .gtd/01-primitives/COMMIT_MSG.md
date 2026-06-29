feat(gtd): add git primitives and config caps for the 16-state machine

Additive groundwork for the hard cutover to the STATES.md design. Adds the new
Git primitives (revertNoCommit, mixedResetHead, checkoutAll, lastDeletionOf,
commitHistory with per-commit removedErrors, removePackageDir,
commitAllWithPrefix) and the new config surface (fixAttemptCap, reviewThreshold,
and the new agent-state model keys), leaving the existing pipeline and tests
untouched and green.
