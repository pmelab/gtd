#!/usr/bin/env sh
set +e
rm -f .gtd/SPEC_SCOPE.md .gtd/SPEC_CLEARED.md
pkg=$(cat .gtd/NEXT.md 2>/dev/null)
threshold=0.9; if [ -n "$pkg" ] && [ -f "$pkg" ]; then
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
      if [ -n "$line" ]; then
        answer=$(printf '%s' "$line" | sed -n 's/.*"answer":"\{0,1\}\([a-z]*\)"\{0,1\}.*/\1/p')
        # Same RAW-verdict shape `striking` documents (a noul
        # answer is conventionally a JSON boolean, but the decode
        # accepts a quoted "yes"/"no" string too) — both spellings
        # must clear a section, or a driver using the string form
        # silently loses the whole optimisation, scoping every
        # section into review forever without ever being wrong.
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
