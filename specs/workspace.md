# Spec: `gtd workspace`

> **Draft on branch `spec/workspace`. Do not merge this file.** It is the input
> for the implementation issues. The ADR, glossary and docs changes on this
> branch are drafts too: they go to `main` together with the implementation, and
> this file is deleted then.

Wayfinder map:
[Workspace: bring the bench loop and dashboard into gtd](https://github.com/pmelab/gtd/issues/589).
Each section links the ticket that holds the full decision and its reasons.

## 1. Goal

`gtd workspace` is a long-running supervisor and dashboard over many projects.
It takes over the reusable parts of the workbench (`pmelab/workbench`): the
status pipeline, the dashboard, the gate pages, the inbox and dispatch, and the
notifications. These are not in scope:

- a terminal UI;
- a built-in driver or agent runner;
- the Foreman, experts, fnox, skills and workflow pins;
- machine networking (tailscale serve, DNS).

The driver, the workflows, the triggers, the row actions and machine setup stay
in userland.

Rules that apply to the full spec:

- gtd still executes no turn and commits nothing (ADR 0001, amended). It starts
  a configured driver command and runs configured actions.
- History stays the only process state (ADR 0002, scoped). The supervisor keeps
  a small rebuildable state store outside every repository (ADR 0011).
- Every external tool is behind an adapter with a bundled default (ADR 0013).
- Stack: gtd's existing stack (TypeScript, Effect, React, tRPC, Tailwind, Radix
  tokens, Storybook) and the `gtd ui` design.
- Do not build this with gtd: no gtd process or workflow drives the
  implementation.

## 2. Terms

See the "Workspace" section of `GLOSSARY.md` on this branch: Workspace, Project,
Supervisor, Adapter, Driver command, Rest id, Row, Action, Trigger, Inbox, Item,
Propose / Queue, Dispatch, Dismiss, Mark, Reaction, Integrated.

The internal port that reads and writes repository files (today named
`Workspace`) is renamed, for example to `RepoFiles`, so that the domain term is
free.

## 3. Row status

