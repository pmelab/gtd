# What the default adapter tools expose

Research for pmelab/gtd#591 (map pmelab/gtd#589). For each default adapter tool:
what its CLI or API gives an adapter to build on, how the workbench uses it
today, and what is missing.

Collected 2026-11-14. Nothing here changed any state: only `--help`,
`--version`, read-only schema queries, upstream docs and source, and one
`mise tasks` probe in a scratch directory.

## Versions

| Tool             | Version read                                           | Pinned by workbench?                           | Source                                       |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------- |
| rex              | `0.1.0-preview.13`, API revision 10 (supports 0 to 10) | No (nix package)                               | `rex version`                                |
| pitchfork        | `2.33.1`                                               | Yes: `MISE_PITCHFORK_VERSION = "2.33.1"`       | workbench `mise.toml`; `pitchfork --version` |
| worktrunk (`wt`) | `v0.81.0`                                              | No (mise `aqua:max-sixty/worktrunk`, `latest`) | `wt --version`                               |
| mise             | `2026.5.12`                                            | No (nix package)                               | `mise --version`                             |
| ntfy             | hosted `https://ntfy.sh`                               | No (`BENCH_NTFY` overrides the server)         | workbench README, Notifications              |

Workbench sources are cited by README section and by file and function in
`pmelab/workbench` at its current `main` checkout.

## Summary of gaps

1. **No tool pushes state changes except rex.** pitchfork (daemon status),
   worktrunk (worktrees, markers, vars) and mise (task lists) have no event
   stream. The workbench polls: services every 10 s, Start actions every 60 s
   plus an mtime stamp, worktrees on each ref change.
2. **rex has no atomic "type this only if the shell is idle".** The check
   (`process`) and the write (`block send` / `write`) are two calls.
3. **mise lists tasks without the parsed usage spec.** `tasks ls --json` has the
   raw KDL `usage` string; the parsed `usage_spec.cmd` needs one
   `tasks info --json` call per task.
4. **pitchfork reports proxy URLs with the proxy's own port** (`:8443`). The
   workbench strips the port because tailnet :443 forwards to the proxy. That
   rewrite is machine setup, not something pitchfork knows.
5. **worktrunk is per repository.** It cannot list projects. The workbench finds
   projects by directory layout (`<ws>/<proj>/main`).
6. **ntfy has no dedup or replay control of its own.** It does have
   `X-Sequence-ID` to update, clear or delete one notification, which the
   workbench does not use yet.
7. **OSC 7501 record lifetime: docs and workbench disagree.** The spec says
   `done` and `error` survive a new prompt. The workbench's `osc.py` says any
   prompt clears every record (probed 2026-11-07). A `@live` test must settle
   which one holds.

---

## Terminal: rex

### Address a pane

| Need                              | Command                                                                                                 | Output fields                      | Source                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------ |
| List sessions                     | `rex session ls --json`                                                                                 | `sessions[].label` (and IDs)       | `rex session ls --help`; `pane.py` `has_session` |
| Create session                    | `rex new <label> -c <dir> --json`                                                                       | created session                    | `rex new --help`; `pane.py` `session`            |
| Rename session                    | `rex session rename <old> <new>`                                                                        | exit code                          | `pane.py` `adopt`                                |
| List windows                      | `rex window ls -s <session> --json`                                                                     | `windows[].window_id`, `.label`    | `rex window ls --help`; `pane.py` `window`       |
| Create window                     | `rex window new -s <s> <label> -c <dir> --focus=false --json [-- cmd…]`                                 | `window_id`, `block_ids[]`         | `rex window new --help`; `pane.py` `create`      |
| List blocks                       | `rex block ls -s <s> -w <win> --short=false --json`                                                     | `blocks[].block_id`                | `rex block ls --help`; `pane.py` `block`         |
| Close window                      | `rex window close -s <s> <win>`                                                                         | exit code                          | `pane.py` `ensure`                               |
| Split beside a block              | `rex split -b <block> --split right -c <dir> -- cmd`                                                    | exit code                          | `tui.py` key `e`                                 |
| Run in new block, get exit status | `rex run --wait [--json] -- cmd` / `rex wait <block> --json`                                            | creation result; child exit status | `rex run --help`, `rex wait --help`              |
| Read screen                       | `rex capture -b <block> [--format text\|html\|vt]`                                                      | text                               | `rex capture --help`                             |
| Discover API                      | `rex api list`, `rex api describe <m> --json`, `rex block inspect <b> --json`, `rex block types --json` | method schemas                     | `rex api --help`                                 |

