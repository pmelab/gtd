#!/usr/bin/env sh
set +e
rm -f .gtd/REVIEW_FAST.md
threshold=0.9; trailers=$(git log -1 --format=%B HEAD | grep -o 'Gtd-Judge: {[^}]*}')
fast=1
for spec in mechanicalOnly:yes touchesPublicAPI:no changesBehavior:no; do
  id=${spec%%:*}
  want=${spec#*:}
  line=$(printf '%s\n' "$trailers" | grep "\"id\":\"$id\"" | head -n 1)
  if [ -z "$line" ]; then
    fast=0
    continue
  fi
  answer=$(printf '%s' "$line" | sed -n 's/.*"answer":"\{0,1\}\([a-z]*\)"\{0,1\}.*/\1/p')
  case "$answer" in (true) answer=yes ;; (false) answer=no ;; esac
  if [ "$answer" != "$want" ]; then
    fast=0
    continue
  fi
  p=$(printf '%s' "$line" | sed -n 's/.*"p":\([0-9.eE+-]*\).*/\1/p')
  if [ -z "$threshold" ] \
    || ! awk -v p="$p" -v t="$threshold" 'BEGIN{exit !(p>=t)}' 2>/dev/null; then
    fast=0
  fi
done
if [ "$fast" -eq 1 ]; then
  : > .gtd/REVIEW_FAST.md
fi
