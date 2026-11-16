# Git history is the only state

Everything gtd knows about a process it reads back from the first-parent commits
of the process's branch. There is no state file and no database, and values such
as an agent's session id are derived from history, never stored. We chose this
over a state file so that a process survives restarts and machine changes,
anyone can inspect it with plain git, and there is nothing to keep in sync with
the repository.

## Scope

This decision is about processes. The workspace supervisor keeps a small state
store outside every repository (ADR 0011): the inbox, pause flags, dismissals,
the last status of each worktree and the notification keys already sent. It is
not process state. Nothing that git or the worktrees can tell is stored, and the
store can be rebuilt: waiting items come back with the next feed poll, and
started work comes back from the worktrees. Only dismissals and failed starts
are lost.
