# Automatic Markdown Formatting for TODO.md and REVIEW.md

## Plan

### Current State

- Prettier already configured with markdown override:
  - `printWidth: 80`
  - `proseWrap: "always"`
- TODO.md is in `.prettierignore` (currently excluded from formatting)
- REVIEW.md is not excluded (would be formatted if `prettier --write .` runs)
- No automated formatting on commit

### Solution

1. **Remove TODO.md from `.prettierignore`** — allow prettier to format it

2. **Create git pre-commit hook** that auto-formats staged markdown:
   - Path: `.git/hooks/pre-commit`
   - Runs `prettier --write` on TODO.md/REVIEW.md if staged
   - Re-stages files after formatting
   - Lightweight, no husky/lint-staged dependencies needed

### Implementation

```bash
# .git/hooks/pre-commit
#!/bin/sh
# Auto-format TODO.md and REVIEW.md on commit

FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '^(TODO|REVIEW)\.md$')

if [ -n "$FILES" ]; then
  npx prettier --write $FILES
  git add $FILES
fi
```

### Files to Change

1. `.prettierignore` — remove `TODO.md` line
2. `.git/hooks/pre-commit` — create with formatting script

### Notes

- Pre-commit hook is local (not tracked in git). To share with others, could
  document in README or add setup script.
- Using `npx prettier` ensures it uses the local version.
- Hook only formats TODO.md and REVIEW.md to keep it fast.

## Answered Questions

<!-- simple -->
