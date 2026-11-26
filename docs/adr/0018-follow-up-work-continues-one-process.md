# Follow-up work continues one process through signals

Follow-up work on a shipped change (a review, a CI result, a merge) moves from
feed-started passes to signals delivered to one long-lived process. A process
rests at a wait step and a feed delivers a signal to it. We chose this over
starting a new item for each follow-up, because every pass started again from
the shipped state and lost what the process knew about the change.

The supervisor delivers a signal by writing `.gtd/SIGNAL.json` into the worktree
and starting the driver, through `gtd signal`. It never lands a commit. The
driver lands the signal as the wait step's turn, as it lands a person's edit at
a gate. We chose this over a supervisor that commits, because:

- the landing stays the driver's job, so there is one writer of history;
- a person can do it by hand when the supervisor fails: `gtd signal`, then land;
- it is easy to test: a test writes the trace and lands it in memory, with no
  supervisor.

## Consequences

- A process may live as long as its change. Auto-clean keeps its worktree,
  because the process has not ended.
- gtd decides a duplicate from history, by the fingerprint of the signal last
  landed at the wait. A feed stays stateless.
- A signal that finds no matching wait is dropped, and the feed sends it again
  on its next poll.
