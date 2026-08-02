# The Claude Code plugin

`plugins/gtd/` packages gtd's loop protocol (`gtd next` → act → `gtd validate` →
`gtd step`, see [Driving the loop](loop.md)) as an install-and-forget
[Claude Code](https://claude.com/claude-code) plugin: point a Claude Code
session — CLI, desktop, or [web](https://claude.ai/code) — at a gtd-active repo,
and it drives the autonomous states unattended while turning every human gate
into a native conversation instead of a file you have to go find and edit by
hand.

This document describes the plugin from the outside — installing it, what a
cycle looks like, how to configure and troubleshoot it. For its internals (the
skills, the hooks, the worker subagent) read the plugin's own
[README](../plugins/gtd/README.md) and the source under `plugins/gtd/` — it's
short, and the comments in `hooks/scripts/lib.sh` in particular spell out every
guard's own rationale.

## Install

```
/plugin marketplace add pmelab/gtd
/plugin install gtd@gtd
```

That's it — no further configuration is required to start using `/gtd:go`. Two
things are worth doing once per project, both offered by the setup skill (see
below): a status line, and a permission allowlist so autonomous beats don't
prompt.

## Architecture: skills drive, hooks harden

The plugin is two layers, and they don't overlap:

- **Skills are the portable driver, and work everywhere.** `/gtd:go` restates
  the exact loop protocol `bin/gtd` implements: peek `gtd next --json`, dispatch
  on `kind`, capture with `gtd step <actor>`, repeat until a human gate or a
  settled idle. `/gtd:gate` runs the human-gate conversation. Because these are
  skills, not hooks, they run identically on the CLI, the desktop app, **and
  Claude Code web** — a plugin's hooks do not execute in a web session at all
  (web plugins are skills-only), so if the protocol lived in a hook, gtd would
  simply not work there. Exactly one component ever runs `gtd step` — the
  driving skill — so skills and hooks can never race each other to advance the
  same turn.
- **Hooks are CLI/desktop-only hardening**, layered on top, never load-bearing
  for correctness. They enforce the protocol a second time from outside the
  conversation (a `Stop` hook that blocks the session from ending mid-loop, a
  `PreToolUse` hook that denies an agent-authored `git commit`/`rebase`/`reset`
  while the loop is armed), inject ambient context (`SessionStart`), and fire a
  desktop notification at a gate. Uninstalling or disabling the hooks leaves the
  skills fully able to drive the loop correctly on their own — just without the
  extra guardrails. None of them ever call `gtd step`.

Want the guardrails on web too? Hooks checked into the **project** (scripts in
the repository plus `.claude/settings.json` entries) do run in web sessions,
unlike a plugin's own hooks — `/gtd:setup`'s fourth offer vendors the plugin's
hook scripts into `.claude/hooks/gtd/` and registers them project-relatively
(`$CLAUDE_PROJECT_DIR/...`), so a committed copy hardens every session,
including a web container's fresh clone. See "The setup skill" below.

## A full cycle, walked through

1. **Arm.** You ask Claude to run gtd (or invoke `/gtd:go` directly). The `go`
   skill resolves the gtd binary, writes the armed marker (see below), and
   starts peeking `gtd next --json`.
2. **Autonomous beats run unattended.** A `"script"` beat (a check) runs via
   Bash and is captured with `gtd step check`; a `"prompt"` beat is handed to a
   fresh `gtd-worker` subagent (or the same one again, via `SendMessage`, when
   the beat's `memory` label repeats — see `docs/loop.md`'s "Agent memory
   scope") and, once it finishes, gated through `gtd validate` before being
   captured with `gtd step agent`. On the CLI/desktop, the `Stop` hook is
   watching in the background: if the session tries to end here — the user
   closes the tab, an unrelated timeout fires — it blocks with a reason naming
   the state still owed a beat, so the loop is never silently abandoned
   mid-cycle. It also denies any agent-authored `git commit`/`rebase`/`reset`
   during this whole stretch, since gtd itself owns history for the process
   underway.
3. **A human gate becomes conversation.** When `gtd next --json` reports
   `kind: "message"`, the `go` skill disarms and hands off to `/gtd:gate`. That
   skill reads the gate's steering file and its `mode` (`qa`, `review`, `prose`,
   or none), shows you the diff if a review window is open, and renders the
   decision as **AskUserQuestion** — one question per open `qa` question, an
   approve-all-vs-feedback choice for a `review` gate, or the workflow author's
   own `edges[].describe` text for a plain prose gate. Your answer is
   transcribed back into the steering file exactly the way a human editing it by
   hand would (ticked boxes, inline comments) — the file stays the durable
   record, chat is just the input device.
4. **On web (or any session you might not be watching), you get a push
   notification** the moment the loop reaches a gate, summarizing it in one
   line, instead of the session just sitting there waiting for you to look back
   at it. The CLI/desktop equivalent is the `Stop` hook's desktop notification
   (`osascript`/`notify-send`) fired at exactly the same moment.
5. **Capture.** Once the gate skill has your answer transcribed, it runs
   `gtd validate` (fixing any formatting findings) and then `gtd step human`,
   then resumes `/gtd:go` — unless you said you wanted to stop there for now.
6. **Settle.** The loop keeps going until a zero-commit check step at the
   workflow's initial state proves there's nothing left to do — reported to you,
   marker removed, done.

## The setup skill

`/gtd:setup` is manual-only — it never triggers on its own — and makes four
independent, individually-confirmed offers: verify gtd is actually installed and
the repo is gtd-active; install `scripts/statusline.sh` as the project's Claude
Code status line (`.claude/settings.json`'s `statusLine`, read-merge-written so
nothing else in that file is touched); add a permission allowlist
(`gtd next/step/status/validate`, plus the project's own `vars.testCommand` if
one is configured) so the loop's autonomous beats don't prompt for approval on
every single invocation; and vendor the hook scripts into the project
(`.claude/hooks/gtd/` + `$CLAUDE_PROJECT_DIR`-relative `hooks` entries in
`.claude/settings.json`) so the hardening layer also runs in web sessions, where
plugin hooks don't. Each offer asks before writing anything.

Two things to know about the vendored web hooks: on CLI/desktop both
registrations fire (the plugin's own hooks and the project copies) — safe by
design, since the guards are idempotent and the Stop hook self-heals the marker,
with duplicated `SessionStart` context the only cosmetic effect; and the copies
don't auto-update with the plugin, so re-run `/gtd:setup` after an update to
refresh them (they only take effect on web once committed — a web session starts
from a fresh clone).

## The armed marker

The `go` skill "arms" the loop by writing a marker file before its first beat:

```
$(git rev-parse --git-dir)/gtd-claude-loop
```

Per-worktree, and inside the git directory rather than the work tree — the same
placement convention `bin/gtd`'s own memory marker uses, so it never shows up as
a pending change and two worktrees sharing one `.git` never collide. Hooks
enforce the protocol only while this file exists; on Claude Code web nothing
reads it, so writing it there is harmless. The skill removes it the moment the
loop halts for any reason — a gate, settling, a stall, a refusal — so a marker
is never left stranding a later, unrelated conversation.

If a session ends abnormally (a crash, a forced quit) and leaves the marker
behind, disarm by hand:

```
rm "$(git rev-parse --git-dir)/gtd-claude-loop"
```

The `Stop` hook also self-heals it automatically the next time it observes the
loop resting cleanly at a human gate while armed, so you rarely need to do this
yourself.

## Requirements

- gtd installed in the repo — `node_modules/.bin/gtd`, or `gtd` available on
  `PATH`. The hook scripts resolve it exactly this way (never `GTD_BIN`, which
  is a `bin/gtd`-only override); the skills' own preflight uses the same order.
- `jq`, for the hook scripts to parse gtd's JSON output. Its absence is just
  another silent guard (see Troubleshooting) — the plugin degrades to
  skills-only, not to an error.

## Troubleshooting

- **A hook script prints nothing in a plain repo.** This is by design, not a
  bug: every hook's first act is a cheap, silent guard — resolve the gtd binary,
  then check the repo actually looks gtd-active (a `.gtd/` directory or a
  `.gtdrc*` file at its root) — and it exits `0` with no output the instant
  either check fails. An install-and-forget plugin must never make an ordinary,
  non-gtd session look broken.
- **The status line goes blank after updating the plugin.** `/gtd:setup` writes
  the statusline command as an _absolute path_ resolved from
  `${CLAUDE_PLUGIN_ROOT}` at setup time; a plugin update can move that installed
  location. Re-run `/gtd:setup` to refresh the path — it shows you the existing
  value and asks before replacing it.
- **The loop won't stop / a Stop hook keeps blocking.** The hook respects the
  harness's own `stop_hook_block_cap`: as it nears the cap it stops blocking and
  leaves a `systemMessage` instead, so a genuinely stuck loop doesn't spin the
  session forever. If you want out before that, disarm by hand (above) or ask
  the assistant to stop and remove the marker.
- **`git commit` gets denied mid-loop.** That's the `PreToolUse` guard —
  intentional while the loop is armed, since gtd owns history for the process
  underway and an agent-authored commit would fight `gtd step` for the same
  repository. Finish the current cycle, or disarm first if you're taking over by
  hand.

## Relationship to `bin/gtd`

`bin/gtd` is the packaged **terminal** loop driver: a standalone process you run
directly (`gtd`, or `gtd loop`), implementing this exact same protocol as a bash
script plus a coding-agent CLI of your choice. The Claude Code plugin is the
same protocol again, running as skills/hooks inside a Claude Code session
instead. They're two harnesses for one pinned contract, not two different
behaviors — but they are two independent drivers, and **you should never run
both against the same repository at the same time**: each expects to be the only
thing calling `gtd step`, and two drivers racing to step the same resolved rest
will fight each other for the same commits.
