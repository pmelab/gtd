# Workspace

`gtd workspace` runs one dashboard and supervisor over all the projects of a
workspace. It shows every worktree as a row, serves each worktree's gate page,
starts your [driver](./driver.md#workspace-drivers), and dispatches work that
your triggers find.

gtd still runs no turn and makes no commit itself. Your driver and your actions
do that.

## Running it

```sh
gtd workspace
```

Start it from the workspace root, or from any directory below it, under the
process manager you use (pitchfork, systemd, tmux). gtd ships no service unit.
Only one supervisor can run for a workspace. A second one exits 1 and prints the
pid and URL of the first.

The dashboard is published like `gtd ui`: through `tailscale serve` by default,
on the tailnet interface when serve is not available, or with `--http` on
loopback behind your own proxy. `--host`, `--port`, `--self-signed` and `--http`
work as for `gtd ui`.

Drivers keep running when the supervisor stops. When it starts again, it
notifies you only about rows that changed while it was down, and it restarts
drivers whose process waits for an agent or a check with no driver running.

## `gtd.workspace.ts`

The supervisor uses the innermost `gtd.workspace.ts` from the current directory,
or the file given with `--config <path>`. The directory of that file is the
workspace root.

> **Trust.** `gtd.workspace.ts`, with its triggers and reactions, is code that
> the supervisor runs in its own process. Give it the same trust as any script
> in your workspace. There is no sandbox.

```ts
import { defineWorkspace, reaction, trigger } from "@pmelab/gtd/workspace"
import { ntfy, worktrunk } from "@pmelab/gtd/workspace/adapters"

export const boardReady = trigger({
  project: "portal",
  every: "5m",
  mode: "propose",
  poll: async (ctx) => {
    const out = await ctx.exec([
      "gh",
      "issue",
      "list",
      "--label",
      "ready",
      "--json",
      "number,title,url",
    ])
    return JSON.parse(out.stdout).map(
      (i: { number: number; title: string; url: string }) => ({
        key: String(i.number),
        title: i.title,
        url: i.url,
        action: "start:feature",
        priority: 0,
        data: { ship: "pr" },
      }),
    )
  },
})

export const triageErrors = reaction({
  on: { to: "error", errorKind: "driver" },
  run: async (change, ctx) => {
    await ctx.action("error:triage", {})
  },
})

export const workspace = defineWorkspace({
  driver: ["my-driver"],
  adapters: {
    worktrees: worktrunk({ roots: ["~/code/*/main"] }),
    notifications: ntfy({ topic: "my-topic" }),
  },
  limits: { maxDrives: 3, wip: 2 },
  pollEvery: "30s",
  clean: { every: "30m" },
  projects: { portal: { name: "Portal", wip: 4 } },
  ui: { port: 8443, users: ["me@example.com"] },
})
```

Each finding in the file is reported in the `gtd: config:` format, and unknown
keys are refused at every depth. At startup, a bad file stops the supervisor
with exit code 1. When you edit the file while the supervisor runs, it loads the
new version. If the new version is bad, the last good one stays in use and the
dashboard shows the findings in a banner.

### `workspace`

The one reserved export, made with `defineWorkspace`. Every key is optional.

- **`driver`** (argv): the [driver command](./driver.md#workspace-drivers) for
  every project.
- **`adapters`**: `terminal`, `services`, `worktrees`, `actions`,
  `notifications`. An omitted adapter is the bundled default with its default
  options. See [Adapters](#adapters).
- **`limits`**: `maxDrives` (drivers running at the same time in the workspace)
  and `wip` (started items per project).
- **`pollEvery`** (duration): how often adapters without change events are read.
- **`projects`**: settings per project id: `name` (shown on the dashboard),
  `driver`, `wip`, `notify`, `clean`. An id that matches no project gives a
  dashboard warning.
- **`notify`**: turn built-in notifications on or off: `needsYou`, `error`,
  `proposed`, `triggerFailing`, `configError`, `mainStale`. All are on.
- **`clean`**: `{ every: "<duration>" }` turns on [auto-clean](#auto-clean). It
  is off by default.
- **`ui`**: `port`, `host`, `cert`, `key`, as for `gtd ui`, and `users` (the
  tailnet logins that may use the dashboard; default: the owner of this node).

### Triggers

A trigger is a named export made with `trigger()`. The export name is the
trigger's name.

- **`project`**: the project id.
- **`every`** (duration): how often `poll` runs.
- **`mode`**: `"propose"` (a person starts or dismisses each item) or `"queue"`
  (items start without a person).
- **`poll(ctx)`**: returns every item that matches now. An item that is no
  longer returned leaves the inbox if it has not started.
- **`canStart(item, ctx)`** (optional): return `false` to hold an item at
  dispatch.

`ctx` has `exec(argv)`, `fetch` and `log`.

An item has these fields:

- **`key`**: unique for the trigger;
- **`title`**, **`url`** (optional);
- **`action`**: the start action that begins the work, for example
  `start:feature`;
- **`priority`**: a higher number starts first;
- **`blockedBy`** (optional): keys of items that must finish first. Use
  `<trigger>/<key>` for an item of another trigger;
- **`branch`** (optional): start the work in the existing worktree of this
  branch. The item waits until that worktree is free: no process mid-flow, no
  driver running, no uncommitted changes;
- **`data`** (optional): any JSON. gtd passes it on and never reads it.

The start action and the driver receive the item as JSON in
`GTD_WORKSPACE_ITEM`.

Items start in order of priority, then the order `poll` returned, then the time
gtd first saw them, within `maxDrives`, `wip` and any pause. A start that fails
stays in the inbox until you retry or dismiss it.

### Reactions

A reaction is a named export made with `reaction()`. It runs once for each row
change that matches `on`.

- **`on`**: for example `{ to: "error" }`,
  `{ to: "error", errorKind: "driver" }`, `{ to: "needsYou" }` or
  `{ to: "cleaned" }`.
- **`run(change, ctx)`**: `change` has `project`, `worktree`, `from`, `to`,
  `label`, `errorKind`, `rest` and `atStartup`. `ctx` has `action(id, values)`,
  `proceed(rest)`, `retry(rest)`, `notify(…)`, `exec` and `log`.

A reaction that throws is reported on the dashboard. The other reactions and
triggers keep running.

### Testing triggers and reactions

`@pmelab/gtd/testkit` has `testTrigger(trigger, { exec, fetch, clock })` and
`testReaction(reaction, change, { … })`. They run under any test runner, like
the [workflow testkit](./testing.md).

## Rows

| Status    | When                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| needs you | The process waits for a person or a judge, and its driver is waiting or not running.     |
| working   | The driver reports that it works.                                                        |
| error     | The driver reports an error, the driver crashed, the process stalled, or a mark says so. |
| idle      | The process has ended, or the worktree has none.                                         |

## Actions

Actions are the commands the dashboard offers on a row. With the bundled mise
adapter, they are your mise tasks, chosen by name prefix:

| Prefix    | Shown on           |
| --------- | ------------------ |
| `start:*` | idle rows          |
| `gate:*`  | rows that need you |
| `error:*` | rows in error      |
| `any:*`   | every row          |

The task's usage spec gives the fields. Each field value is passed as one
argument, never through a shell. An action runs in its own terminal pane and
gets the row as JSON in `GTD_WORKSPACE_ROW`: `status`, `errorKind` (`crashed`,
`stalled`, `driver` or `mark`), `message` and `rest`. When a `start:*` action
exits 0, gtd starts the driver.

## Commands for your scripts

| Command                                                  | Effect                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| `gtd workspace mark <worktree> --error <msg> [--notify]` | Put the row in error with this message.                         |
| `gtd workspace mark <worktree> --note <msg> [--notify]`  | Show a note on the row.                                         |
| `gtd workspace mark <worktree> --clear`                  | Remove the mark.                                                |
| `gtd workspace proceed <worktree> <rest-id>`             | Proceed, as the dashboard does.                                 |
| `gtd workspace retry <worktree> <rest-id>`               | Retry, as the dashboard does.                                   |
| `gtd workspace pause [<project> [<trigger>]] [--wait]`   | Stop dispatch. With `--wait`, return when no driver runs there. |
| `gtd workspace resume [<project> [<trigger>]]`           | Start dispatch again.                                           |

When the supervisor is not running, `mark` is kept and applied at its next
start, and the other commands exit 1.

A deploy script that must not run beside a driver can do this:

```sh
gtd workspace pause portal --wait
./deploy.sh
gtd workspace resume portal
```

## Auto-clean

With `clean` set, gtd removes worktrees whose work is integrated: the branch has
commits of its own, and all of them are on the default branch. Squash merges
count. Before each pass it fetches and fast-forwards each project's main
checkout. It never resets or rebases. If that fails, the project heading shows
why and you get a `mainStale` notification.

A worktree is never removed when:

- it is the main checkout;
- it has uncommitted or untracked changes;
- a process in it has not ended;
- its driver runs;
- one of its terminal panes is busy;
- an item for it is starting;
- it has an error mark.

A removal stops the worktree's services, closes its idle panes, and deletes the
worktree and its branch.

## Adapters

| Adapter         | Default   | Factory                    |
| --------------- | --------- | -------------------------- |
| `terminal`      | rex       | `rex()`                    |
| `services`      | pitchfork | `pitchfork()`              |
| `worktrees`     | worktrunk | `worktrunk({ roots })`     |
| `actions`       | mise      | `mise()`                   |
| `notifications` | ntfy      | `ntfy({ topic, server? })` |

The factories come from `@pmelab/gtd/workspace/adapters`. To use another tool,
give an object that implements the adapter's interface, and test it with the
contract-test kit from `@pmelab/gtd/workspace/adapters/testkit`.

## Security

Every request must come from a tailnet user in `ui.users`. Other users get 403.
Requests that change state must be POSTs with a JSON body from the dashboard's
own origin. Each one is written to the audit log in the supervisor's state
directory, without field values. The gate pages and `gtd ui` have the same
checks.

The supervisor keeps its state in `~/.local/state/gtd/workspace/`. Nothing goes
into your repositories.
