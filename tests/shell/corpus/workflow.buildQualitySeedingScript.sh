#!/usr/bin/env sh
set +e
[ -f .gtd/QUALITY_DONE.md ] && exit 0
mkdir -p .gtd/reviews
i=1
list="owasp-security, code-simplification"
IFS=,
for name in $list; do
  trimmed=$(printf '%s' "$name" | sed 's/^ *//; s/ *$//')
  if [ -n "$trimmed" ]; then
    printf '%s' "$trimmed" > "$(printf '.gtd/reviews/%02d-%s.md' "$i" "$trimmed")"
    i=$((i + 1))
  fi
done
