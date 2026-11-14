# gtd leaves no trace on shared history

Nothing that gtd adds where other people can see it names gtd: not a commit,
trailer or file on the user's branch, not a pushed ref, not a pull request. One
person can use gtd in a team that does not, and nobody has to notice or agree.
The process branch `gtd/<b>`, the `refs/gtd/*` refs and `.gtd/` stay, because
they are local and replay needs them (ADR 0002, ADR 0007). We chose this over
labelling shipped commits with gtd trailers, which made every ship visible to
the whole team and tied the user's branch to gtd's bookkeeping.

## Consequences

- A ship is a commit with the workflow's message and nothing else. gtd finds the
  link between a ship and its process on the process side, never on `<b>`.
- Sharing is opt-in: `historyRemote` is the only setting that pushes anything,
  and a workflow that wants a visible marker writes it into its own ship
  message.
- `gtd.config.ts` may live outside the repository, because the lookup walks up
  to the home directory. Committing it is the team's choice.
