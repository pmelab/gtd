#!/usr/bin/env sh
set +e
if ! git diff --quiet 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa^' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' --; then
  mkdir -p "$(dirname '.gtd/FEEDBACK.md')"
  git diff --binary 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa^' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' -- | git apply -R 2> '.gtd/FEEDBACK.md.output'
  code=$?
  if [ "$code" -ne 0 ]; then
    {
      printf '%s\n\n' 'gtd could not unwind it'\''s sketch.'
      if [ -s '.gtd/FEEDBACK.md.output' ]; then cat '.gtd/FEEDBACK.md.output'; else printf 'Reverting it exited %s and produced no output.\n' "$code"; fi
    } > '.gtd/FEEDBACK.md'
  fi
  rm -f '.gtd/FEEDBACK.md.output'
fi
