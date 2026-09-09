# Spec feedback — 04 Take the graft agent tooling off this branch

One residue left. Everything else in the package is verified done.

## Problem — `.gitignore`'s `/graft/` entry survives the revert

`.gitignore` still carries, added on this branch:

```
# graft's local graph cache — regenerable, not committed (run `graft build`).
/graft/
```

It came from commit `a0f69e78`, the same ride-along commit that added
`.claude/helpers/graft-hooks.cjs`, `.claude/helpers/graft-statusline.cjs`,
`.claude/skills/graft/SKILL.md`, `.mcp.json` and `.ignore` — all six of which
this package correctly removed. The `.gitignore` hunk is the seventh file in
that same commit and is the twin of `.ignore`'s `!graft/` line that Task 1
explicitly deletes: one ignores graft's cards, the other re-admits them to
ripgrep. With every graft producer gone from the branch, `/graft/` ignores a
directory nothing on this branch can create, and its comment instructs a reader
to run `graft build` — a tool the branch no longer references anywhere.

**Fix**: delete the two-line `/graft/` block (comment included) from
`.gitignore`. Leave the `src/web/generated.html` block in the same commit alone
— that one belongs to `serve` → `ui`.

## Verified clean — do not re-touch

- `.claude/helpers/graft-hooks.cjs`, `.claude/helpers/graft-statusline.cjs`,
  `.claude/skills/graft/SKILL.md` and the `graft/` skill directory: gone from
  the HEAD tree
- `.mcp.json`, `.ignore`: gone; neither existed at the base commit, so deleting
  the whole file is right, not over-reach
- `.claude/settings.json`: byte-identical to base `64dd325` (`git diff` empty),
  so the four graft hooks, `statusLine`, `subagentStatusLine`,
  `footerLinksRegexes` and the four `Bash(graft…)`/`Bash(node dist/cli.js:*)`
  allowlist entries are all gone — Task 2 fully met
- `mise.lock`: kept, and committed alone in `6e835836` (that commit touches no
  other file) — Task 3 met
- `git ls-tree -r HEAD -- .claude` lists only `.claude/hooks/session-start.sh`
  and `.claude/settings.json`, both at their base blobs
- `git diff 64dd325..HEAD --name-only` names no path under `.claude/`, no
  `.mcp.json`, no `.ignore` — Task 4's three git assertions pass as written
- `64dd325` is confirmed `git merge-base HEAD origin/main`, so `<base>` in the
  acceptance criteria resolves to the range this review used

## Risk

The `.gitignore` line is cosmetic — no test reads it and `npm test` is
unaffected, matching the package's own "blocks nothing". It is still graft
tooling left on a `serve` → `ui` branch, which is the one thing this package
exists to prevent.
