# Workspace

`gtd workspace` runs one dashboard and supervisor over all the projects of a
workspace. It shows the status of every worktree of every project, serves each
worktree's gate page, starts your [driver](./driver.md#workspace-drivers), and
dispatches the work that your feeds find.

gtd still runs no turn and makes no commit itself. Your driver and your actions
do that.

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

### Commands for your scripts

| Command                                                        | See                                     |
| -------------------------------------------------------------- | --------------------------------------- |
| `gtd workspace proceed <worktree> <commit>`                    | [Proceed and Retry](#proceed-and-retry) |
| `gtd workspace retry <worktree> <commit>`                      | [Proceed and Retry](#proceed-and-retry) |
| `gtd workspace note <worktree> [message] [--error] [--notify]` | [Notes](#notes)                         |
| `gtd workspace note <worktree> --clear`                        | [Notes](#notes)                         |
| `gtd workspace pause [project [feed]] [--wait]`                | [Pause](#pause)                         |
| `gtd workspace resume [project [feed]]`                        | [Pause](#pause)                         |

Each finds the workspace like `gtd workspace` does, or uses the
`gtd.workspace.ts` that `--config <path>` names, and reaches the running
supervisor through its socket (see [Security](#security)). The
[CLI reference](./cli.md#gtd-workspace) lists their options.

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

The supervisor reloads the file each time you save it. A reload with a bad file
keeps the last good config, and a banner above the projects shows the findings
until a reload succeeds. A reload changes `driver`, `limits`, `projects`,
`notify`, `clean`, the feeds and the reactions, and polls each feed at once. A
poll that was running drops its result. The waiting items of a feed the file no
longer exports stay queued and do not start. `adapters`, `pollEvery` and `ui`
change only when the supervisor starts again.

### `workspace`

The one reserved export, made with `defineWorkspace`. Every key is optional.

- **`driver`**: the driver command, as an argv, for example `["my-driver"]`. See
  [Workspace drivers](./driver.md#workspace-drivers). Without a driver command
  for a project, gtd starts no driver there, and refuses Proceed and Retry.
- **`adapters`**: `worktrees`, `terminal`, `services`, `actions`,
  `notifications`. An omitted adapter is the bundled default with its default
  options. See [Adapters](#adapters).
- **`limits`**: `maxDrives`, the most drives in the workspace, and `wip`, the
  most drives in each project. No limit applies when a key is not set. See
  [Inbox](#inbox).
- **`pollEvery`** (duration, default `"10s"`): how often the services are
  listed, and how often a worktrees or terminal adapter without `watch()` is
  read. A duration is a whole number with `ms`, `s`, `m` or `h`.
- **`projects`**: settings per project id, as the worktrees adapter names the
  project: `name` (shown on the dashboard), `driver` (this project's driver
  command, instead of the workspace's), `wip` (instead of `limits.wip`),
  `notify` (as below, for this project) and `clean: false` (no auto-clean in
  this project). An id that no project has shows a banner.
- **`notify`**: switches each notification kind on (`true`, the default) or off
  (`false`): `needsYou`, `error`, `proposed`, `feedFailing`, `configError`,
  `mainStale`. See [Notifications](#notifications).
- **`clean`**: `{ every: "<duration>" }` turns on [auto-clean](#auto-clean),
  with a pass each `every`. Without it, nothing is cleaned.
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
  dispatch. gtd runs it each time it tries to dispatch the item. An item it
  holds, or holds by a throw, waits with the reason.

`ctx` has `exec(argv, { cwd })`, `fetch` and `log(message)`. `exec` runs argv
without a shell, in the project's main checkout unless `cwd` is given, and
returns `{ status, stdout, stderr }`; a non-zero exit does not throw. `log`
writes to the supervisor's output.

An item has these fields:

- **`key`**: unique for the feed;
- **`title`**;
- **`url`** (optional);
- **`action`**: the start action that begins the work, for example
  `start:feature`;
- **`priority`**: a number; a higher number starts first;
- **`blockedBy`** (optional): keys of items that must start first. Use
  `<feed>/<key>` for an item of another feed;
- **`branch`** (optional): start the work in the existing worktree of this
  branch;
- **`data`** (optional): any JSON. gtd passes it on and never reads it.

gtd adds `feed` and `project` to each item. A poll that throws, or that returns
something other than a list of such items with unique keys and no other fields,
fails the feed (`feedFailing`): its items stay as they were, and the other feeds
keep polling.

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

### Reactions

A reaction is a named export made with `reaction()` from
`@pmelab/gtd/workspace`. The export name is the reaction's name. Its `run` gets
each worktree status change that matches `on`.

```ts
import { reaction } from "@pmelab/gtd/workspace"

export const autofix = reaction({
  on: { to: "error", errorKind: "crashed" },
  run: async (change, ctx) => {
    if (change.atStartup) return
    const outcome = await ctx.retry(change.commit)
    if (!outcome.ok) ctx.log(`retry refused: ${outcome.message}`)
  },
})
```

- **`on`**: the change must match each key given; an array matches any of its
  values. Keys: `project`, `from` and `to` (`needsYou`, `working`, `error`,
  `idle`; `to` also `cleaned`), `errorKind` (`stalled`, `crashed`, `driver`,
  `note`) and `kind` (what the driver waits for). `{}` matches every change.
- **`run(change, ctx)`**: `change` has `project`, `worktree` (the path),
  `branch`, `from` (absent for a worktree gtd had not seen), `to`, `errorKind`,
  `kind`, `label`, `message`, `commit` (the HEAD commit at the change) and
  `atStartup`.

A change is a new status, or a new error kind. An error note is a change to
`error` of kind `note`. Each change is delivered once to each reaction that
matches it, and one reaction gets its changes one at a time, in order.

`ctx` acts through the same paths as a person:

- **`action(id, values)`** runs the worktree's action, as the action picker
  does;
- **`proceed(commit)`** and **`retry(commit)`** press Proceed or Retry, as the
  dashboard does, and are refused in the same cases. The audit log names the
  endpoint `reaction:<name>`;
- each of these returns `{ ok: true }` or `{ ok: false, message }`;
- **`notify({ title, body, priority })`** sends a notification that links to the
  worktree's detail;
- **`exec`**, **`fetch`** and **`log`** are as for feeds; `exec` runs in the
  worktree unless `cwd` is given, and `log` lines start with `reaction <name>:`.

A `run` that throws is printed (`reaction <name> failed: …`), and a banner on
the dashboard shows it until a run of that reaction goes through; the other
reactions and the feeds keep running.

The supervisor keeps the last worktree statuses in its state store. When it
starts, it delivers what changed while it was down, with `atStartup: true`. With
no state store (the first start, or after you deleted it), the statuses at
startup are a silent baseline.

### Testing reactions

`testReaction(reaction, change, { exec, fetch, answer })` from
`@pmelab/gtd/testkit` delivers one change to a reaction, under any test runner.
`exec` and `fetch` answer the reaction's `ctx`. `answer(call)` answers
`ctx.action`, `ctx.proceed` and `ctx.retry` (default: `{ ok: true }`).
`atStartup` is `false` unless the change sets it.

```ts
import { testReaction } from "@pmelab/gtd/testkit"
import { autofix } from "./gtd.workspace.ts"

const { ran, failure, logs, calls } = await testReaction(autofix, {
  project: "portal",
  worktree: "/code/portal.wt/build",
  branch: "build",
  from: "working",
  to: "error",
  errorKind: "crashed",
  label: "Build",
  commit: "4f2a…",
})
// calls: [{ call: "retry", commit: "4f2a…" }]
```

`ran` is `false` when the change does not match `on`. `failure` is set when
`run` throws. `calls` lists each `action`, `proceed`, `retry` and `notify` in
order.

## Inbox

The Inbox view lists the items that feeds filed and that have not started, in
start order: priority, then the order the poll returned them, then the time gtd
first saw them. It also names each failing feed, and shows the drives in use,
out of `limits.maxDrives` when it is set. A drive is a worktree where a driver
runs, or where an item is starting.

| State    | When                                                                                    |
| -------- | --------------------------------------------------------------------------------------- |
| proposed | A `propose` feed filed it; it waits for a person.                                       |
| queued   | A `queue` feed filed it, or a person started it, and it waits to start.                 |
| blocked  | It is queued, and an item it names in `blockedBy` is still in the inbox.                |
| starting | gtd dispatches it: its worktree, services and start action are on their way.            |
| failed   | Its dispatch failed. It stays, with the reason, until a person retries or dismisses it. |

gtd dispatches each queued item by itself: the items of a `queue` feed, and the
items a person started. **Start** starts a proposed item; **Retry** starts a
failed one again. gtd tries the queued items in start order after each poll of a
feed, and after each Start or Retry. It does not dispatch until every feed has
polled once since the supervisor started, so that a blocker of another feed is
in the inbox. An item waits, queued, with the reason, when:

- an item it names in `blockedBy` is in the inbox (it shows as blocked),
- `limits.maxDrives` drives are in use in the workspace,
- `wip` drives are in use in its project (`projects.<id>.wip`, else
  `limits.wip`),
- dispatch is paused for it (see below),
- its feed's `canStart` returns `false` or throws.

To dispatch an item, gtd:

1. picks the worktree: the item's `branch`, else the branch `<feed>/<key>`, with
   each run of characters other than letters, digits, `.`, `_` and `-` in the
   key written as one `-`. When a worktree is on that branch, gtd uses it only
   when it is free: its process has ended, no driver runs in it, its tree is
   clean and no other item is starting in it. Otherwise the item waits, queued,
   with the reason. When no worktree is on the branch, gtd creates one.
2. starts the worktree's services,
3. runs the item's start action in a pane of its own, with `GTD_WORKSPACE_ITEM`:
   the item as JSON (`key`, `title`, `url`, `action`, `priority`, `blockedBy`,
   `branch`, `data`, `feed`, `project`),
4. when the action exits 0, starts the driver with the same
   `GTD_WORKSPACE_ITEM`.

The item is then started and leaves the Inbox. A feed that still returns its key
does not file it again until its worktree is removed. A step that fails makes
the item failed; a failed item stays when its feed stops returning it. An item
that was starting when the supervisor stopped is still starting when it starts
again, while the pane of its start action is there; otherwise it is failed.

**Dismiss** hides a proposed or failed item until its feed stops returning it. A
later poll that returns the key again files it anew.

### Pause

A pause stops dispatch for the whole workspace, for one project, or for one feed
of a project. The Inbox view has a pause control for each, and so has the
command line:

```sh
gtd workspace pause                  # the workspace
gtd workspace pause portal           # the project portal
gtd workspace pause portal bugs      # the feed bugs of portal
gtd workspace pause portal --wait    # and wait until no driver runs in portal
gtd workspace resume portal          # take the pause of portal off
```

An item that a pause holds waits, queued, with the reason. Feeds go on polling,
and drivers that run go on. `resume` takes off the pause of exactly that scope
and starts the items that can start now; a pause of a wider scope still holds
them. With `--wait`, `pause` returns once no driver runs in that scope and no
item is starting in it; for a feed, that is the worktrees of its items. A ship
script can then deploy, and resume after. The pauses stay when the supervisor
restarts. The query `inbox` gives them as `paused: [{ project?, feed? }]`. An
unknown project or feed, or a supervisor that is not running, exits 1.

## Worktree status

The supervisor runs `gtd next --json` in each worktree, so a process that was
handed over runs on its own pin. It also reads the status that the worktree's
driver reports in its terminal pane.

| Status    | When                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| needs you | The process waits for a person or a judge, the driver reports that it is blocked, or the process waits for an agent or a check and no driver runs ("no driver runs"). |
| working   | The driver reports that it works, or it runs while the process waits for an agent or check.                                                                           |
| error     | The driver reports an error, the driver crashed, the process stalled, `gtd next` failed, or an error note is on the worktree.                                         |
| idle      | The process has ended, or the worktree has none.                                                                                                                      |

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
status no longer fits the button, when its HEAD is now a different commit, or
when its project has no driver command. Else it runs `<driver> proceed <commit>`
or `<driver> retry <commit>` in the worktree (see
[Workspace drivers](./driver.md#workspace-drivers)). When the driver answers
that no driver runs (exit 2), gtd starts the driver and sends the press again
for up to 5 seconds. A refusal shows on the worktree, with the driver's first
line of stderr, until the next accepted press or a new HEAD.

The API is the tRPC mutations `proceed` and `retry` under `/trpc`, each with
`{ worktree, commit }`: `worktree` is the worktree's `path` and `commit` is its
`head` as the query `projects` returns them. A refusal answers 409 with the
reason; an unknown worktree answers 404.

From a script, `gtd workspace proceed <worktree> <commit>` and
`gtd workspace retry <worktree> <commit>` press the same buttons. `<worktree>`
is the worktree's path, relative to the current directory or absolute. The
command finds the workspace like `gtd workspace` does and reaches its running
supervisor. It exits 0 when the press is accepted. It exits 1 with the reason
when the press is refused, and with "supervisor not running" when no supervisor
runs. Its audit line has the endpoint `cli`.

## New worktree and Remove

In the Projects view, each project has a New worktree button, and a worktree's
detail has a Remove button (not on the main checkout). Remove first shows what
would be lost, and a second press confirms it. Scripts use the tRPC mutations
`createWorktree` with `{ project, branch, base }` (`base` is optional) and
`removeWorktree` with `{ project, worktree, confirmed }`, where `worktree` is
the worktree's `path` as the query `projects` returns it. A branch or base that
New worktree refuses answers 400, a worktree that Remove keeps 409, an unknown
project or worktree 404, and a worktrees adapter without `create` or
`remove` 412.

New worktree takes a project and a branch name. The supervisor refuses a name
that git does not take as a new branch, and a branch that a worktree of the
project is on already. Then it creates the worktree with the worktrees adapter
and starts its services. It answers `{ path }`, the new worktree's path. A
worktree whose services do not start stays, and the answer's `failure` says why.

Remove stops the worktree's services, closes the terminal panes that gtd opened
in it, then removes the worktree and its branch. It returns when the worktree is
gone. Remove keeps a worktree, and says why, when:

- it is the project's main checkout,
- its process has not ended (`gtd next` does not report it as idle),
- its driver runs,
- a pane that gtd opened in it runs a command,
- an item is starting in it,
- it has an error note.

Remove asks for confirmation when the tree has uncommitted changes (untracked
files count) or when the branch is not integrated: without `confirmed: true`, it
answers `{ confirm }`, the list of what would be lost, and removes nothing. A
confirmed Remove throws away those changes and commits.

## Auto-clean

With `clean: { every }`, the supervisor runs a clean pass each `every`, the
first one `every` after it starts. A project with `clean: false` in `projects`
is left out.

A pass first refreshes the project's main checkout with the worktrees adapter's
`refresh`, so that `integrated` is told against a current default branch. A
refresh never resets or rebases. A main checkout that it cannot bring up to date
is stale: a banner and the project's heading in the Projects view show the
reason until a pass refreshes it, and a `mainStale` notification is sent.

Then the pass removes each worktree that the adapter reports as integrated
(`true`; `undefined` never counts) and whose tree is clean (`dirty: false`),
unless Remove would keep it (see
[New worktree and Remove](#new-worktree-and-remove)). A removal is a Remove
without force: it stops the services, closes the panes, removes the worktree and
its branch, and writes an audit line with the endpoint `clean` and the action
`clean`. The item started in the worktree ends: the next poll of its feed files
it anew, or drops it. Each reaction whose `on` matches gets a change
`to: "cleaned"`. A removal that fails is printed
(`clean <project>/<worktree>: …`) and tried again on the next pass.

## Notes

A note shows a shipping, merge or deploy outcome on a worktree. gtd does not
ship, merge or deploy: your scripts do, and report the outcome with
`gtd workspace note <worktree> <message>`. A new note takes the place of the
last one. With `--error`, the worktree status becomes an error of kind `note`,
with the message, and Remove keeps the worktree. A worktree that is in error
already keeps that error. `gtd workspace note <worktree> --clear` takes the note
off. With `--notify`, the note is also sent as a notification; without it, a
note sends none.

`<worktree>` is the worktree's path, as for `gtd workspace proceed`. A path that
is no worktree exits 1. When no supervisor runs, the command exits 0 and the
note waits in `spool/` in the supervisor's state directory. The supervisor
applies the spooled notes in order when it starts, before it opens its socket,
and prints a line for each one whose path is no worktree. The notes stay when
the supervisor restarts. The query `projects` gives a worktree's note as
`note: { message, error }`.

## Notifications

The supervisor sends a notification through the notifications adapter when:

| Kind          | When                                                | Links to                 | Priority |
| ------------- | --------------------------------------------------- | ------------------------ | -------- |
| `needsYou`    | a worktree needs you                                | the worktree's gate page | high     |
| `error`       | a worktree is in error                              | the worktree's detail    | high     |
| `proposed`    | a feed proposes an item                             | the dashboard            | default  |
| `feedFailing` | a feed's poll fails                                 | the dashboard            | low      |
| `configError` | `gtd.workspace.ts` does not reload                  | the dashboard            | default  |
| `mainStale`   | auto-clean cannot refresh a main checkout           | the dashboard            | default  |
| note          | `gtd workspace note --notify` (high with `--error`) | the worktree's detail    | default  |
| reaction      | a reaction's `ctx.notify`                           | the worktree's detail    | default  |

`notify` in `workspace`, and in each project of `projects`, switches a kind off
(`false`) or on. A project's own switch wins. A note sent with `--notify` always
notifies. The worktree's detail is the dashboard at `/?worktree=<path>`.

Each notification has a key, and no key is sent twice, also after a restart:

- `needsYou:<project>/<worktree>:<commit>` and
  `error:<project>/<worktree>:<commit>`, where `<commit>` is the worktree's HEAD
  commit. When the driver reports the status (what it waits for, an error, a
  crash), its label follows the commit.
- `proposed:<feed>/<key>`, `feedFailing:<feed>`, `configError:<findings>` and
  `mainStale:<project>`. A feed that recovers, a config that reloads, or a main
  checkout that refreshes, can notify again the next time it fails.

A kind that is off sends nothing, and turning it on later sends nothing for what
happened while it was off. A notification that cannot be published is printed
(`notification <key> not sent: …`) and not sent again.

The supervisor keeps the sent keys in its state store. When it starts, it sends
what changed while it was down. With no state store (the first start, or after
you deleted it), what is true at startup is a silent baseline: the worktree
statuses and each feed's first poll send nothing.

## Gate pages

The supervisor also serves the gate page of every worktree, at
`/<project>/<worktree>/gate`. `<worktree>` is the branch, or the directory name
of a worktree with a detached HEAD. A `/` in the project id or the branch is
written `%2F`. The page is the page of `gtd ui` for the rest the worktree is at
now. No `gtd ui` runs for it. An edit made on a gate page rechecks the status of
that worktree at once.

## Adapters

| Adapter         | Default   | Factory                          |
| --------------- | --------- | -------------------------------- |
| `worktrees`     | worktrunk | `worktrunk({ roots })`           |
| `terminal`      | rex       | `rex({ server, shell })`         |
| `services`      | pitchfork | `pitchfork()`                    |
| `actions`       | mise      | `mise()`                         |
| `notifications` | ntfy      | `ntfy({ topic, server, token })` |

The factories come from `@pmelab/gtd/workspace/adapters`. To use another tool,
give an object that implements the adapter's interface from
`@pmelab/gtd/workspace`, and test it with the contract-test kit from
`@pmelab/gtd/workspace/adapters/testkit`. It has one function per adapter:
`worktreesContract`, `terminalContract`, `servicesContract`, `actionsContract`
and `notificationsContract`. Each takes a harness `{ setup }`, where `setup`
returns a fresh fixture for one case: your adapter, the world it looks at, and
`dispose`. The fixture types (`WorktreesFixture`, `TerminalFixture`, …) say what
each kit needs. Each function returns the cases, each `{ name, run }`, for any
test runner:

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
  `{ path, branch, head, main, integrated, dirty }`. `integrated` is `true` when
  the branch has commits of its own and all of them are on the default branch
  (squash merges count), and `undefined` when the adapter cannot tell. `dirty`
  is `true` when the tree has uncommitted changes (untracked files count), and
  `undefined` or absent when the adapter cannot tell.
- **`create(project, branch, base)`** (optional): a new worktree on the new
  branch `branch`, made from `base` (default: the default branch). Returns the
  worktree's path. Without it, New worktree is refused.
- **`remove(project, worktree, { force })`** (optional): removes the worktree at
  the path `worktree` and deletes its branch, and returns when the removal is
  complete. Without `force` it fails on a dirty tree and keeps a branch that is
  not merged. Without it, Remove is refused.
- **`refresh(project)`** (optional): brings the project's main checkout up to
  date, never by a reset or rebase, and answers `{ state: "ok" }` or
  `{ state: "stale", reason }`. Auto-clean calls it before each pass; a throw
  counts as stale. Without it, auto-clean uses the main checkout as it is.
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
root is a project. `create` runs `wt switch --create`, so your worktrunk config
decides where the worktree goes, and its hooks run; `remove` runs
`wt remove --foreground`. `refresh` runs `git fetch` and `git merge --ff-only`
against the main checkout's upstream; a main checkout without an upstream is
left as it is. Its `watch()` watches the git directories of each project (not
`refs/remotes`, so a fetch is no change) and installs nothing into your
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
login shell (Rex's default when absent). It has `watch()` but no `attach`, so
its Terminal tab can only open the shell pane.

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
shell. Every action gets `GTD_WORKSPACE_STATUS`, a JSON object with `status`
(`idle`, `needsYou`, `working` or `error`), `errorKind` (`stalled`, `crashed`,
`driver` or `note`) and `message` (when the worktree has them) and `commit` (the
worktree's HEAD commit). When a start action exits 0, the supervisor starts the
driver.

`mise()` makes the mise tasks of the worktree into actions: `start:*` for idle,
`gate:*` for needs you, `error:*` for error and `any:*` for any status. Hidden
tasks are left out. The task's description is the label, and its usage spec
gives the fields: each `arg` is a text field, each `flag` that takes a value is
a text field, each flag without a value is a flag field, and one with `choices`
is a select field. mise reads a flag's value that spells one of the task's own
flags (for example `--dry`) as that flag, so `mise()` refuses such a value.

### `notifications`

- **`publish({ key, title, body, url, priority })`**: delivers one notification.
  `url` is where a tap leads, or `undefined`. `priority` is `high`, `default` or
  `low`. The supervisor sends each key once; the adapter may ignore `key`. Fails
  with an adapter error.

`ntfy({ topic, server, token })` publishes to the ntfy topic `topic` on `server`
(default `https://ntfy.sh`), with `token` as an access token for a protected
topic. Anyone who knows a topic on a public server can read it. Without a
`notifications` adapter, the supervisor publishes to a random topic on
`https://ntfy.sh`, kept in the file `ntfy-topic` in its
[state directory](#security). At each start, after the URL line, the supervisor
prints the line `notifications: subscribe to <url>` with the topic's URL:
subscribe to it in the ntfy app.

## Security

Every request, to the dashboard and to the gate pages, must come from a tailnet
user in `ui.users`. Other users get 403. With `--http`, your proxy is trusted to
check the user. Requests that change state must be POSTs with a JSON body from
the dashboard's own origin.

The commands for your scripts reach the supervisor through the unix socket
`socket` in its state directory. Only you can open it: the socket is 0600 and
its directory 0700. These file permissions are the authentication.

The supervisor keeps its state in a directory of its own for each workspace,
below `~/.local/state/gtd/workspace/` (`$XDG_STATE_HOME/gtd/workspace/` when
that is set). The directory's name is a hash of the workspace root. Nothing goes
into your repositories. Deleting that state loses the dismissals, the notes, the
pauses, the sent notification keys (the next start is a silent baseline), the
default ntfy topic and what gtd knows of started and failed items; the next
polls file every waiting item again.

These state changes add one JSON line: Proceed, Retry, Dismiss, New worktree,
Remove, a new shell pane, Start and Retry of an item, Note, Pause and Resume,
and each auto-clean removal. A run of an action adds none. The lines go to
`audit.log` in that directory, with `time`, `identity` (the tailnet login, `-`
when unknown), `endpoint`, `project`, `worktree`, `action` and `outcome`. It
never holds the values of fields. When the log reaches 1 MiB, it moves to
`audit.log.1`, replacing the older one.
