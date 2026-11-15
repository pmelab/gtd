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

The driver, the workflows, the feeds, the worktree actions and machine setup
stay in userland.

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
Supervisor, Adapter, Driver command, Worktree status, Action, Feed, Inbox, Item,
Propose / Queue, Dispatch, Dismiss, Note, Reaction, Integrated.

The internal port that reads and writes repository files (today named
`Workspace`) is renamed, for example to `RepoFiles`, so that the domain term is
free.

## 3. Worktree status

([Driver contract](https://github.com/pmelab/gtd/issues/594),
[Change detection](https://github.com/pmelab/gtd/issues/592))

Each worktree has one worktree status. It comes from two sources:

1. `gtd next --json`, run by the supervisor as a subprocess in the worktree, so
   that hand-over uses the process's own pin. It gives the actor, step, beat
   kind, label, `ended`, and one new additive field: the judge file of a judge
   rest (field name decided at implementation). It replaces the workbench
   driver's `JUDGE_FILES` map.
2. The root OSC 7501 record of the driver's pane (no `id`): `state`, `kind`,
   `title`, `msg`. gtd ignores `app`, `progress` and child records.

| Status    | Rule                                                                                     |
| --------- | ---------------------------------------------------------------------------------------- |
| needs you | The actor is not `agent` or `check` (an allowlist), and the driver is blocked or absent. |
| working   | The OSC record says working.                                                             |
| error     | The OSC record says error, `gtd next` reports stalled or an error, or an error note.     |
| idle      | The process has ended, or there is no process.                                           |

`kind` changes only the label of a "needs you" status. A driver that prints no
OSC still gets correct needs-you, idle and error statuses.

**Error kinds:** `crashed` (the driver's pane reported a crash exit), `stalled`,
`driver` (the OSC error record, with its message), `note` (an error note).

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

- **Start:** gtd calls `terminal.run` with the driver argv. The driver is the
  pane's own command and its top process: no gtd process runs above it, and it
  is never a child of the supervisor. It runs in the person's login-shell
  environment (section 5), so it starts as it would from a terminal the person
  opened. The pane and the driver outlive the supervisor. The driver takes no
  arguments. It resumes where replay rests, and it waits if that is a rest. A
  driver that lands its opening beat when it starts is not a valid workspace
  driver.
- **One-shots**, run as subprocesses with the worktree as cwd:
  `<driver> proceed <commit>`, `<driver> retry <commit>`, `<driver> quit`.
  `<commit>` is the full HEAD commit that the person saw. History is the only
  state (ADR 0002), so that commit names the rest. There is no separate rest id.
  - Exit 0: accepted.
  - Exit 1: refused (stale or busy). The dashboard shows stderr.
  - Exit 2: no driver runs.
- **Proceed with no driver:** gtd starts the driver, then repeats the one-shot
  while it gets exit 2, for a few seconds at most.
- **Stale commits:** gtd compares the commit with the worktree's current HEAD
  before it sends a one-shot. The driver compares again when the one-shot
  arrives, and refuses (exit 1) when HEAD moved.
- **Exit:** the terminal adapter reports the driver's exit code
  (`status(handle).exit`) and keeps the pane open. There is no gtd wrapper.
  - done: exit 0 and the process has ended;
  - quit: exit 0 mid-flow, or exit 130 or 143;
  - crashed: any other exit. The worktree status becomes an error with Retry.
- **Orphans:** a worktree at an `agent` or `check` rest with no driver running.
  Orphans found at supervisor startup restart automatically. A crash exit never
  restarts automatically. A pane that is gone (for example after a reboot) has
  no exit code, so its worktree is an orphan.
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
failed action shows on the worktree. A failed read keeps the last snapshot,
greyed, with "<adapter> unavailable".

| Adapter       | Default   | Operations                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| worktrees     | worktrunk | `projects()` (scans the configured `roots`); `list(project)` → path, branch, HEAD, main, `integrated: true \| false \| undefined`; `create(project, branch, base?)` → path; `remove(project, worktree, { force })`, which returns when the removal is complete (worktrunk `--foreground`); optional `refresh(project)` → `ok` or `stale` with a reason (dirty, diverged, detached, fetch failed); `watch()` |
| terminal      | rex       | `run(project, worktree, argv, env)` opens a new pane with argv as its own top process, in the person's login-shell environment, and returns a handle (it never types into a shell); the pane stays open after the command exits; `status(handle)` → root OSC record, alive, busy, `exit: { code } \| null`; `close(handle)`; optional `attach(handle)` → a command or URL for the Terminal tab; `watch()`   |
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
  values. The mise default uses task-name prefixes: `start:*` (idle), `gate:*`
  (needs you), `error:*` (error), `any:*`. Every action gets
  `GTD_WORKSPACE_STATUS` as JSON: status, error kind, message, commit. When a
  `start:*` action exits 0, core starts the driver.
- **Notifications:** core removes duplicates by key.
- **Terminal environment and process tree:** `run` gives argv the environment of
  the person's login shell (its startup files run, as in a terminal the person
  opens). gtd's variables (`GTD_WORKSPACE_ITEM`, `GTD_WORKSPACE_STATUS`) are
  applied after the startup files, so they win. The login shell then replaces
  itself with argv (`exec`), so argv is the pane's top process. The rex default
  reads the exit code from the block's `last_exit` and the `child_exited` event,
  and keeps the pane with `--keep-open`. Whether rex's own
  `--shell --interactive` execs argv, or the adapter runs
  `$SHELL -l -i -c 'exec "$@"'`, is decided at implementation; the contract-test
  kit settles it.
- A kept pane shows the command's last output. No shell starts in it after the
  exit; the Terminal tab opens a separate shell pane when the person wants one.
- The OSC record lifetime under rex becomes a `@live` contract test of the rex
  adapter.

## 6. Configuration: `gtd.workspace.ts`

([gtd.workspace.ts shape](https://github.com/pmelab/gtd/issues/597))

The user-facing reference is `docs/workspace.md` on this branch. In short:

- Feeds and reactions are named exports through `feed()` and `reaction()`. The
  export name is the name.
- One reserved export, `workspace`, from `defineWorkspace` in
  `@pmelab/gtd/workspace`. Keys: `driver`, `adapters`, `limits`, `pollEvery`,
  `projects`, `notify`, `clean`, `ui`. Unknown keys are rejected at every depth.
- Adapter factories come from `@pmelab/gtd/workspace/adapters`.
- Lookup: the innermost `gtd.workspace.ts` from the current directory, or
  `--config <path>`. The workspace root is the file's directory.
- A bad config at startup exits 1. A bad config on reload is not applied: the
  last good config stays, and the dashboard shows a banner. A throwing `poll`,
  `canStart` or `run` is caught for each feed or reaction.
- Same trust as `gtd.config.ts`: the supervisor runs it in its own process.

## 7. Feeds, the inbox and dispatch

([Triggers and the inbox](https://github.com/pmelab/gtd/issues/596); "trigger"
is now "feed")

- `feed({ project, every, mode, poll, canStart? })`. `poll(ctx)` returns every
  item that matches now. gtd compares the result with the inbox: it adds new
  keys, updates known ones, and drops waiting items that no longer match. `ctx`
  gives `exec`, `fetch` and `log`, which have twins.
- **Item fields:** `key` (unique per feed), `title`, `url?`, `action` (a
  `start:*` action id), `priority`, `blockedBy` (keys, also of other feeds),
  `branch?`, `data` (free JSON, never read by gtd). gtd adds `feed` and
  `project`. `GTD_WORKSPACE_ITEM` carries exactly these fields.
- **States:** `proposed`, `queued`, `blocked` → `starting` → `started` or
  `failed`. `failed` stays until Retry or Dismiss. `started` ends when the
  worktree is removed. Shipped, merged, red checks and deploys are userland
  notes.
- **Modes:** `propose` items need a person's Start (which queues them) or
  Dismiss. `queue` items are dispatched automatically. A dismissed key stays
  hidden until the feed stops returning it.
- **Dispatch:** gtd creates the worktree, or uses the free existing worktree
  named by `branch`, calls `services.up`, and runs `start:<action>` with
  `GTD_WORKSPACE_ITEM`. The driver starts when the action succeeds. A worktree
  is free when no process is mid-flow, no driver runs and the tree is clean;
  otherwise the item waits.
- **Order:** priority, then the order that `poll` returned, then the time first
  seen.
- **Limits:** `limits.maxDrives` (workspace), `wip` (per project). Blockers and
  `canStart(item, ctx)` are checked again at dispatch.
- **Pause** at three levels: workspace, project, feed. Pause is runtime state,
  not config. `gtd workspace pause <project> --wait` returns once no driver runs
  in that project (this replaces the workbench dispatch lock).
- Hand-started work needs no item. The dashboard lists worktrees, not items.
- **Testing:** `testFeed(feed, { exec, fetch, clock })` in
  `@pmelab/gtd/testkit`.

## 8. Notes, notifications and reactions

([Triggers and the inbox](https://github.com/pmelab/gtd/issues/596),
[Notification events](https://github.com/pmelab/gtd/issues/600),
[Auto-clean](https://github.com/pmelab/gtd/issues/603))

- `gtd workspace note <worktree> <msg> [--error] [--notify]` and
  `gtd workspace note <worktree> --clear`. A note is how userland (a ship
  script, a deploy) shows what gtd does not track. An error note makes the
  worktree status an error of kind `note`. A note notifies only with `--notify`.
- `gtd workspace proceed|retry <worktree> <commit>`: the same calls the
  dashboard makes.
- **Built-in notifications** (each on by default, switchable in `notify` and per
  project): `needsYou` (a worktree starts needing you, or its label changes),
  `error`, `proposed`, `feedFailing` (once per run of failures), `configError`,
  `mainStale` (once per reason).
- **Notification content:** key `<kind>:<project>/<worktree>:<commit or label>`
  or `<kind>:<feed>`; title is the kind; body is label, project/worktree and
  message; URL is the gate page for needs-you, else the worktree's detail;
  priority is high for needs-you and error, default for proposed, low for feed
  failing.
- **Reactions:** `reaction({ on, run })`. `on` filters worktree status changes,
  for example `{ to: "error", errorKind: "driver" }`; `cleaned` is a change too.
  `run(change, ctx)` gets project, worktree, status from and to, label, error
  kind, commit and `atStartup`. `ctx` gives `action(id, values)`,
  `proceed(commit)`, `retry(commit)`, `notify(…)`, `exec`, `log`. gtd delivers
  each change once. `testReaction` is in the testkit.
- **Restarts:** the state store keeps the last status of each worktree and the
  sent keys. At startup gtd notifies and reacts only for worktrees whose status
  changed. It never sends a key twice. With no store, startup is a silent
  baseline, and reactions see `atStartup: true`.

## 9. Auto-clean

([Auto-clean of integrated worktrees](https://github.com/pmelab/gtd/issues/603))

- Opt-in: `clean: { every: "30m" }`, with a per-project override
  (`clean: false`). The default is off.
- Before each pass, core calls `worktrees.refresh` for each project.
- A worktree is removed only when `integrated` is `true` and nothing protects
  it. These protect it: main checkout, dirty tree (untracked files count), a
  process that has not ended, a running driver, a busy pane, an item in
  `starting`, an error note.
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
  worktree status, with their fields), the new-worktree input with branch
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
  (notifications, reactions) → restart orphans → serve → first feed polls.
- **CLI:** `note`, `proceed`, `retry`, `pause` and `resume` find the workspace
  by the config lookup and use the socket. When the supervisor is down, `note`
  goes to `spool/`, and `proceed`, `retry`, `pause` and `resume` exit 1 with
  "supervisor not running".
- **Shutdown (SIGTERM):** stop polls and dispatch, save the store, close the
  server. Drivers continue in their panes.
- **State store:** worktree statuses, sent notification keys, the inbox (waiting
  items, dismissals, failures), pause flags. All of it is rebuildable: waiting
  items return with the next poll, started items from worktrees by branch. Only
  dismissals and failures are lost.

## 13. CLI

| Command                                                                          | Purpose                                   |
| -------------------------------------------------------------------------------- | ----------------------------------------- |
| `gtd workspace [--config <path>] [--host …] [--port …] [--http] [--self-signed]` | Run the supervisor and dashboard.         |
| `gtd workspace note <worktree> <msg> [--error] [--notify]`                       | Set a note.                               |
| `gtd workspace note <worktree> --clear`                                          | Clear the note.                           |
| `gtd workspace proceed\|retry <worktree> <commit>`                               | Proceed or retry the rest at that commit. |
| `gtd workspace pause\|resume [<project> [<feed>]] [--wait]`                      | Pause or resume dispatch.                 |

`gtd next --json` gains the judge-file field (additive).

## 14. Migration of the workbench

([Migration order for the workbench](https://github.com/pmelab/gtd/issues/598))

Two dashboards may run at the same time. Never two dispatchers.

| Slice | Change                                                                                                                                                                                                                                            | Needs           | Rollback                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------- |
| A     | gtd releases the judge-file field. `driver.py` adopts the one-shots (keyed by HEAD commit), reads ship mode from `GTD_WORKSPACE_ITEM.data`, and runs as its pane's own command. Worktree tasks get the four prefixes (old names stay as aliases). | —               | Driver back to socket-only.         |
| B     | `gtd workspace` as a second pitchfork daemon, no feeds.                                                                                                                                                                                           | Sections 11, 12 | Stop the daemon.                    |
| C     | `watch.toml` rules and ship follow-ups ported to feeds and notes in `propose` mode. Compare the inboxes.                                                                                                                                          | —               | Delete the feeds.                   |
| D     | `bench:pause` ALL; feeds to `queue`; `ship.sh` and deploys use `note` and `pause --wait`; autotriage and autofix become reactions.                                                                                                                | Section 8       | `bench:resume`, feeds to `propose`. |
| E     | After one week of D: delete `ui.py`, `ui.html`, `pane.py`, `tui.py`, and the queue, poll, dispatch, ingest, merge-check and deploy code of `bench.py`, plus their state. `gtd workspace` replaces the `bench/ui` daemon. Turn on `clean`.         | Section 9       | `git revert`, `bench:deploy`.       |

The workbench keeps `driver.py`, `osc.py`, `ship.sh`, `sem.sh`, the workflows,
the worktree-action tasks and `bench:infra`. TypeScript enters the workbench
only for `gtd.workspace.ts` and `feeds/*.ts`, tested with `node:test` in
`bench:test`.

## 15. Tests

- `@inmem` cucumber scenarios for all logic, with the adapter twins: worktree
  status derivation, stale-commit refusal, dispatch order and limits, pause,
  propose and dismiss, notes, reactions, notification dedup and restart diff,
  auto-clean protections, reload with a bad config, the spool.
- The exported contract-test kit, run against every bundled adapter and every
  twin. It includes hostile action field values, the `integrated` cases (fresh
  worktree, squash merge, normal merge), and for the terminal: argv is the
  pane's top process with no wrapper above it, it sees a variable set in the
  login shell's startup files, gtd's variables win over the startup files, the
  exit code is reported (0, 130, 143, a crash), and the pane stays after the
  exit.
- `@live` only where a real process alone shows it: the rex adapter's run of the
  terminal contract (process tree, login environment, exit codes and signals),
  the rex OSC record lifetime, the socket permissions, the bundled binary's
  wiring.
- Security scenarios: 403 for an unknown identity, refused cross-site POST,
  refused non-JSON POST, for the dashboard, the gate pages and `gtd ui`.
