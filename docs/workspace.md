# Workspace

`gtd workspace` runs one dashboard and supervisor over all the projects of a
workspace. It shows the status of every worktree of every project.

gtd still runs no turn and makes no commit itself.

## Running it

```sh
gtd workspace
```

Start it from the workspace root, or from any directory below it, under the
process manager you use (pitchfork, systemd, tmux). gtd ships no service unit.
Only one supervisor can run for a workspace. A second one exits 1 and prints the
pid and URL of the first. A signal (`SIGTERM`, `SIGINT`) stops it and closes the
server.

The dashboard is published like `gtd ui`: through `tailscale serve` by default,
on the tailnet interface when serve is not available, or with `--http` on
loopback behind your own proxy. `--host`, `--port`, `--self-signed` and `--http`
work as for `gtd ui`.

## `gtd.workspace.ts`

The supervisor uses the innermost `gtd.workspace.ts` from the current directory,
or the file given with `--config <path>`. The directory of that file is the
workspace root.

> **Trust.** `gtd.workspace.ts` is code that the supervisor runs in its own
> process. Give it the same trust as any script in your workspace. There is no
> sandbox.

```ts
import { defineWorkspace } from "@pmelab/gtd/workspace"
import { worktrunk } from "@pmelab/gtd/workspace/adapters"

export const workspace = defineWorkspace({
  adapters: {
    worktrees: worktrunk({ roots: ["~/code/*/main"] }),
  },
  projects: { portal: { name: "Portal" } },
  ui: { port: 8443, users: ["me@example.com"] },
})
```

Each finding in the file is reported in the `gtd: config:` format, and unknown
keys are refused at every depth. A bad file stops the supervisor with exit
code 1.

### `workspace`

The one reserved export, made with `defineWorkspace`. Every key is optional.

- **`adapters`**: `worktrees`, `services`. An omitted adapter is the bundled
  default with its default options. See [Adapters](#adapters).
- **`projects`**: settings per project id: `name` (shown on the dashboard).
- **`ui`**: `port`, `host`, `cert`, `key`, as for `gtd ui`, and `users` (the
  tailnet logins that may use the dashboard; default: the owner of this node).

## Worktree status

The supervisor runs `gtd next --json` in each worktree, so a process that was
handed over runs on its own pin.

| Status    | When                                                       |
| --------- | ---------------------------------------------------------- |
| needs you | The process waits for a person or a judge.                 |
| working   | The process waits for an agent or a check.                 |
| error     | The process stalled, or `gtd next` failed in the worktree. |
| idle      | The process has ended, or the worktree has none.           |

## Service chips

Each worktree shows its services as chips: the name, whether the service runs,
and its error. A chip with a URL links to it. gtd owns no DNS: the URL is the
one the services adapter reports.

## Gate pages

The supervisor also serves the gate page of every worktree, at
`/<project>/<worktree>/gate`. `<worktree>` is the branch, or the directory name
of a worktree with a detached HEAD. A `/` in the project id or the branch is
written `%2F`. The page is the page of `gtd ui` for the rest the worktree is at
now. No `gtd ui` runs for it. An edit made on a gate page rechecks the status of
that worktree at once.

## Adapters

| Adapter     | Default   | Factory                |
| ----------- | --------- | ---------------------- |
| `worktrees` | worktrunk | `worktrunk({ roots })` |
| `services`  | pitchfork | `pitchfork()`          |

The factories come from `@pmelab/gtd/workspace/adapters`. To use another tool,
give an object that implements the adapter's interface from
`@pmelab/gtd/workspace`, and test it with the contract-test kit from
`@pmelab/gtd/workspace/adapters/testkit`:

```ts
import { worktreesContract } from "@pmelab/gtd/workspace/adapters/testkit"

for (const c of worktreesContract(myHarness)) test(c.name, c.run)
```

Every adapter operation fails with an error of the shape
`{ adapter, op, message, detail }`. `AdapterError` from `@pmelab/gtd/workspace`
has it.

### `worktrees`

- **`projects()`**: every project, as `{ id, path }`. Project settings are keyed
  by the id.
- **`list(project)`**: the project's worktrees, as
  `{ path, branch, head, main, integrated }`. `integrated` is `true` when the
  branch has commits of its own and all of them are on the default branch
  (squash merges count), and `undefined` when the adapter cannot tell.

`worktrunk({ roots })` uses `wt` and `git`. Each root is an absolute path or
starts with `~/`, and a `*` segment matches any directory. A matched directory
is a project when it is a main checkout. Its id is what the `*` segments
matched, joined by `/`, or the directory's name when the root has no `*`.
Without a `worktrees` adapter, every main checkout directly in the workspace
root is a project.

### `services`

- **`list(project, worktree)`**: the worktree's services, as
  `{ name, url, running, error }`. `url` and `error` are `undefined` when there
  is none. `worktree` is the worktree's path.
- **`up(project, worktree)`**: starts the worktree's services, and fails when
  one of them does not start.
- **`down(project, worktree)`**: stops the worktree's services, and no other
  worktree's.

`pitchfork()` uses the daemons of the worktree's own `pitchfork.toml`, and
reports the URL of pitchfork's proxy as each daemon's URL.

## Security

Every request, to the dashboard and to the gate pages, must come from a tailnet
user in `ui.users`. Other users get 403. Requests that change state must be
POSTs with a JSON body from the dashboard's own origin.

The supervisor keeps its state in `~/.local/state/gtd/workspace/` (or under
`$XDG_STATE_HOME`). Nothing goes into your repositories.
