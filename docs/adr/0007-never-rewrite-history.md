# gtd never rewrites history

History is the state (ADR 0002), so rewriting it would break replay and lose
turns. Every gtd operation adds commits or moves refs to commits that stay
reachable: a ship is a new commit on the user's branch, abandoning a process
keeps its tip behind a ref, and a finished process's turns are kept behind a
history ref. We chose this over squashing or rebasing the process branch.