Notes:

- Session labels match `-s` case-insensitively. Two sessions whose labels differ
  only by case are ambiguous (`pane.py` `has_session`, README "Display name").
- A window that rex opens with a command runs in the rex **server's**
  environment: no mise, no `BENCH`. The workbench wraps commands in
  `mise -C <dir> x -- …` (README "Claude Code"). A window opened without a
  command runs the person's login shell, which has their environment.
- `rex run` takes `--shell`, `--interactive` (read `~/.zshrc`), `--keep-open`,
  `--label` (`rex run --help`).

### Foreground process

`rex block call -s <s> -b <block> process` (terminal method `process`):

| Field        | Meaning                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `child`      | `{pid, user_id, user, name, path, invoked_path, argv0, script, cwd}`: the program the terminal started, usually a shell; on macOS `login`.                              |
| `foreground` | The same shape: the terminal's foreground process. Null when none.                                                                                                      |
| `ancestors`  | Processes between `foreground` and `child`, nearest first, ending with `child`. Left out when foreground is child, when there are more than 16, or when one has exited. |
| `last_exit`  | `{exit_code, error}`; null while the program runs.                                                                                                                      |
| `home`       | Home directory the program inherited.                                                                                                                                   |

Source: `rex block types --json`, creator `com.superlogical.terminal`, method
`process` (API revision 10). Rex never returns argv beyond `argv0`.

Workbench use: the pane is idle when the foreground is the child shell, or when
the child is `login` and the foreground shell's parent is `login`. The parent is
found with `ps -o ppid=` (`pane.py` `idle`). **Finding:** `ancestors`
already carries that parent chain, so an adapter can decide this without `ps`.

### Type into a pane

- `rex block send -s <s> -b <block> '<text>\r'` (`rex block send --help`;
  `pane.py` `type_line`).
- Block method `write` with `{"data": "…"}`. It returns `bytes_written` once the
  text is queued, not when the program reads it (`rex block types --json`,
  method `write`).

**Gap:** no conditional write. The workbench calls `process`, then `send`; a job
that starts between the two calls receives the text. It also refuses to type
into a new pane until the shell's first `pwd_changed` event (`pane.py`
`create`), because no "shell ready" event exists.

### Status records (OSC 7501)

Read: `rex block call … program_status` returns `records[]`, each:

| Field                  | Meaning                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `id`                   | Absent for the root record; `a/b` is a child of `a`.                             |
| `state`                | `idle`, `working`, `done`, `blocked`, `error`. Treat an unknown value as `idle`. |
| `kind`                 | With `blocked`: `permission`, `question`, `auth`.                                |
| `progress`             | 0 to 100, only with `working` / `blocked`.                                       |
| `app`, `effective_app` | The reporting program; `effective_app` inherits from the nearest parent.         |
| `title`, `msg`         | Decoded text, show as plain text.                                                |
| `updated_at`           | RFC 3339, server clock.                                                          |
| `owner`                | `{pid, name}` of the foreground process when the report arrived.                 |

Source: `rex block types --json`, method `program_status`.

