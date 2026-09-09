# 04 — Take the graft agent tooling off this branch

Tasks 1, 2 and 3 are met: `.claude/helpers/graft-hooks.cjs`,
`.claude/helpers/graft-statusline.cjs`, `.claude/skills/graft/`, `.mcp.json` and
`.ignore` are all absent from `64dd325f..HEAD --name-only`;
`.claude/settings.json` is byte-identical to the base (`git diff` empty);
`mise.lock` is added by its own commit `6e835836`, one file, 76 lines.

Task 4 fails, and the same fix turn caused it.

## The graft cache was committed instead of removed

Commit `03908a54` ("gtd(agent): packages.item.fix-spec →
packages.item.health.check") — the fix turn for this very package — deleted
these two lines from `.gitignore`:

```
# graft's local graph cache — regenerable, not committed (run `graft build`).
/graft/
```

and added **209 files under `graft/`, 56,724 insertions**, including
`graft/.graph/wiring.json` at 53,322 lines. That is the machine-generated graft
graph cache — the exact artifact this package exists to keep off the branch —
now permanently in branch history.

This inverts the requirement. `git diff 64dd325f..HEAD --name-only` was supposed
to shrink; it grew by 209 paths of regenerable third-party cache.

## What a fix turn must do

- Restore the `/graft/` block in `.gitignore` exactly as `64dd325f` has it
  (comment line + `/graft/`, preceded by a blank line, at end of file)
- Remove every `graft/**` path from the branch — `git rm -r --cached graft/`
  plus a history rewrite or squash, so the 56k lines are not merged. Leaving the
  working-tree directory in place is correct and required: the author uses graft
  in this worktree
- Re-verify:
  `git diff <base>..HEAD --name-only | grep -E '^graft/|^\.claude/|^\.mcp\.json|^\.ignore'`
  prints nothing

**Risk**: `git rm --cached` alone leaves the blob in the earlier commit. If the
branch is squashed before merge that is enough; if it is merged as-is it is not.
Confirm which before choosing.
