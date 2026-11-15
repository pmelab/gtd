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

## Dashboard

The dashboard has three views:

- **Now**: only the worktrees that need you and the worktrees in error, across
  all projects. Each has one primary button, Proceed or Retry (see
  [Proceed and Retry](#proceed-and-retry)). The worktrees that work fold into
  one line each, under "N working".
- **Projects**: every worktree, grouped by project, with its status, its label,
  its service chips and the reason of a refused press.
- **Inbox**: the items that wait (see [Inbox](#inbox)).

Banners above each view show problems with the workspace itself.

A tap on a worktree opens its detail. On a phone the detail covers the screen,
with its tabs at the bottom. On a wide screen it is a pane beside the list. The
detail has three tabs:

- **Gate**, first: the worktree's [gate page](#gate-pages), with a link that
  opens it in a tab of its own.
- **Terminal**: how to reach the driver's pane, as the terminal adapter's
  `attach` gives it (a command to copy, or a URL to open), and a button that
  opens a separate pane with your login shell (`$SHELL` of the supervisor) in
  the worktree. With no `attach`, the tab can only open the shell pane.
- **Actions**: the actions offered in the worktree status now, with their fields
  (see [`actions`](#actions)). Run starts the chosen one in a pane of its own.

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
- **`adapters`**: `worktrees`, `terminal`, `services`, `actions`. An omitted
  adapter is the bundled default with its default options. See
  [Adapters](#adapters).
- **`pollEvery`** (duration, default `"10s"`): how often the services are
  listed, and how often a worktrees adapter without `watch()` is read.
- **`projects`**: settings per project id: `name` (shown on the dashboard) and
  `driver` (this project's driver command, instead of the workspace's).
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

The Inbox view lists the items that feeds filed and that wait, in start order:
priority, then the order the poll returned them, then the time gtd first saw
them. It also names each failing feed.

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

The statuses stay current while the supervisor runs. A commit, a new branch or a
new worktree shows within a few seconds. An edit that is not committed shows
within about 30 seconds: every 30 seconds the supervisor runs `gtd next` in
every worktree again.

When a worktrees adapter read fails, each worktree it covers keeps its last
known status, greyed and marked "worktrees unavailable", and a banner above the
projects shows the error. Both go away after the next good read.

## Service chips

Each worktree shows its services as chips: the name, whether the service runs,
and its error. A chip with a URL links to it. gtd owns no DNS: the URL is the
one the services adapter reports. The supervisor lists the services when it
starts and then every `pollEvery`.

## Proceed and Retry

A worktree that needs you has Proceed. A worktree in error has Retry. Each sends
the HEAD commit that the page showed. gtd refuses the press when the worktree's
HEAD is now a different commit. Else it runs `<driver> proceed <commit>` or
`<driver> retry <commit>` in the worktree (see
[Workspace drivers](./driver.md#workspace-drivers)). When the driver answers
that no driver runs (exit 2), gtd starts the driver and sends the press again
for up to 5 seconds. A refusal shows on the worktree, with the driver's first
line of stderr, until the next accepted press or a new HEAD.

The API is the tRPC mutations `proceed` and `retry` under `/trpc`, each with
`{ worktree, commit }`: `worktree` is the worktree's `path` and `commit` is its
`head` as the query `projects` returns them. A refusal answers 409 with the
reason; an unknown worktree answers 404.

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
| `services`  | pitchfork | `pitchfork()`            |
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

### `terminal`

- **`run(project, worktree, argv, env)`**: opens a new pane in the worktree with
  `argv` as the pane's own top process, and returns a handle (a string). `argv`
  gets the environment of your login shell, with `env` applied after the shell's
  startup files. The pane stays open after `argv` exits.
- **`status(handle)`**: `{ record, alive, busy, exit }`, or `undefined` when the
  pane is gone. `record` is the root OSC 7501 record (`state`, `kind`, `title`,
  `msg`). `exit` is `{ code }` once `argv` has ended (`128 + n` for signal `n`),
  else `null`.
- **`close(handle)`**, and optionally **`attach(handle)`** (a command or a URL
  that shows the pane to a person, for the dashboard's Terminal tab) and
  **`watch()`** (hints, each a handle whose status may have changed).

`rex({ server, shell })` opens one Rex session per project id and one window per
pane. `server` is a Rex server address as `rex -S` takes it; `shell` is the
login shell (Rex's default when absent).

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
`$XDG_STATE_HOME`). Nothing goes into your repositories. Deleting that state
loses only the dismissals; the next polls file every waiting item again.

Every state change (Proceed, Retry, Dismiss, a new shell pane) adds one JSON
line to `audit.log` in that directory: `time`, `identity` (the tailnet login,
`-` when unknown), `endpoint`, `project`, `worktree`, `action` and `outcome`. It
never holds the values of fields. When the log reaches 1 MiB, it moves to
`audit.log.1`, replacing the older one.
