# gtd (git-things-done) — Claude Code plugin

An install-and-forget plugin that turns a Claude Code session — CLI, desktop, or
web — into a driver for [gtd](https://github.com/pmelab/gtd)'s git-native
plan/build/review workflow. Autonomous beats (checks, agent turns) run
unattended; human gates surface as a native conversation instead of a file you
have to go find and edit by hand.

## Install

```
/plugin marketplace add pmelab/gtd
/plugin install gtd@gtd
```

## Architecture: skills drive, hooks harden

The plugin is two layers, and they don't overlap:

- **Skills are the portable driver.** The loop protocol (`gtd next` → act →
  `gtd validate` → `gtd step`) lives entirely in skills, so it works identically
  on the CLI, the desktop app, and Claude Code web. Exactly one component — the
  driver skill — ever runs `gtd step`; nothing else advances the machine.
- **Hooks are CLI/desktop-only hardening.** Plugin hooks do not run on Claude
  Code web (plugins there are skills-only), so hooks add belt-and-suspenders
  enforcement where the platform supports them — blocking a stop mid-loop,
  denying an agent-authored `git commit` while the loop is armed, injecting
  ambient `gtd status` context, firing a desktop notification at a gate. None of
  it is load-bearing for the protocol itself; remove the hooks and the skills
  still drive the loop correctly, just without the extra guardrails.

## What ships

| Component               | What it does                                                                                                                                                                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/gtd:go`               | The driver skill — runs the gtd loop (dispatching on `gtd next --json`'s `kind`) until it settles or hits a human gate.                                                                                                                              |
| `/gtd:gate`             | The human-gate skill — renders the current steering file as a conversation (AskUserQuestion), writes the answer back into the file, then resumes the loop.                                                                                           |
| `/gtd:setup`            | A manual, opt-in helper that offers to install the status line and permission allowlist entries needed to run the loop unattended.                                                                                                                   |
| `gtd-worker` subagent   | Executes one `"prompt"` beat per the driver skill's memory contract, so long-running agent turns don't pollute the driving session's own context.                                                                                                    |
| Hooks                   | `Stop` enforcement (block on invalid steering file or an unfinished armed loop), `SessionStart` context injection (`gtd status`), a `PreToolUse` commit guard (deny `git commit`/`rebase`/`reset` while armed), and desktop notifications at a gate. |
| `scripts/statusline.sh` | Renders the resolved state (e.g. `gtd: building ⇦ agent (2 pending)`) as a Claude Code status line.                                                                                                                                                  |

See `docs/design/claude-code-plugin-plan.md` for the work-package breakdown this
plugin was built from.

## Requirements

- gtd installed in the repo (`node_modules/.bin/gtd`) or available as `gtd` on
  `PATH`.
- `jq`, for the hook scripts to parse `gtd`'s JSON output.

## Inertness guarantee

The plugin does nothing in a repository that isn't gtd-active. Every hook
script's first act is a cheap guard — resolve the gtd binary and check for a
`.gtd/` directory or a `.gtdrc*` at the repo root — and exits 0 silently, with
no output, when that guard fails. Skills likewise only trigger on gtd-shaped
requests. Installing the plugin in a repo that doesn't use gtd is a no-op.
