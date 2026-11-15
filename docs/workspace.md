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

- **`driver`**: the driver command, as an argv, for example `["my-driver"]`. See
  [Workspace drivers](./driver.md#workspace-drivers).
- **`adapters`**: `worktrees`, `terminal`, `actions`. An omitted adapter is the
  bundled default with its default options. See [Adapters](#adapters).
- **`projects`**: settings per project id: `name` (shown on the dashboard) and
  `driver` (this project's driver command, instead of the workspace's).
- **`ui`**: `port`, `host`, `cert`, `key`, as for `gtd ui`, and `users` (the
  tailnet logins that may use the dashboard; default: the owner of this node).

## Worktree status

The supervisor runs `gtd next --json` in each worktree, so a process that was
handed over runs on its own pin. It also reads the status that the worktree's
driver reports in its terminal pane.

| Status    | When                                                                                        |
| --------- | ------------------------------------------------------------------------------------------- |
| needs you | The process waits for a person or a judge, and its driver is waiting or not running.        |
| working   | The driver reports that it works, or it runs while the process waits for an agent or check. |
| error     | The driver reports an error, the driver crashed, the process stalled, or `gtd next` failed. |
| idle      | The process has ended, or the worktree has none.                                            |

The supervisor starts the driver in its own terminal pane. The driver outlives
the supervisor. When the supervisor starts, it starts the driver of each
worktree that waits for an agent or a check with no driver running. It never
restarts a driver that crashed.

## Gate pages

The supervisor also serves the gate page of every worktree, at
`/<project>/<worktree>/gate`. `<worktree>` is the branch, or the directory name
of a worktree with a detached HEAD. A `/` in the project id or the branch is
written `%2F`. The page is the page of `gtd ui` for the rest the worktree is at
now. No `gtd ui` runs for it. An edit made on a gate page rechecks the status of
that worktree at once.

## Adapters

| Adapter     | Default   | Factory                  |
| ----------- | --------- | ------------------------ |
| `worktrees` | worktrunk | `worktrunk({ roots })`   |
| `terminal`  | rex       | `rex({ server, shell })` |
| `actions`   | mise      | `mise()`                 |

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

### `terminal`

- **`run(project, worktree, argv, env)`**: opens a new pane in the worktree with
  `argv` as the pane's own top process, and returns a handle (a string). `argv`
  gets the environment of your login shell, with `env` applied after the shell's
  startup files. The pane stays open after `argv` exits.
- **`status(handle)`**: `{ record, alive, busy, exit }`, or `undefined` when the
  pane is gone. `record` is the root OSC 7501 record (`state`, `kind`, `title`,
  `msg`). `exit` is `{ code }` once `argv` has ended (`128 + n` for signal `n`),
  else `null`.
- **`close(handle)`**, and optionally **`attach(handle)`** and **`watch()`**
  (hints, each a handle whose status may have changed).

`rex({ server, shell })` opens one Rex session per project id and one window per
pane. `server` is a Rex server address as `rex -S` takes it; `shell` is the
login shell (Rex's default when absent).

### `actions`

- **`list(worktree)`**: the worktree's actions, as
  `{ id, label, status, fields }`. `status` is the worktree status the action is
  offered in: `idle`, `needsYou`, `error`, or `any`. An action for `idle` is a
  start action. Each field is `{ name, type, required, choices, help }`, and
  `type` is `flag`, `select` (one of `choices`) or `text`.
- **`argv(worktree, id, values)`**: the action's command line. `values` has a
  value for each field that was filled in: `true` for a flag that is on, a
  string otherwise. Each value must reach the action unchanged. The adapter may
  refuse a value with an adapter error, but it must never change it.

The supervisor checks the values against the fields, then runs the argv in a new
terminal pane in the worktree, never in the driver's pane and never through a
shell. Every action gets `GTD_WORKSPACE_STATUS`, a JSON object with `status`,
`errorKind` and `message` (when the worktree has them) and `commit` (the
worktree's HEAD commit). When a start action exits 0, the supervisor starts the
driver.

`mise()` makes the mise tasks of the worktree into actions: `start:*` for idle,
`gate:*` for needs you, `error:*` for error and `any:*` for any status. Hidden
tasks are left out. The task's description is the label, and its usage spec
gives the fields: each `arg` is a text field, each `flag` that takes a value is
a text field, each flag without a value is a flag field, and one with `choices`
is a select field. mise reads a flag's value that spells one of the task's own
flags (for example `--dry`) as that flag, so `mise()` refuses such a value.

## Security

Every request, to the dashboard and to the gate pages, must come from a tailnet
user in `ui.users`. Other users get 403. Requests that change state must be
POSTs with a JSON body from the dashboard's own origin.

The supervisor keeps its state in `~/.local/state/gtd/workspace/` (or under
`$XDG_STATE_HOME`). Nothing goes into your repositories.