([Driver contract](https://github.com/pmelab/gtd/issues/594),
[Change detection](https://github.com/pmelab/gtd/issues/592))

Each worktree is one row. Its status comes from two sources:

1. `gtd next --json`, run by the supervisor as a subprocess in the worktree, so
   that hand-over uses the process's own pin. It gives the actor, step, beat
   kind, label, `ended`, and two new additive fields:
   - `rest`: the rest id, `<full HEAD sha>/<step name>`.
   - the judge file of a judge rest (field name decided at implementation). It
     replaces the workbench driver's `JUDGE_FILES` map.
2. The root OSC 7501 record of the driver's pane (no `id`): `state`, `kind`,
   `title`, `msg`. gtd ignores `app`, `progress` and child records.

| Row       | Rule                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| needs you | The actor is not `agent` or `check` (an allowlist), and the driver is blocked or absent. |
| working   | The OSC record says working.                                                             |
| error     | The OSC record says error, `gtd next` reports stalled or an error, or an error mark.     |
| idle      | The process has ended, or there is no process.                                           |

`kind` changes only the label of a "needs you" row. A driver that prints no OSC
still gets correct needs-you, idle and error rows.

**Error kinds:** `crashed` (the drive wrapper reported it), `stalled`, `driver`
(the OSC error record, with its message), `mark` (an error mark).

**Change detection.** The worktrees adapter emits "project X may have changed"
hints. The default watches each git directory per directory (common dir, each
`refs/` directory except `refs/remotes`, `worktrees/` and each
`worktrees/<n>/`). It installs nothing into the checkouts. A safety rescan runs
about every 30 s, and a full scan runs at startup. Core debounces the hints and
runs one recheck per project at a time. An edit made through a gate page starts
a recheck at once. Other uncommitted edits are found by the rescan.

## 4. Driver contract

([Driver contract](https://github.com/pmelab/gtd/issues/594))

The driver command is an argv: a workspace default, with an optional override
per project. It is an opt-in extension of the driver protocol. The beat protocol
does not change. The user-facing text is the "Workspace drivers" section of
`docs/driver.md` on this branch.

- **Start:** gtd runs `gtd workspace drive -- <driver>` in a new pane. The
  driver takes no arguments. It resumes where replay rests, and it waits if that
  is a rest. A driver that lands its opening beat when it starts is not a valid
  workspace driver.
- **One-shots**, run as subprocesses with the worktree as cwd:
  `<driver> proceed <rest-id>`, `<driver> retry <rest-id>`, `<driver> quit`.
  - Exit 0: accepted.
  - Exit 1: refused (stale or busy). The dashboard shows stderr.
  - Exit 2: no driver runs.
- **Proceed with no driver:** gtd starts the driver, then repeats the one-shot
  while it gets exit 2, for a few seconds at most.
- **Stale rest ids:** gtd compares the rest id with a fresh `gtd next` before it
  sends an action. The driver compares again when the action arrives.
- **Wrapper:** `gtd workspace drive` runs the driver, reports its exit code to
  the supervisor, then runs `$SHELL`.
  - done: exit 0 and the process has ended;
  - quit: exit 0 mid-flow, or exit 130 or 143;
  - crashed: any other exit. The row becomes an error with Retry.
- **Orphans:** a worktree at an `agent` or `check` rest with no driver running.
  Orphans found at supervisor startup restart automatically. A crash reported by
  the wrapper never restarts automatically.
- **Environment:** `GTD_WORKSPACE_ITEM` (the item as JSON, section 7) when the
  driver starts for an item.

## 5. Adapters

([Adapter contracts](https://github.com/pmelab/gtd/issues/595),
[Default adapter tools](https://github.com/pmelab/gtd/issues/591),
[Auto-clean](https://github.com/pmelab/gtd/issues/603))

Each adapter is a plain TypeScript interface of Promises and `AsyncIterable`s,
with no Effect. `gtd.workspace.ts` picks a bundled default or gives any object
that implements the interface. Core wraps each adapter in an Effect service and
has an in-memory twin of each one (ADR 0008). gtd exports a contract-test kit
that every adapter, bundled or userland, must pass.

**Reads:** each read port has a full snapshot and an optional `watch()`. A watch
emits hints with no data, and core then reads the snapshot again. Core polls an
adapter that has no `watch()` at `pollEvery`. When a watch stream reconnects,
core reads a full snapshot of that adapter (rex does not replay events).

**Errors:** every operation fails with `{ adapter, op, message, detail }`. A
failed action shows on the row. A failed read keeps the last snapshot, greyed,
with "<adapter> unavailable".

| Adapter       | Default   | Operations                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| worktrees     | worktrunk | `projects()` (scans the configured `roots`); `list(project)` → path, branch, HEAD, main, `integrated: true \| false \| undefined`; `create(project, branch, base?)` → path; `remove(project, worktree, { force })`, which returns when the removal is complete (worktrunk `--foreground`); optional `refresh(project)` → `ok` or `stale` with a reason (dirty, diverged, detached, fetch failed); `watch()` |
| terminal      | rex       | `run(project, worktree, argv, env)` opens a new pane with argv as its command and returns a handle (it never types into a shell); `status(handle)` → root OSC record, alive, busy; `close(handle)`; optional `attach(handle)` → a command or URL for the Terminal tab; `watch()`                                                                                                                            |
| services      | pitchfork | `list(project, worktree)` → name, URL?, running, error; `up(worktree)`; `down(worktree)`. Core calls `up` after `worktrees.create` and `down` before `worktrees.remove`.                                                                                                                                                                                                                                    |
| actions       | mise      | `list(worktree)` → id, label, fields (flag, select or text; required, choices, help); `argv(worktree, id, values)` → the command line.                                                                                                                                                                                                                                                                      |
| notifications | ntfy      | `publish({ key, title, body, url, priority })`                                                                                                                                                                                                                                                                                                                                                              |

- `integrated: true` means that the branch has commits of its own and all of
  them are on the default branch (squash merges count). `undefined` means that
  the adapter cannot tell.
- `refresh` never resets or rebases.
- **Actions** only describe themselves. Core runs the argv with `terminal.run`
  in its own pane, never in the driver's pane. Each field value is one argument,
  never shell-interpolated. The contract-test kit checks this with hostile
  values. The mise default uses task-name prefixes: `start:*` (idle rows),
  `gate:*` (needs you), `error:*` (error), `any:*`. Every action gets
  `GTD_WORKSPACE_ROW` as JSON: status, error kind, message, rest id. When a
  `start:*` action exits 0, core starts the driver.
- **Notifications:** core removes duplicates by key.
- The OSC record lifetime under rex becomes a `@live` contract test of the rex
  adapter.

## 6. Configuration: `gtd.workspace.ts`

([gtd.workspace.ts shape](https://github.com/pmelab/gtd/issues/597))

The user-facing reference is `docs/workspace.md` on this branch. In short:

- Triggers and reactions are named exports through `trigger()` and `reaction()`.
  The export name is the name.
- One reserved export, `workspace`, from `defineWorkspace` in
  `@pmelab/gtd/workspace`. Keys: `driver`, `adapters`, `limits`, `pollEvery`,
  `projects`, `notify`, `clean`, `ui`. Unknown keys are rejected at every depth.
- Adapter factories come from `@pmelab/gtd/workspace/adapters`.
- Lookup: the innermost `gtd.workspace.ts` from the current directory, or
  `--config <path>`. The workspace root is the file's directory.
- A bad config at startup exits 1. A bad config on reload is not applied: the
  last good config stays, and the dashboard shows a banner. A throwing `poll`,
  `canStart` or `run` is caught for each trigger or reaction.
- Same trust as `gtd.config.ts`: the supervisor runs it in its own process.

## 7. Triggers, the inbox and dispatch

([Triggers and the inbox](https://github.com/pmelab/gtd/issues/596))

- `trigger({ project, every, mode, poll, canStart? })`. `poll(ctx)` returns
  every item that matches now. gtd compares the result with the inbox: it adds
  new keys, updates known ones, and drops waiting items that no longer match.
  `ctx` gives `exec`, `fetch` and `log`, which have twins.
- **Item fields:** `key` (unique per trigger), `title`, `url?`, `action` (a
  `start:*` action id), `priority`, `blockedBy` (keys, also of other triggers),
  `branch?`, `data` (free JSON, never read by gtd). gtd adds `trigger` and
  `project`. `GTD_WORKSPACE_ITEM` carries exactly these fields.
- **States:** `proposed`, `queued`, `blocked` → `starting` → `started` or
  `failed`. `failed` stays until Retry or Dismiss. `started` ends when the
  worktree is removed. Shipped, merged, red checks and deploys are userland.
- **Modes:** `propose` items need a person's Start (which queues them) or
  Dismiss. `queue` items are dispatched automatically. A dismissed key stays
  hidden until the trigger stops returning it.
- **Dispatch:** gtd creates the worktree, or uses the free existing worktree
  named by `branch`, calls `services.up`, and runs `start:<action>` with
  `GTD_WORKSPACE_ITEM`. The driver starts when the action succeeds. A worktree
  is free when no process is mid-flow, no driver runs and the tree is clean;
  otherwise the item waits.
- **Order:** priority, then the order that `poll` returned, then the time first
  seen.
- **Limits:** `limits.maxDrives` (workspace), `wip` (per project). Blockers and
  `canStart(item, ctx)` are checked again at dispatch.
- **Pause** at three levels: workspace, project, trigger. Pause is runtime
  state, not config. `gtd workspace pause <project> --wait` returns once no
  driver runs in that project (this replaces the workbench dispatch lock).
- Hand-started work needs no item. Rows come from worktrees.
- **Testing:** `testTrigger(trigger, { exec, fetch, clock })` in
  `@pmelab/gtd/testkit`.

## 8. Marks, notifications and reactions

([Triggers and the inbox](https://github.com/pmelab/gtd/issues/596),
[Notification events](https://github.com/pmelab/gtd/issues/600),
[Auto-clean](https://github.com/pmelab/gtd/issues/603))

- `gtd workspace mark <worktree> --error <msg> | --note <msg> | --clear [--notify]`.
  An error mark makes the row an error of kind `mark`. A mark notifies only with
  `--notify`.
- `gtd workspace proceed|retry <worktree> <rest-id>`: the same calls the
  dashboard makes.
- **Built-in notifications** (each on by default, switchable in `notify` and per
  project): `needsYou` (a row starts needing you, or its label changes),
  `error`, `proposed`, `triggerFailing` (once per run of failures),
  `configError`, `mainStale` (once per reason).
- **Notification content:** key `<kind>:<project>/<worktree>:<rest id or label>`
  or `<kind>:<trigger>`; title is the kind; body is label, project/worktree and
  message; URL is the gate page for needs-you, else the row's detail; priority
  is high for needs-you and error, default for proposed, low for trigger
  failing.
- **Reactions:** `reaction({ on, run })`. `on` filters row changes, for example
  `{ to: "error", errorKind: "driver" }`; `cleaned` is a change too.
  `run(change, ctx)` gets project, worktree, status from and to, label, error
  kind, rest id and `atStartup`. `ctx` gives `action(id, values)`,
  `proceed(restId)`, `retry(restId)`, `notify(…)`, `exec`, `log`. gtd delivers
  each change once. `testReaction` is in the testkit.
- **Restarts:** the state store keeps the last status of each row and the sent
  keys. At startup gtd notifies and reacts only for rows whose status changed.
  It never sends a key twice. With no store, startup is a silent baseline, and
  reactions see `atStartup: true`.

## 9. Auto-clean

([Auto-clean of integrated worktrees](https://github.com/pmelab/gtd/issues/603))

- Opt-in: `clean: { every: "30m" }`, with a per-project override
  (`clean: false`). The default is off.
- Before each pass, core calls `worktrees.refresh` for each project.
- A worktree is removed only when `integrated` is `true` and nothing protects
  it. These protect it: main checkout, dirty tree (untracked files count), a
  process that has not ended, a running driver, a busy pane, an item in
  `starting`, an error mark.
- Removal: `services.down`, `terminal.close` on its idle panes, then
  `worktrees.remove` (the branch is deleted too). The item ends. An audit entry
  and a `cleaned` change are recorded. No notification by default.
- The dashboard's Remove button uses the same protections, but does not need
  `integrated`. It asks for confirmation when the tree is dirty or the worktree
  is not integrated.

## 10. Dashboard

([Workspace dashboard in gtd's design](https://github.com/pmelab/gtd/issues/593);
prototype on branch `prototype/workspace-dashboard`)

- **Now** (gates and errors across all projects, one primary button each, work
  in progress collapsed), **Projects** and **Inbox**.
- A worktree's detail pane: the gate page is the main content, with Terminal and
  Actions as tabs. It is full screen on a phone (bottom tab bar) and a side pane
  on a wide screen.
- Dark only, gtd's Radix palette and its contrast tests.
- Inbox controls: Start or Dismiss a proposed item, pause at all three levels,
  drives in use out of `maxDrives`.
- Kept from bench: service chips, one action picker (the actions valid for the
  row's status, with their fields), the new-worktree input with branch
  validation, the gate embedded from `/<project>/<worktree>/gate` with "open in
  tab".
- Banners: config reload error, adapter unavailable, stale main checkout,
  unknown project id in `projects`.
- One server serves the dashboard and every worktree's gate page. There are no
  per-worktree gate daemons.

## 11. Security

([Dashboard security](https://github.com/pmelab/gtd/issues/601), ADR 0014)

- Exposure as `gtd ui`: `tailscale serve`, a fallback to the tailnet interface,
  or `--http` on loopback behind a proxy (the proxy is trusted).
- Every request needs a tailnet identity (`Tailscale-User-Login` under serve,
  `tailscale whois` on a direct bind) that is in `ui.users`, else 403. The
  default is the node owner.
- State changes are POST-only, with a JSON content type and
  `Sec-Fetch-Site: same-origin` or a matching `Origin`. A GET never changes
  state.
- The same checks apply to gate pages and to standalone `gtd ui` (a user-visible
  change there; `config.ui.users` is new).
- Audit log: one line per state change (time, identity, endpoint,
  project/worktree, action id; no field values), rotated by size.
- The CLI socket is mode 0600. File permissions are its authentication.

## 12. The supervisor process

([How the supervisor itself runs](https://github.com/pmelab/gtd/issues/602))

- Machine setup starts it. gtd ships no daemon unit.
- One supervisor per workspace. State directory:
  `~/.local/state/gtd/workspace/<hash of workspace root>/` with `state.json`,
  `audit.log`, `spool/`, the socket and the lock. A second supervisor exits 1
  and prints the pid and URL of the first one.
- **Startup:** lock → config → state store (or silent baseline) → subscribe to
  all `watch()` streams → full scan → spool → compare with stored statuses
  (notifications, reactions) → restart orphans → serve → first trigger polls.
- **CLI:** `mark`, `proceed`, `retry`, `pause`, `resume` and `drive` find the
  workspace by the config lookup and use the socket. When the supervisor is
  down, `mark` and the drive wrapper's exit records go to `spool/`, and
  `proceed`, `retry`, `pause` and `resume` exit 1 with "supervisor not running".
- **Shutdown (SIGTERM):** stop polls and dispatch, save the store, close the
  server. Drivers continue in their panes.
- **State store:** row statuses, sent notification keys, the inbox (waiting
  items, dismissals, failures), pause flags, drive exit records. All of it is
  rebuildable: waiting items return with the next poll, started items from
  worktrees by branch. Only dismissals and failures are lost.

## 13. CLI

| Command                                                                             | Purpose                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------- |
| `gtd workspace [--config <path>] [--host …] [--port …] [--http] [--self-signed]`    | Run the supervisor and dashboard.                 |
| `gtd workspace drive -- <driver…>`                                                  | The driver wrapper (run by the terminal adapter). |
| `gtd workspace mark <worktree> --error <msg> \| --note <msg> \| --clear [--notify]` | Set or clear a mark.                              |
| `gtd workspace proceed\|retry <worktree> <rest-id>`                                 | Proceed or retry a rest.                          |
| `gtd workspace pause\|resume [<project> [<trigger>]] [--wait]`                      | Pause or resume dispatch.                         |

`gtd next --json` gains `rest` and the judge-file field (additive).

## 14. Migration of the workbench

([Migration order for the workbench](https://github.com/pmelab/gtd/issues/598))

Two dashboards may run at the same time. Never two dispatchers.

| Slice | Change                                                                                                                                                                                                                                    | Needs           | Rollback                               |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------- |
| A     | gtd releases `rest` and the judge-file field. `driver.py` adopts the one-shots, reads `rest`, reads ship mode from `GTD_WORKSPACE_ITEM.data`. Row tasks get the four prefixes (old names stay as aliases).                                | —               | Driver back to socket-only.            |
| B     | `gtd workspace` as a second pitchfork daemon, no triggers.                                                                                                                                                                                | Sections 11, 12 | Stop the daemon.                       |
| C     | `watch.toml` rules and ship follow-ups ported to triggers and marks in `propose` mode. Compare the inboxes.                                                                                                                               | —               | Delete the triggers.                   |
| D     | `bench:pause` ALL; triggers to `queue`; `ship.sh` and deploys use `mark` and `pause --wait`; autotriage and autofix become reactions.                                                                                                     | Section 8       | `bench:resume`, triggers to `propose`. |
| E     | After one week of D: delete `ui.py`, `ui.html`, `pane.py`, `tui.py`, and the queue, poll, dispatch, ingest, merge-check and deploy code of `bench.py`, plus their state. `gtd workspace` replaces the `bench/ui` daemon. Turn on `clean`. | Section 9       | `git revert`, `bench:deploy`.          |

The workbench keeps `driver.py`, `osc.py`, `ship.sh`, `sem.sh`, the workflows,
the row-action tasks and `bench:infra`. TypeScript enters the workbench only for
`gtd.workspace.ts` and `triggers/*.ts`, tested with `node:test` in `bench:test`.

## 15. Tests

- `@inmem` cucumber scenarios for all logic, with the adapter twins: row
  derivation, dispatch order and limits, pause, propose and dismiss, marks,
  reactions, notification dedup and restart diff, auto-clean protections, reload
  with a bad config, the spool.
- The exported contract-test kit, run against every bundled adapter and every
  twin. It includes hostile action field values and the `integrated` cases
  (fresh worktree, squash merge, normal merge).
- `@live` only where a real process alone shows it: the drive wrapper's exit
  codes and signals, the rex OSC record lifetime, the socket permissions, the
  bundled binary's wiring.
- Security scenarios: 403 for an unknown identity, refused cross-site POST,
  refused non-JSON POST, for the dashboard, the gate pages and `gtd ui`.