Write (the protocol, rev 0.4, 2026-10-10):
`ESC ] 7501 ; key=value(:key=value)* ST`. `state` is required. `title` and `msg`
are base64 UTF-8 with no control characters. A report replaces its record
completely. Limits: sequence 4096 bytes, `msg` 2048 decoded, `title` 192
decoded, `app` 32, `id` 128 (8 levels). An invalid report is dropped whole and
silently. `state=clear` removes a record and its children; with no `id`, every
record. Feature detection: `OSC 7501 ; ? ST`. Source:
<https://www.superlogical.com/rex/docs/build/program-status>.

Lifetime per the spec: when the terminal's process exits or a new shell prompt
begins (OSC 133 `A`), the terminal **must** drop `working` and `blocked`,
**may** drop `idle`, and keeps `done` and `error`. The `program_status_removed`
event gives the reason: `clear`, `child_exited`, `reset`, `prompt`, `foreground`
(the reporter left the foreground, for example after Ctrl+C), `evicted` (Rex
holds 64 records per terminal).

Workbench use: `_bench/osc.py` validates and writes the reports. The driver
reports app `gtd`, root record: `working` (title = step label), `blocked` at a
gate (`question` with a file to edit, else `permission`), `error`, `idle`,
`done` (README "Driver and worker pane"). **Discrepancy:** `osc.py` (docstring)
says "any shell prompt in the pane clears them", and the README says the
`bench:run` record "goes at the next prompt". The spec says `done` / `error`
survive the prompt. A `@live` test must check which one holds.

