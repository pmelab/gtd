#!/usr/bin/env sh
set +e
rm -f .gtd/REVIEW_FAST.md
{
  printf '# Review: %s\n\n' "$(git rev-parse --short HEAD)"
  printf '<!-- base: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\n\n'
  printf '## Changes\n\n'
  files=$(git diff --name-only aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)
  if [ -n "$files" ]; then
    printf '%s\n' "$files" | while IFS= read -r f; do
      printf -- '- [ ] ./%s — changed\n' "$f"
    done
  else
    printf -- '- [ ] ./.gtd/REVIEW.md — no file changes this round\n'
  fi
} > .gtd/REVIEW.md
