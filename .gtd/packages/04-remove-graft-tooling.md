# 04 — Take the graft agent tooling off this branch

## Requirement

TECHNICAL. None of it belongs to `serve` → `ui`. It rode along on two step
commits.

`.claude/helpers/graft-hooks.cjs#7` and the near-identical 98-line
`.claude/helpers/graft-statusline.cjs#7` both hardcode
`BAKED = "/Users/pmelab/.local/share/mise/installs/npm-nanonets-graft/0.16.0/..."`
— a machine-local absolute path carrying the author's home directory and a
pinned install, committed to the repo. `.claude/settings.json#48` adds four
graft hooks (SessionStart, two PostToolUse, UserPromptSubmit, Stop) plus
`statusLine`, `subagentStatusLine` and `footerLinksRegexes` to **project**
settings, so it overrides every contributor's status line and runs graft on
their every prompt, edit and tool call; `#31` allowlists `Bash(graft:*)`,
`Bash(npx graft:*)`, `Bash(graft-dev:*)` and `Bash(node dist/cli.js:*)`, of
which `graft-dev:*` is a local dev alias and `node dist/cli.js:*` is broadly
permissive for a checked-in allowlist. `.mcp.json#1` registers a `graft` MCP
server via a bare `graft` command — a broken server entry for every contributor
who has not installed it. `.claude/skills/graft/SKILL.md#1` vendors a 172-line
third-party skill instructing agents to prefer graft over grep: an unreviewed
instruction surface for every agent that opens the repo. `.ignore#1`'s `!graft/`
re-admits the gitignored cards to ripgrep — a neat trick, and pointless unless
graft is adopted project-wide.

`mise.lock` is the one defensible file: a real reproducibility improvement
alongside the existing `mise.toml`. It is still unrelated to this branch and
belongs in its own commit.

**Risk, blunt**: removing these disables tooling the author uses in this
worktree right now. Take it off this branch, not out of existence — the
alternative is de-hardcoding the baked path and moving the hooks to user
settings, on a branch of their own.

**Acceptance**: `git diff <base>..HEAD --name-only` names no path under
`.claude/`, no `.mcp.json` and no `.ignore`; `npm test` is unaffected either
way, so this concern is the last one and blocks nothing.

## Paths

`.claude/helpers/graft-hooks.cjs`, `.claude/helpers/graft-statusline.cjs`,
`.claude/settings.json`, `.mcp.json`, `.claude/skills/graft/SKILL.md`,
`.ignore`, `mise.lock`.

## Task 1 — Delete the files this branch added

Pure revert, no code.

- [ ] `.claude/helpers/graft-hooks.cjs` is deleted
- [ ] `.claude/helpers/graft-statusline.cjs` is deleted
- [ ] `.claude/skills/graft/SKILL.md` is deleted, and the empty skill directory
      with it
- [ ] `.mcp.json` is deleted
- [ ] `.ignore`'s `!graft/` line is deleted

## Task 2 — Restore `.claude/settings.json` to the base commit's version

Restored to whatever the base commit had, not hand-edited toward it.

- [ ] The four graft hooks (SessionStart, two PostToolUse, UserPromptSubmit,
      Stop) are gone
- [ ] `statusLine`, `subagentStatusLine` and `footerLinksRegexes` are gone
- [ ] The four allowlist entries are gone: `Bash(graft:*)`, `Bash(npx graft:*)`,
      `Bash(graft-dev:*)`, `Bash(node dist/cli.js:*)`
- [ ] The file is byte-identical to the base commit's version

## Task 3 — Keep `mise.lock`, off this branch

- [ ] `mise.lock` is not deleted — it is a real reproducibility improvement
      alongside the existing `mise.toml`
- [ ] It is committed on its own, unrelated to `serve` → `ui`

## Task 4 — Prove the branch is clean

- [ ] `git diff <base>..HEAD --name-only` names no path under `.claude/`
- [ ] It names no `.mcp.json`
- [ ] It names no `.ignore`
- [ ] `npm test` is unaffected either way, so this package is last and blocks
      nothing
- [ ] **Risk, blunt**: this disables tooling the author is using in this
      worktree right now. It is taken off the branch, not out of existence —
      de-hardcoding `BAKED`'s machine-local absolute path and moving the hooks
      to user settings is a branch of its own
