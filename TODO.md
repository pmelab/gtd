# Issue #127 — loop driver flags `--edit` and `--once`

Add two orthogonal loop-driver flags to `bin/gtd`. Full issue:
`gh issue view 127`.

## 1. `--edit` (`-e`) — force the editor, then drive

Mirror of `--no-edit`. Same loop every time, differing only in editor eagerness:

| command             | at a human gate                                                              | drives loop? |
| ------------------- | ---------------------------------------------------------------------------- | ------------ |
| `gtd`               | auto-open editor, continue on close                                          | yes          |
| `gtd --edit` (`-e`) | **force**-open editor now (on the current rest's `.file`), continue on close | yes          |
| `gtd --no-edit`     | print gate & halt                                                            | yes          |

- Recognize `--edit`/`-e` in the same two sanctioned positions `--no-edit` uses
  (bare, or immediately after `loop`); reject elsewhere.
- Open the _right_ file — the live rest's `.file` — so the human need not know
  which steering file is current.
- **Honesty caveat:** a forced edit is only well-defined at a `"message"` rest.
  Define `--edit` as "force the editor at the current human gate; if it's not a
  human rest, say so and just resume driving" — don't pretend a forced edit is
  meaningful everywhere.
- Retire or demote the `edit` subcommand: fold it into the flag, or keep
  `gtd edit [path]` documented honestly as plumbing.

## 2. `--once` — restrict the loop to one state transition

Runs exactly one loop beat — one human gate, OR one script check + step, OR one
agent prompt + step — then exits.

- Independent, orthogonal concern from `--edit`/`--no-edit`; must combine freely
  (e.g. `gtd --edit --once`).
- Define exit semantics precisely: one iteration of the `while true` body → at
  most one commit / one transition.
- Recognize it in the same sanctioned positions.

## Scope / touch points

- `bin/gtd` (dispatch + loop body)
- `skills/loop/SKILL.md` (driver contract)
- `docs/loop.md`, `docs/cli.md`
- `README.md`
- e2e: `tests/integration/features/edit.feature`, `gtd-loop.feature` (+ new
  scenarios for `--edit` and `--once`)

Keep flags orthogonal per AGENTS.md CLI rules; reject unknown `--` options
rather than degrading silently.