**Gap:** the protocol is write-only for programs ("there is no way to read
records", spec, Security). Only a rex client reads them, through
`program_status` or events. The supervisor must therefore talk to rex, not to
the terminal.

### Events

`rex events -s <session> --json`: one JSON object per line, flushed per event.
Without `-s`: session create, destroy and state changes only. With `--all`:
every server event (`rex events --help`). Envelope:
`session_event → {session_id, event: block_event → {block_id, creator_name, name, payload}}`
(<https://www.superlogical.com/rex/docs/reference/events>; parser in `pane.py`
`unwrap`).

Useful events:

| Event                                                                                                                  | Payload                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `program_status_changed`                                                                                               | `id` (`""` for root), `record` (as above)  |
| `program_status_removed`                                                                                               | `ids[]`, `reason`                          |
| `process_changed`                                                                                                      | `generation`, `foreground`, `ancestors`    |
| `child_exited`                                                                                                         | `exit_code`, `error`                       |
| `pwd_changed`                                                                                                          | `pwd` (a `file://` URL for OSC 7), `owner` |
| `desktop_notification`                                                                                                 | `title`, `body` (OSC 9 / 777)              |
| `progress_report`                                                                                                      | `state`, `progress` (OSC 9;4)              |
| `window_created` / `window_closed` / `window_label_changed`, `block_created` / `block_closed`, `session_label_changed` | IDs, label                                 |
| `session_created` / `session_destroyed` (server)                                                                       | `session`, `session_id`                    |

Workbench use: one `rex events -s <proj> --json` stream per project with
worktrees. On connect and every 30 s it resyncs each pane with `process` and
`program_status` (README "Driver and worker pane").

**Gaps:** no replay or offset, so a reconnect must resync by polling. One stream
per session, or `--all` for everything. Rex is a preview release and not
version-pinned; an adapter should check `rex version` (`api: revision N`).

---

## Services: pitchfork 2.33.1

### Daemons

| Need                   | Command                                                            | Output fields                                                                                                                                                 | Source                                   |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| List                   | `pitchfork list --json [--namespace N] [--status S] [--project]`   | `id`, `namespace`, `name`, `pid`, `status`, `oneshot`, `disabled`, `available`, `url` (`proxy_url` deprecated), `proxy_tls`, `error`, `active_port`, `port[]` | `src/cli/json_output.rs` `JsonListEntry` |
| One daemon             | `pitchfork status --json <id>`                                     | as above plus `cron_schedule`, `cron_last_run`, `cron_next_run`                                                                                               | `JsonStatusEntry`                        |
| Configured daemons     | `pitchfork daemons --json`                                         | `id`, `run`                                                                                                                                                   | `JsonDaemonConfigEntry`                  |
| Start / stop / restart | `pitchfork start\|stop\|restart <ns>/<name>`, `--local`, `--group` | exit code; `start` waits for readiness                                                                                                                        | `pitchfork start --help`                 |
| Wait                   | `pitchfork wait <id>`                                              | the daemon's exit code                                                                                                                                        | `pitchfork wait --help`                  |
| Logs                   | `pitchfork logs <id> --json [-n N] [--since]`, `--tail`            | `timestamp`, `daemon_id`, `message`, `level`, `msg`, `logger`, `fields`                                                                                       | `JsonLogEntry`                           |

Status values: `running`, `stopped`, `waiting`, `stopping`, `restarting`,
`failed`, `errored`, `completed`, `available`, `disabled`
(`pitchfork list --help`).

Source files are at <https://github.com/jdx/pitchfork/tree/v2.33.1>.

### Registering a checkout's services without touching the repository

- `pitchfork config add <file> --dir <dir> --namespace <ns> [--label <label>]`
  attaches an external config to a checkout. Attachments load after ordinary
  project files and override them. `config remove <file>` detaches it and stops
  nothing. `config list --json` reports the `label`. Source:
  `pitchfork config add --help`; `docs/guides/external-configs.md`.
- The workbench uses this for the `gate` daemon and the project template, one
  namespace per checkout: `<proj>` for main, `<wt>` or `<proj>-<wt>` for a
  worktree (`lib.sh` `bench_locate` and the label registration; `ui.py`
  `namespace`).

### URLs and proxy labels

- Automatic hostnames: `<daemon>.<project>.<tld>` for the primary checkout,
  `<daemon>.<worktree>.<project>.<tld>` for a linked worktree. Project label:
  the primary checkout's registered `label`, else its namespace, else its
  directory name. Worktree label: `worktree_label` in a checkout-specific file,
  else the directory name. Daemon label: its `proxy` string, else its name.
  Labels are lowercase, at most 63 characters. A label two projects claim is
  dropped and reported in `conflicts`. Source: `docs/guides/port-management.md`
  "Hostnames", "Where Labels Come From".
- `pitchfork proxy status --json`: `enabled`, `scheme`, `tld`, `port`, `lan`,
  `tls_cert`, `trusted`, `slugs[]` (`slug`, `url`, `dir`, `daemon`, `status`,
  `port`), `projects[]` (`project`, `dir`, `url`, `daemons[]`, `worktrees[]`
  with `worktree`, `dir`, `url`, `daemons[]`), `conflicts[]`. Each daemon host:
  `daemon`, `host` (without TLD), `url`, `status`, `port`. Source:
  `JsonProxyStatus` and related structs.
- Slugs (legacy):
  `pitchfork proxy add <slug> --dir D --daemon N --namespace NS`. They resolve
  before automatic hostnames (`pitchfork proxy add --help`).
- Autostart: a request to a stopped daemon starts it and waits up to
  `proxy.auto_start_timeout` (default 30 s); `auto_start = false` turns it off
  (`docs/guides/port-management.md`).

Workbench use: `proxy_services` maps each `dir` (realpath) to
`[{name, url, status, running}]`. It hides `gate` and drops the `:port` from the
URL (`ui.py` `proxy_services`), reading every 10 s (README "bench.internal"). It
registers `<proj>/main` with `--label <proj>` so hostnames read
`….<wt>.<proj>.internal`, not `….main.internal` (README "Networking").

### Settings

`pitchfork settings get [--json] <key>`,
`settings set [--global|--local|--project] <key> <value>`,
`settings explain <key>`. JSON entry: `key`, `value`, `default`, `type`,
`env_var`, `origin` (`JsonSettingEntry`). The workbench sets only
`proxy.auto_start_timeout = 120s`, and only when it differs (`lib.sh`
`bench_proxy_settings`).

### HTTP API (optional)

If the web UI or the standalone API server is on (off by default; default
address `127.0.0.1:3120`), the supervisor serves JSON: `GET /api/daemons` (full
runtime state with `dir`, `cpu_percent`, `memory_bytes`, `uptime_secs`,
`proxy_url`, `active_port`), `POST /api/daemons/{id}/start|stop|restart`,
`GET /api/projects`, `GET /api/projects/{project}/{worktree}` (groups, daemon
counts, `can_start`), NDJSON `GET /api/logs/{id}/tail`. A non-loopback address
needs `X-Pitchfork-Token`. Source: `docs/reference/http-api.md`. The workbench
does not use it.

### Gaps

- **No status-change events**, in the CLI or the HTTP API (the only stream is
  logs). An adapter polls `proxy status --json` or `list --json`.
- **The URL carries the proxy port** (`https://x.y.internal:8443`). Public
  reachability (tailnet :443 forwarding) is outside pitchfork. The adapter
  either reports the URL as-is or takes a rewrite from config.
- `proxy status` lists **only daemons with a proxied port**. Daemons without a
  port (workers, `oneshot`) need `list --json`, which has no `dir`, only
  `namespace`. To map them to a checkout, the adapter must know the namespace
  rule.
- Daemons that pitchfork older than 2.31 started never report their port, so the
  proxy answers 502. That is why the workbench pins 2.33.1 (README
  "Networking").

---

## Worktrees: worktrunk v0.81.0

### List

`wt -C <repo> list --format=json`, schema 2 envelope (`wt list --help`, JSON
Schema at <https://worktrunk.dev/schema/list-v2.json>):

- Envelope: `schema` (2), `repo.default_branch`, `repo.forge` (`url`,
  `provider`, `host`, `owner`, `name`, `remote`), `collected` (`ci`, `summary`),
  `items[]`.
- Item: `branch` (null when detached), `head` (`sha`, `short_sha`, `subject`,
  `committed_at`), `worktree` (`path`, `main`, `current`, `previous`,
  `detached`, `locked`, `prunable`, `branch_mismatch`, `duplicate_branch`,
  `operation`,
  `changes{staged, modified, untracked, renamed, deleted, conflicted, diff}`),
  `default_branch` (`ahead`, `behind`, `diff`, `orphan`, `integration{reason}`,
  `merge_conflicts`), `upstream`, `pr` and `checks` (only with `--full`, over
  the network), `dev_server{url, listening}` (from `[list] url`), `marker`,
  `vars`, `display` (`state`, `symbols`, `statusline`, `columns`).
- `display.state`: `is_main`, `orphan`, `empty`, `integrated`, `would_conflict`,
  `same_commit`, `diverged`, `ahead`, `behind`. `empty` and `integrated` mean
  safe to remove.
- Absent means "nothing to report"; `null` means "requested, not determined".

Workbench use: `items[]` with a `worktree`, `worktree.path`, `branch`, `marker`,
`vars` (status memory across restarts), `worktree.main`, and
`display.state == "integrated"` for auto-clean (`ui.py` `checkouts`, `bench.py`
`worktrees` and `clean`).

### Create

`wt -C <repo> switch -c <branch> [--base <ref>] -y --no-cd [--format=json] [--no-hooks]`.
`--base` takes a ref or a shortcut (`^`, `@`, `pr:N`). A new branch tracks its
base only when the names match. `pr:N` / a PR URL checks out the PR branch (fork
PRs fetch `refs/pull/N/head`). JSON result: `action` (`created`, `existing`,
`already_at`), `branch`, `path`, `created_branch`, `base_branch`, `from_remote`
(`wt switch --help`; `src/commands/worktree/switch.rs` `SwitchJsonOutput`).
Order: `pre-switch` hooks, create, `pre-start` hooks (blocking), then
`post-start` and `post-switch` in the background.

Workbench use: `switch -c <branch> -y --no-cd --base origin/<default>` after a
`git fetch`, with branch tracking turned off through `GIT_CONFIG_*` (`bench.py`
start path and `base_args`). For PR reviews: `switch pr:<n>`, then a hard reset
to `refs/pull/<n>/head`, because a stale local branch is reused (`bench.py`
PR-review start). It does not use `--format=json`.

### Remove

`wt -C <repo> remove -y [-f] [-D] [--foreground] [--reap] [--format=json] <branch|path>`.
It runs in the **background by default** (log in
`.git/wt/logs/{branch}/internal/remove.log`). JSON: `kind`, `branch`, `path`,
`branch_outcome` (`deleted`, `deferred`, `not_attempted`, `retained_unmerged`,
`retained_checked_out`, `retained_raced`, `retained_failed`),
`branch_checked_out_at`. `--reap` kills processes whose cwd is under the
worktree. Source: `wt remove --help`.

Workbench use: `remove -y <branch>`; `-f -D` after a second confirmation
(`ui.py` `Service.remove`). It runs without `--foreground`, so "removed" means
"removal started".

### Hooks

Types: `pre-switch` / `post-switch`, `pre-start` / `post-start`, `pre-commit` /
`post-commit`, `pre-merge` / `post-merge`, `pre-remove` / `post-remove`. `pre-*`
blocks, and a failure aborts the operation. `post-*` runs in the background.
Hooks live in user config (no approval) or project `.config/wt.toml` (needs
approval; `-y` skips the prompt). Template variables: `branch`, `worktree_path`,
`worktree_name`, `commit`, `base`, `target`, `pr_number`, `pr_url`, `repo`,
`repo_path`, `primary_worktree_path`, `default_branch`, `vars.<key>`, and more.
A hook gets its context only as template variables in argv, never as JSON on
stdin. Source: `wt hook --help`.

Workbench use: user config through `WORKTRUNK_CONFIG_PATH=$BENCH/wt.toml`:
`post-start` runs `mise trust` and `bench:up`, `pre-remove` runs `bench:down`,
and `worktree-path = "{{ repo_path }}/../wt/{{ branch | sanitize }}"` (workbench
`wt.toml`, `mise.toml`).

### Markers and vars

- `wt -C <path> config state marker set|get|clear [--branch B] [--format json]`.
  Stored in git config as `worktrunk.state.<branch>.marker` =
  `{"marker":"…","set_at":<ts>}`; read back as the item's `marker`.
- `wt -C <path> config state vars set k=v | get k | list | clear [k] [--branch B]`.
  Stored as `worktrunk.state.<branch>.vars.<key>`. **Keys: letters, digits,
  hyphens only.** Values are strings or JSON. Shown in `wt list` as `vars` and
  in custom columns (`[list.custom-columns.<h>] template = "{{ vars.x }}"`).

Source: `wt config state marker --help`, `wt config state vars --help`.

Workbench use: marker 🙋 ⚙️ 💤 ❌ plus vars `gtd-state`, `gtd-actor`,
`gtd-label`, `gtd-updated`, `gate-url`, one `wt` call per key (`ui.py`
`Service.publish`).

### Gaps

- **Per repository only**: no way to list several repositories, so project
  discovery stays with the adapter (today: `<ws>/*/main`).
- **No events**: marker, vars and worktree changes have no notification. Hooks
  fire only for worktrunk's own operations, not for `git worktree add` or a
  plain `git switch`.
- **Markers and vars belong to a branch, not a worktree** (git config keyed by
  branch name). A detached worktree has none.
- One process per var write (no batch `vars set a=1 b=2` documented).
- `wt list` runs git per worktree. `--full` reaches the forge and is slow;
  workbench never passes it.
- worktrunk is not version-pinned. Its JSON schema changed once (schema 1 to 2);
  the adapter should check `schema == 2`.

---

## Actions: mise 2026.5.12

### Task listing

`mise tasks ls --json` (run in the worktree; it merges every config up the
directory tree; hidden tasks need `--hidden`). Probe output per task:

```json
{
  "name": "start:demo",
  "aliases": [],
  "description": "…",
  "source": "/…/mise.toml",
  "depends": [],
  "depends_post": [],
  "wait_for": [],
  "env": [],
  "dir": "/…",
  "hide": false,
  "global": false,
  "raw": false,
  "interactive": false,
  "sources": [],
  "outputs": [],
  "shell": null,
  "quiet": false,
  "silent": false,
  "tools": {},
  "usage": "arg \"<todo>\" …",
  "timeout": null,
  "run": ["…"],
  "args": [],
  "file": null
}
```

The `usage` field is the **raw KDL string**, not a parsed spec.

### Usage spec

`mise tasks info <task> --json` adds `usage_spec`. Its `cmd` holds:

- `args[]`: `name`, `usage`, `help`, `help_first_line`, `required`,
  `double_dash`, `hide`, `choices.choices[]` when set, `var`, `default`.
- `flags[]`: `name`, `usage`, `help`, `help_first_line`, `short[]`, `long[]`,
  `hide`, `global`, `required`, `default[]`, and `arg` (absent for a boolean
  flag; with a value flag it holds `choices`).
- `usage` (one-line synopsis), `help`, `examples`.

Source: probe in a scratch directory with `arg "<todo>"`,
`flag "--mode <mode>" default="fast" { choices "fast" "slow" }`, `flag "--dry"`.
Spec language: <https://mise.jdx.dev/tasks/task-arguments.html> (also `count`,
`var`, `negate`, `env=`, `long_help`, `complete`).

Workbench use: filter `start:*` and not `hide`, then one `tasks info` per task.
The form maps args to text inputs (select with `choices`), boolean flags to
checkboxes and value flags to inputs. Results are cached until the row's status
changes or a mise config file up the tree changes mtime (`ui.py` `field`,
`action`, `start_tasks`, `mise_stamp`; README "Start actions").

### Running

`mise run <task> [--flag[=v]…] [-- <args…>]`. mise parses the args against the
spec and passes each one as `usage_<name>` env vars. Without a spec, extra args
go to the command as-is. Other flags: `-C <dir>`, `--timeout`, `-q`, `-S`,
`--raw`, `-n` (dry run). Source: `mise run --help`; task-arguments doc.

Workbench use: it builds the argv (`ui.py` `start_command`) and types
`env BENCH=… $BENCH/.mise/tasks/bench/run start:<name> …` into the worker pane.
`bench:run` wraps the run in OSC 7501 `working` → `done` / `error (exit N)`
(`osc.py` `run`). An argv that cannot be typed safely goes through a JSON file
(`--argv-file`, `pane.py` `run_task`).

### Gaps

- **N+1 calls**: no `tasks ls` flag returns parsed specs, so the adapter runs
  one `tasks info` per task (the workbench gives each a 60 s timeout).
- **Trust**: a `mise.toml` in a new worktree must be trusted before mise reads
  it; the workbench's `post-start` hook runs `mise trust -yq`. An untrusted
  config makes `tasks ls` fail.
- **No change notification**: the adapter must detect config changes itself
  (mtime of `mise.toml`, `.mise/tasks`, … up the tree).
- **No machine-readable run result**: `mise run` gives an exit code and terminal
  output, nothing more. Status comes from the terminal adapter (OSC 7501 through
  a wrapper, or `process.last_exit`).
- The row-status prefixes (`start:`, `gate:`, `error:`, `any:`) are a gtd naming
  rule; mise has no task metadata field for it. Task `description` is the only
  label.

---

## Notifications: ntfy

### Publish

`POST https://<server>/<topic>` with the message as body, or `POST /` with JSON
(`{"topic", "message", "title", "tags", "priority", "click", "actions", …}`).
Headers (case-insensitive, aliases in brackets):

| Header                                                                                          | Purpose                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `X-Title` (`Title`, `t`)                                                                        | Title                                                                                                        |
| `X-Priority` (`Priority`, `prio`, `p`)                                                          | Message priority                                                                                             |
| `X-Tags` (`Tags`, `ta`)                                                                         | Tags; emoji short codes render as emoji                                                                      |
| `X-Click` (`Click`)                                                                             | URL opened on tap                                                                                            |
| `X-Actions` (`Actions`)                                                                         | Buttons: `view` (open URL), `http` (sends a request, default POST), `broadcast` (Android), copy to clipboard |
| `X-Sequence-ID` (`Sequence-ID`, `SID`)                                                          | Update a notification by publishing again with the same ID                                                   |
| `X-Markdown`, `X-Icon`, `X-Attach`, `X-Filename`, `X-Delay`, `X-Email`, `X-Cache`, `X-Firebase` | Formatting, attachments, scheduling, delivery                                                                |
| `Authorization`                                                                                 | Username + password or access token for protected topics                                                     |

Also: `PUT /<topic>/<sequence_id>/clear` marks a notification read and dismisses
it; `DELETE /<topic>/<sequence_id>` removes it. The publish response is JSON
with `id` and `time`. Limits on ntfy.sh: a message is at most 4,096 bytes (more
becomes an attachment), 250 messages a day, 60-request burst then one per 5 s.
The topic is the password. Source: <https://docs.ntfy.sh/publish/> ("List of all
parameters", "Updating + deleting notifications", "Limitations").

Workbench use: stdlib `urllib` POST to `https://ntfy.sh/<topic>` with `Title`,
`Click` (`https://bench.internal/#<proj>/<wt>` or the PR) and `Tags`, sent from
a thread, errors logged only. The topic is random (`bench-<24 hex>`) and kept in
`.state/ntfy-topic` (`ui.py` `topic`, `notify`). Dedup ("once per new gate label",
"once per error label") and replay suppression ("events older than an hour push
nothing") are workbench logic (README "Notifications").

### Gaps

- **No dedup or replay guard in ntfy.** Dedup and the restart guard stay in gtd.
  `X-Sequence-ID` (for example, one ID per worktree) would let a later push
  replace the "needs you" push and let gtd clear it once the gate is answered.
  The workbench does not do this today.
- `http` action buttons could send Proceed from the phone. A POST from the ntfy
  app carries no `Origin`, so it would bypass today's Origin-check boundary. A
  security decision for the dashboard (map "Dashboard security").
- Delivery is fire-and-forget. The response `id` is the only receipt.

---

## Sources

- rex: `rex --help` and subcommand help (0.1.0-preview.13);
  `rex block types --json` (terminal creator, API revision 10);
  `rex skill show`;
  <https://www.superlogical.com/rex/docs/build/program-status>;
  <https://www.superlogical.com/rex/docs/reference/events>.
- pitchfork: `pitchfork <cmd> --help` (2.33.1); source at
  <https://github.com/jdx/pitchfork/tree/v2.33.1> (`src/cli/json_output.rs`,
  `src/web/server.rs`, `docs/reference/http-api.md`,
  `docs/guides/port-management.md`, `docs/guides/external-configs.md`,
  `docs/guides/lifecycle-hooks.md`).
- worktrunk: `wt <cmd> --help` (v0.81.0); source at
  <https://github.com/max-sixty/worktrunk/tree/v0.81.0>
  (`src/commands/worktree/switch.rs`); <https://worktrunk.dev>.
- mise: `mise <cmd> --help` (2026.5.12); a probe of `tasks ls --json` and
  `tasks info --json` in a scratch directory;
  <https://mise.jdx.dev/tasks/task-arguments.html>.
- ntfy: <https://docs.ntfy.sh/publish/>.
- workbench: `pmelab/workbench` `main` — `README.md`, `mise.toml`, `wt.toml`,
  `_bench/ui.py`, `_bench/pane.py`, `_bench/osc.py`, `_bench/bench.py`,
  `_bench/lib.sh`.
