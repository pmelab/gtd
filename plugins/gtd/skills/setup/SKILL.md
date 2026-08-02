---
name: setup
description: One-time setup for the gtd plugin in this project: statusline, permission allowlist, and an install check. Use when the user asks to set up gtd for Claude Code, configure the gtd statusline, or reduce gtd permission prompts.
disable-model-invocation: true
---

# Setting up the gtd plugin

This skill is manual-only (`/gtd:setup`) — it never triggers on its own from a
conversation. It makes four independent offers. Confirm each one with the user,
separately, before writing anything; a "yes" to one is not a "yes" to the
others.

## 1. Install check

Verify gtd is actually usable in this project:

- Resolve the gtd binary: `node_modules/.bin/gtd` relative to the repository
  root, else `gtd` on `PATH`.
- Confirm the repo is gtd-active: a `.gtd/` directory or a `.gtdrc*` file at the
  repository root.

Report what's missing, if anything, and how to fix it:

- No binary resolves → suggest `npm i -D @pmelab/gtd`.
- Binary resolves but the repo isn't gtd-active → suggest `gtd init` (it seeds a
  minimal `.gtdrc.json`; gtd runs its built-in workflow with no further
  configuration).

This check is read-only — nothing to confirm before running it, but still report
the result before moving on to the next offer.

## 2. Statusline

Offer to set the project's Claude Code status line to render gtd's resolved
state (e.g. `gtd: building ⇦ agent (2 pending)`).

- The target is `${CLAUDE_PLUGIN_ROOT}/scripts/statusline.sh`, resolved to its
  **absolute path** (a plugin's installed location is fixed at install time, so
  this resolves to a real filesystem path, not left as a literal
  `${CLAUDE_PLUGIN_ROOT}` string).
- Read the project's `.claude/settings.json` if it exists (treat a missing file
  as `{}`), merge in:

  ```json
  {
    "statusLine": {
      "type": "command",
      "command": "<resolved absolute path>"
    }
  }
  ```

  and write the merged result back. Preserve every other key already in the file
  — this is a read-merge-write, never a clobber of unrelated settings.

- If `statusLine` is already configured, show the user the existing value and
  ask whether to replace it before doing so — don't overwrite a setting they (or
  another tool) already chose on their own.

Mention to the user once this is done: the resolved path can change when the
plugin updates (a new install location), so if the status line goes blank after
an update, re-run `/gtd:setup` to refresh it.

## 3. Permissions

Offer to add a permission allowlist so the loop's autonomous beats — `next`,
`step`, `status`, `validate`, and the project's own test command — run without a
prompt on every single invocation.

- Read-merge-write `.claude/settings.json` again (same rules as above: missing
  file treated as `{}`, every existing key preserved), appending to
  `permissions.allow`:

  ```
  Bash(gtd next*)
  Bash(gtd step*)
  Bash(gtd status*)
  Bash(gtd validate*)
  ```

- Additionally, only if the project's `.gtdrc*` declares a `vars.testCommand`,
  add one more entry for that exact command:

  ```
  Bash(<vars.testCommand>*)
  ```

  (e.g. `vars.testCommand: "npm test"` → `Bash(npm test*)`). Skip this last
  entry entirely if no `testCommand` var is declared anywhere in the config (the
  bundled workflow's default is `npm test`, but only add the allowlist entry for
  a var the project has actually set, not the built-in default — the entry names
  whatever the project's own check script actually runs).

- List exactly the entries you're about to add and get an explicit yes before
  writing. Don't add anything already present in `permissions.allow`.

## 4. Web-session hooks (project settings)

The plugin's own hooks (`Stop` enforcement, the `PreToolUse` commit guard,
`SessionStart` context) run on CLI/desktop only — a plugin's hooks never execute
on Claude Code web. Hooks checked into the PROJECT (`.claude/ settings.json`
plus scripts in the repository) DO run in web sessions. So offer to vendor the
plugin's hardening layer into the project, for users who drive gtd from Claude
Code web:

- Copy the plugin's hook scripts —
  `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/{lib.sh,session-start.sh,stop-gate.sh,pre-tool-guard.sh,notify.sh}`
  — into `.claude/hooks/gtd/` at the repository root, preserving their
  executable bits. The scripts resolve everything (the gtd binary, the repo
  root, the armed marker) from the hook payload's own `cwd` at runtime, so they
  run from a project copy unchanged.
- Read-merge-write `.claude/settings.json` (missing file treated as `{}`, every
  existing key — and every existing hook entry — preserved), appending to
  `hooks`:

  ```json
  {
    "hooks": {
      "SessionStart": [
        {
          "matcher": "startup|resume",
          "hooks": [
            {
              "type": "command",
              "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/gtd/session-start.sh",
              "timeout": 20
            }
          ]
        }
      ],
      "Stop": [
        {
          "hooks": [
            {
              "type": "command",
              "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/gtd/stop-gate.sh",
              "timeout": 120
            }
          ]
        }
      ],
      "PreToolUse": [
        {
          "matcher": "Bash",
          "hooks": [
            {
              "type": "command",
              "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/gtd/pre-tool-guard.sh",
              "timeout": 15
            }
          ]
        }
      ]
    }
  }
  ```

  `$CLAUDE_PROJECT_DIR` (not an absolute path) is what makes this portable into
  a web container's fresh clone. Skip any entry whose command already points at
  the same script.

- Remind the user to COMMIT both `.claude/hooks/gtd/` and
  `.claude/settings.json` — a web session starts from a fresh clone, so only
  checked-in hooks exist there.

Two caveats to state when offering this:

- **On CLI/desktop both registrations fire** — the plugin's own hooks AND the
  project copies. That is safe by design: the guards are idempotent (a second
  identical deny/block is the same decision, and the Stop hook's marker
  self-heal makes the second invocation at a gate silent); the only cosmetic
  effect is `SessionStart` context appearing twice.
- **The copies do not auto-update with the plugin.** After a plugin update,
  re-run `/gtd:setup` — when the vendored copies differ from the plugin's
  current scripts, offer to refresh them (show a diff summary first).

## Doing all four

If the user asks for "everything" or "just set it up", still walk through the
four offers in order, one confirmation each — the point of separating them is
that a user may want the statusline but not the wider permission grant or the
vendored hooks, or vice versa, and install-check is worth surfacing even when
they decline all of the others.
