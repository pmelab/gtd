# The workspace reaches every tool through an adapter with a bundled default

`gtd workspace` uses five tools: a terminal multiplexer, a service manager, a
worktree manager, a task runner and a push service. Each one sits behind a plain
TypeScript interface (Promises and async iterables, no Effect). gtd bundles one
default for each (rex, pitchfork, worktrunk, mise, Web Push; see ADR 0016), and
`gtd.workspace.ts` can replace any of them with its own object. We chose this
over building the supervisor on those five tools directly, so that a team on
tmux, systemd, plain git or just can use the dashboard, and over shipping no
defaults, so that a new user has a working workspace without writing an adapter.

## Consequences

- gtd exports a contract-test kit. A userland adapter passes the same cases as
  the bundled defaults, and gtd's own twins pass them too (ADR 0008).
- The interfaces are a public, versioned surface. A change to one is a breaking
  change for userland adapters.
- An adapter only describes or reports. Core decides when to create, remove,
  start and notify, so any mix of adapters works.
- An adapter without change events is polled. A watch stream only hints that a
  snapshot changed; it never carries the data.
