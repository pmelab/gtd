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
- **`projects`**: settings per project id: `name` (shown on the dashboard).
- **`ui`**: `port`, `host`, `cert`, `key`, as for `gtd ui`, and `users` (the
  tailnet logins that may use the dashboard; default: the owner of this node).

### Feeds

A feed is a named export made with `feed()` from `@pmelab/gtd/workspace`. The
export name is the feed's name.

```ts
import { feed } from "@pmelab/gtd/workspace"

export const boardReady = feed({
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
      }),
    )
  },
})
```

- **`project`**: the project id.
- **`every`** (duration): how often `poll` runs. The first poll runs when the
  supervisor starts.
- **`mode`**: `"propose"` (a person starts or dismisses each item) or `"queue"`
  (items start without a person).
- **`poll(ctx)`**: returns every item that matches now. gtd adds new keys,
  updates known ones, and removes waiting items that the poll no longer returns.
- **`canStart(item, ctx)`** (optional): return `false` to hold an item at
  dispatch.

`ctx` has `exec(argv, { cwd })`, `fetch` and `log(message)`. `exec` runs argv
without a shell, in the project's main checkout unless `cwd` is given, and
returns `{ status, stdout, stderr }`; a non-zero exit does not throw. `log`
writes to the supervisor's output.

An item has these fields:

- **`key`**: unique for the feed;
- **`title`**, **`url`** (optional);
- **`action`**: the start action that begins the work, for example
  `start:feature`;
- **`priority`**: a number; a higher number starts first;
- **`blockedBy`** (optional): keys of items that must finish first. Use
  `<feed>/<key>` for an item of another feed;
- **`branch`** (optional): start the work in the existing worktree of this
  branch;
- **`data`** (optional): any JSON. gtd passes it on and never reads it.

gtd adds `feed` and `project` to each item. A poll that throws, or that returns
something other than a list of such items with unique keys, fails the feed
(`feedFailing`): its items stay as they were, and the other feeds keep polling.

### Testing feeds

`testFeed(feed, { exec, fetch, clock, name })` from `@pmelab/gtd/testkit` runs a
feed without the network, under any test runner. `exec` and `fetch` answer the
feed's `ctx`; `clock` returns the time of each poll.

```ts
import { testFeed } from "@pmelab/gtd/testkit"
import { boardReady } from "./gtd.workspace.ts"

const run = testFeed(boardReady, {
  exec: () => ({
    status: 0,
    stdout: '[{"number":1,"title":"Add login","url":"…"}]',
    stderr: "",
  }),
})
const { items, failure, logs } = await run.poll()
```

`poll()` returns the inbox after the poll, as the supervisor keeps it: each item
with `feed`, `project`, `state` and `firstSeen`, in start order. `failure` is
set when the feed fails. `dismiss(key)` dismisses a proposed item, and
`canStart(item)` runs the feed's `canStart`.

## Inbox

The Inbox view (`/inbox`) lists the items that feeds filed and that wait, in
start order: priority, then the order the poll returned them, then the time gtd
first saw them. It also names each failing feed.

| State    | When                                                                      |
| -------- | ------------------------------------------------------------------------- |
| proposed | A `propose` feed filed it; it waits for a person.                         |
| queued   | A `queue` feed filed it.                                                  |
| blocked  | A `queue` feed filed it, and an item it names in `blockedBy` still waits. |

**Dismiss** hides a proposed item until its feed stops returning it. A later
poll that returns the key again files it anew. Starting items is not available
yet.

## Worktree status

The supervisor runs `gtd next --json` in each worktree, so a process that was
handed over runs on its own pin.

| Status    | When                                                       |
| --------- | ---------------------------------------------------------- |
| needs you | The process waits for a person or a judge.                 |
| working   | The process waits for an agent or a check.                 |
| error     | The process stalled, or `gtd next` failed in the worktree. |
| idle      | The process has ended, or the worktree has none.           |

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

`worktrunk({ roots })` uses `wt` and `git`. Each root is an absolute path or
starts with `~/`, and a `*` segment matches any directory. A matched directory
is a project when it is a main checkout. Its id is what the `*` segments
matched, joined by `/`, or the directory's name when the root has no `*`.
Without a `worktrees` adapter, every main checkout directly in the workspace
root is a project.

## Security

Every request must come from a tailnet user in `ui.users`. Other users get 403.
Requests that change state must be POSTs with a JSON body from the dashboard's
own origin.

The supervisor keeps its state in `~/.local/state/gtd/workspace/` (or under
`$XDG_STATE_HOME`). Nothing goes into your repositories. Deleting that state
loses only the dismissals; the next polls file every waiting item again.
