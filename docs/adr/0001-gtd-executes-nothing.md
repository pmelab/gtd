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

## Amendment: the workspace supervisor

`gtd workspace` is a bundled supervisor, like `gtd ui` is a bundled editor. It
starts a configured driver command, runs configured actions, and dispatches
inbox items by running the item's start action. It never decides what happens
next in a process: the rest still comes only from replay, and only the driver
and the actions run turns and make commits. Which items exist, and what an
action does, is userland code in `gtd.workspace.ts`.

- gtd ships no daemon unit. Machine setup starts the supervisor under any
  process manager.
- A driver works the same with or without the supervisor. The supervisor reads
  the driver's status and sends it one-shot commands; it never types into a
  shell.
- The supervisor never runs a driver or an action as its own child. It asks the
  terminal adapter for a new pane with that command as its top process, in the
  person's login-shell environment, as the person would start it. The pane and
  the driver outlive the supervisor. The supervisor itself runs only short
  subprocesses that run no turn: the driver's one-shots and `gtd next --json`.
- `gtd.workspace.ts` is code that the supervisor runs in its own process. It has
  the same trust as `gtd.config.ts`.
