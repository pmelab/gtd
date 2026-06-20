# Task: Document `format` subcommand in README

Add a short section to `README.md` describing the bundled `format` subcommand.

## Content

Cover:

- gtd ships a `format` subcommand that formats a markdown file in place using a
  bundled prettier with a fixed gtd-owned style: `parser: "markdown"`,
  `printWidth: 80`, `proseWrap: "always"`.
- The main gtd prompt instructs the agent to invoke
  `node scripts/gtd.js format <file>` after editing `TODO.md` / `REVIEW.md`.
- The host repo's `.prettierrc` is **intentionally ignored** for determinism
  across consumer repos.
- Upgrading gtd may reflow existing `TODO.md` files if the bundled prettier
  major version changes.

## Acceptance criteria

- [ ] `README.md` mentions the `format` subcommand, the fixed config, and that
      host `.prettierrc` is ignored.
- [ ] Note about prettier major version drift included.

## Files

- `README.md` (edit)
