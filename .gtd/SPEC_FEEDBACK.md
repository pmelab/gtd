# Spec feedback — 05 Handing the turn back, and loop lifecycle

## Stop and shutdown signal the `bash -c` wrapper only; the real driver survives (T5, T6, T3)

`src/serve/Loop.ts#liveLoopSpawn` spawns `bash -c <command>` with no
`detached`/process-group handling, and `LoopChild.interrupt`/`kill` call
`child.kill(...)`, which delivers the signal to that one bash pid. For the
canonical loop shape — `docs/driver.md`'s own `while :; do ... claude ...; done`
— bash forks each driver turn as a separate process in the same group, and a
bare `kill(pid)` never reaches it.

Reproduced on this machine with
`bash -c "while true; do sh -c 'sleep 30'; done"`:

- SIGINT to bash: the grandchild is still alive 1s later — it never got the
  signal, so it never gets "a chance to finish its beat" (T5's stated reason for
  SIGINT-before-SIGKILL).
- SIGKILL to bash after the escalation timeout: bash dies, the grandchild is
  **still alive** and keeps driving the worktree.

Consequences against the acceptance criteria:

- T5 "stop sends the interrupt signal first ... so the loop gets a chance to
  finish its beat" — the interrupt is delivered to a wrapper that forwards
  nothing. The current tests pass only because every fixture command is a single
  simple command bash `exec`s, so no wrapper exists to swallow the signal.
- T5 "the registry entry is removed either way" — it is removed when bash dies,
  while the orphaned driver keeps committing to that worktree. The row leaves
  Working with a live driver still in it.
- T3 "a worktree already being driven is never double-driven" — after the above,
  `isDriving` is false, so the next `done` spawns a second loop on a worktree an
  orphan is still driving. Two drivers, same worktree.
- T6 "shutdown kills every live child" / "nothing auto-resumes" —
  `Registry.killAll` SIGKILLs the wrappers only; orphaned drivers survive the
  restart, so a restarted server sees worktrees advancing that its empty
  registry says nothing is driving.

Fix direction (do not treat as prescriptive): spawn with `detached: true` so the
child leads its own process group, and signal the group
(`process.kill(-pid, sig)`), guarding against `ESRCH` when the group is already
gone. Whatever the mechanism, the coverage gap is the same: every current
Loop/Registry test uses a command bash `exec`s away. Add at least one test whose
loop command is a real multi-command shell loop with a long-running inner
process, asserting that inner process is dead after `stopChild` and after
`killAll`.
