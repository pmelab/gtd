# Git history is the only state

Everything gtd knows about a process it reads back from the first-parent commits
of the process's branch. There is no state file and no database, and values such
as an agent's session id are derived from history, never stored. We chose this
over a state file so that a process survives restarts and machine changes,
anyone can inspect it with plain git, and there is nothing to keep in sync with
the repository.
