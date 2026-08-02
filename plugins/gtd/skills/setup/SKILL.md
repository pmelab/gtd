---
name: setup
description: One-time setup for the gtd plugin in this project: statusline, permission allowlist, and an install check. Use when the user asks to set up gtd for Claude Code, configure the gtd statusline, or reduce gtd permission prompts.
disable-model-invocation: true
---

# Setting up the gtd plugin

This skill is manual-only (`/gtd:setup`) — it never triggers on its own from a
conversation. It makes three independent offers. Confirm each one with the user,
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

## Doing all three

If the user asks for "everything" or "just set it up", still walk through the
three offers in order, one confirmation each — the point of separating them is
that a user may want the statusline but not the wider permission grant, or vice
versa, and install-check is worth surfacing even when they decline both of the
others.
