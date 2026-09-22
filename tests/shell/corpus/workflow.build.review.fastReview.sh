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
  # The fast path skips `reviewing` entirely — its own prompt is
  # the ONLY other place `.gtd/ASSUMPTIONS.md` gets folded in and
  # swept, so this script owns both here too: a fast-pathed round
  # must never sign off on a review record naming zero inferred
  # answers, and must never leak the file into the next process.
  if [ -f .gtd/ASSUMPTIONS.md ]; then
    printf '\n## Assumptions\n\n'
    cat .gtd/ASSUMPTIONS.md
  fi
} > .gtd/REVIEW.md
rm -f .gtd/ASSUMPTIONS.md
