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

- **`adapters`**: `worktrees`. An omitted adapter is the bundled default with
  its default options. See [Adapters](#adapters).
- **`pollEvery`** (duration, default `"10s"`): how often a worktrees adapter
  without `watch()` is read.
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

The statuses stay current while the supervisor runs. A commit, a new branch or a
new worktree shows within a few seconds. An edit that is not committed shows
within about 30 seconds: every 30 seconds the supervisor runs `gtd next` in
every worktree again.

When a worktrees adapter read fails, each worktree it covers keeps its last
known status, greyed and marked "worktrees unavailable", and a banner above the
projects shows the error. Both go away after the next good read.

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
- **`watch()`** (optional): an async iterable of hints, `{ project }` or `{}`
  when any project may have changed. A hint carries no data: the supervisor
  reads `list(project)` again. When the stream ends or throws, the supervisor
  watches again and reads every project. Without `watch()`, the supervisor reads
  every project each `pollEvery`.

`worktrunk({ roots })` uses `wt` and `git`. Each root is an absolute path or
starts with `~/`, and a `*` segment matches any directory. A matched directory
is a project when it is a main checkout. Its id is what the `*` segments
matched, joined by `/`, or the directory's name when the root has no `*`.
Without a `worktrees` adapter, every main checkout directly in the workspace
root is a project. Its `watch()` watches the git directories of each project
(not `refs/remotes`, so a fetch is no change) and installs nothing into your
checkouts. A project added after the supervisor started is found by the next
30-second read.

## Security

Every request, to the dashboard and to the gate pages, must come from a tailnet
user in `ui.users`. Other users get 403. Requests that change state must be
POSTs with a JSON body from the dashboard's own origin.

The supervisor keeps its state in `~/.local/state/gtd/workspace/` (or under
`$XDG_STATE_HOME`). Nothing goes into your repositories.
