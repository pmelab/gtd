#!/usr/bin/env sh
set +e
if ! git diff --quiet 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa^' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' --; then
  mkdir -p "$(dirname '.gtd/FEEDBACK.md')"
  git diff --binary --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa^' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' -- | git apply --whitespace=nowarn -R 2> '.gtd/FEEDBACK.md.output'
  code=$?
  if [ "$code" -ne 0 ]; then
    {
      printf '%s\n\n' 'gtd could not unwind it'\''s sketch.'
      if [ -s '.gtd/FEEDBACK.md.output' ]; then cat '.gtd/FEEDBACK.md.output'; else printf 'Reverting it exited %s and produced no output.\n' "$code"; fi
    } > '.gtd/FEEDBACK.md'
  fi
  rm -f '.gtd/FEEDBACK.md.output'
fi
