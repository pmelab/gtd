# gtd executes nothing; the driver does

gtd never changes a repository and never performs a turn. It reads git and
prints what should happen next — a message, a script, a prompt, or the landing
script that records a turn — and a driver runs it. We chose this over gtd
committing and dispatching agents itself so that any driver works (a loop, a CI
job, an editor, a person pasting into a terminal) and so that gtd stays a pure
function of the repository's history.

## Consequences

- Helper commands a driver may call — `gtd judge run`, `gtd uncheck`, `gtd lsp`,
  `gtd ui` — are bundled drivers or editors, not the engine. They never decide
  what happens next.
- gtd does evaluate `gtd.config.ts`, which is code. It carries the same trust as
  any other script in the repository.
- The environment belongs to the driver. Secrets, commit signing, the shell and
  any sandbox work as they do for the user's own commands, because the driver
  runs every script and makes every commit. gtd never needs a credential or a
  configuration of its own for them. Git hooks are the exception: an approval, a
  ship and a `keep: true` turn are built with `git commit-tree`, which runs
  none.
