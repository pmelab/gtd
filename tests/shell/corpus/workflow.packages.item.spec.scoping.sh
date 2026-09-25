#!/usr/bin/env sh
set +e
rm -f .gtd/SPEC_SCOPE.md .gtd/SPEC_CLEARED.md
pkg=$(cat .gtd/NEXT.md 2>/dev/null)
threshold=0.9; if [ -n "$pkg" ] && [ -f "$pkg" ]; then
  # A byte-length check, independent of any section's own
  # trailer: `specPreJudge`'s confidence gate applies to a GENUINE
  # judgment — but a section `pre` marked structural (its own
  # evidence truncated away, `it.tail(pkgPath, 1)`) is never a
  # genuine judgment, and a driver piping a confident "yes" for
  # THAT id must not be able to ride the same gate into a false
  # approval. When the package file itself is over budget, every
  # section here defaults to failing regardless of any trailer —
  # this gate cannot safely tell WHICH sections were truncated
  # without the same fence-unsafe heading re-parse `it.sections`
  # itself avoids (see docs/configuration.md's `it.sections`
  # entry), so it treats the whole package the conservative way
  # instead, the same blunt-but-safe shape `build.review.triaging`
  # already uses for its own chunks.
  budget=32768; file_bytes=$(wc -c < "$pkg" 2>/dev/null | tr -d ' ')
  truncated=0
  if [ -n "$file_bytes" ] \
    && awk -v f="$file_bytes" -v b="$budget" 'BEGIN{exit !(f>b)}' 2>/dev/null; then
    truncated=1
  fi
  titles=$(awk '/^```/{f=!f} !f && /^## /{sub(/^## /,""); print}' "$pkg")
  total=0
  [ -n "$titles" ] && total=$(printf '%s\n' "$titles" | wc -l | tr -d ' ')
  if [ "$total" -gt 0 ]; then
    trailers=$(git log -1 --format=%B HEAD | grep -o 'Gtd-Judge: {[^}]*}')
    i=1
    while [ "$i" -le "$total" ]; do
      line=$(printf '%s\n' "$trailers" | grep "\"id\":\"section-$i\"" | head -n 1)
      # Missing entirely (padding, a skipped judgment, or a real
      # section the verdict just never answered) defaults to
      # failing — the one default direction this gate must never
      # get wrong.
      failing=1
      if [ "$truncated" -ne 1 ] && [ -n "$line" ]; then
        answer=$(printf '%s' "$line" | sed -n 's/.*"answer":"\{0,1\}\([a-z]*\)"\{0,1\}.*/\1/p')
        # A noul answer is conventionally a JSON boolean
        # (`true`/`false`), never the bare "yes"/"no" `routes:`
        # matching normalizes it to internally (`asRouteAnswers`,
        # src/step/planStep.ts), but the decode accepts a quoted
        # string too — the committed trailer carries the RAW
        # verdict, so both spellings must clear a section here, or
        # a driver using the string form silently loses the whole
        # optimisation, scoping every section into review forever
        # without ever being wrong.
        case "$answer" in (true) answer=yes ;; (false) answer=no ;; esac
        p=$(printf '%s' "$line" | sed -n 's/.*"p":\([0-9.eE+-]*\).*/\1/p')
        # `[ -n "$threshold" ]` guards a BLANK `specPreJudge`: awk
        # treats an empty `-v t=` as the uninitialized strnum `0`,
        # so `p >= t` would be true at ANY probability — turning
        # the workflow's documented "blank disables" convention
        # into fail-APPROVE for this one gate. Blank must instead
        # never clear anything, the same failing default as a
        # missing answer.
        if [ "$answer" = "yes" ] && [ -n "$threshold" ] \
          && awk -v p="$p" -v t="$threshold" 'BEGIN{exit !(p>=t)}' 2>/dev/null; then
          failing=0
        fi
      fi
      if [ "$failing" -eq 1 ]; then
        title=$(printf '%s\n' "$titles" | sed -n "${i}p")
        [ -n "$title" ] && printf -- '- %s\n' "$title" >> .gtd/SPEC_SCOPE.md
      fi
      i=$((i + 1))
    done
    [ -f .gtd/SPEC_SCOPE.md ] || : > .gtd/SPEC_CLEARED.md
  fi
fi
