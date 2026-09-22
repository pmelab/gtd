#!/usr/bin/env sh
set +e
file=.gtd/REQUIREMENTS.md
label=design
threshold=0.9; if [ ! -f "$file" ]; then
  file=.gtd/ARCHITECTURE.md
  label=architecture
  threshold=0.6; fi
questions=$(gtd check qa "$file" --open-questions 2>&1 \
  | sed -n "s#^${file}:[0-9]*: ##p")
total=0
[ -n "$questions" ] && total=$(printf '%s\n' "$questions" | wc -l | tr -d ' ')
trailers=$(git log -1 --format=%B HEAD | grep -o 'Gtd-Judge: {[^}]*}')
assumptions=$(mktemp)
answered=$(mktemp)
resolved=$(mktemp)
i=1
all_safe=1
while [ "$i" -le "$total" ]; do
  qtext=$(printf '%s\n' "$questions" | sed -n "${i}p")
  b_line=$(printf '%s\n' "$trailers" | grep "\"id\":\"blocking-$i\"" | head -n 1)
  n_line=$(printf '%s\n' "$trailers" | grep "\"id\":\"inferable-$i\"" | head -n 1)
  p_line=$(printf '%s\n' "$trailers" | grep "\"id\":\"pick-$i\"" | head -n 1)
  safe=0
  p_answer=""
  if [ -n "$b_line" ] && [ -n "$n_line" ] && [ -n "$p_line" ] && [ -n "$threshold" ]; then
    b_answer=$(printf '%s' "$b_line" | sed -n 's/.*"answer":"\{0,1\}\([a-z]*\)"\{0,1\}.*/\1/p')
    case "$b_answer" in (true) b_answer=yes ;; (false) b_answer=no ;; esac
    b_p=$(printf '%s' "$b_line" | sed -n 's/.*"p":\([0-9.eE+-]*\).*/\1/p')
    n_answer=$(printf '%s' "$n_line" | sed -n 's/.*"answer":"\{0,1\}\([a-z]*\)"\{0,1\}.*/\1/p')
    case "$n_answer" in (true) n_answer=yes ;; (false) n_answer=no ;; esac
    n_p=$(printf '%s' "$n_line" | sed -n 's/.*"p":\([0-9.eE+-]*\).*/\1/p')
    # A choice answer is a raw JSON string — never a bare "yes"/"no"
    # word, so no true/false normalization applies here.
    p_answer=$(printf '%s' "$p_line" | sed -n 's/.*"answer":"\([^"]*\)".*/\1/p')
    # `pick-i` must name one of question i's OWN listed options —
    # never a blank, an invented value, or one belonging to a
    # different question. `$i` indexes `$questions` — the
    # UNANSWERED-only list `gtd check qa --open-questions` (and so
    # `screen`'s own `openQuestions`/`openQuestionOptions`) already
    # produces — which is NOT the same count as every `### `
    # heading under `## Open Questions`: a question already ticked
    # (but not yet migrated out) still sits there without being
    # unanswered. Matching `q_options` by the question's own TEXT
    # (`$qtext`, from that same `$questions` list), never by
    # position among ALL headings, is what keeps the two aligned —
    # a positional match validated against the wrong question's
    # options on any file with even one already-ticked question.
    q_options=$(awk -v qtext="$qtext" '
      /^## Open Questions[ \t]*$/ { in_open = 1; next }
      in_open && /^## / { in_open = 0 }
      !in_open { next }
      /^### / {
        if (in_q) { for (k = 1; k < n; k++) print opt[k] }
        line = $0
        sub(/^### /, "", line)
        in_q = (line == qtext); n = 0
        next
      }
      in_q && /^[-*] \[[ xX]\] / {
        line = $0
        sub(/^[-*] \[[ xX]\] /, "", line)
        n++; opt[n] = line
      }
      END { if (in_q) { for (k = 1; k < n; k++) print opt[k] } }
    ' "$file")
    picked_valid=0
    if [ -n "$p_answer" ] && printf '%s\n' "$q_options" | grep -Fxq "$p_answer"; then
      picked_valid=1
    fi
    if [ "$b_answer" = "no" ] \
      && awk -v p="$b_p" -v t="$threshold" 'BEGIN{exit !(p>=t)}' 2>/dev/null \
      && [ "$n_answer" = "yes" ] \
      && awk -v p="$n_p" -v t="$threshold" 'BEGIN{exit !(p>=t)}' 2>/dev/null \
      && [ "$picked_valid" -eq 1 ]; then
      safe=1
    fi
  fi
  if [ "$safe" -eq 1 ]; then
    printf -- '- %s → %s — not blocking, confidently inferable; skipped without asking (%s phase).\n' \
      "$qtext" "$p_answer" "$label" >> "$assumptions"
    printf -- '### %s\n\n%s\n\n' "$qtext" "$p_answer" >> "$answered"
    printf '%s\n' "$qtext" >> "$resolved"
  else
    all_safe=0
  fi
  i=$((i + 1))
done
if [ "$total" -gt 0 ] && [ "$all_safe" -eq 1 ]; then
  mkdir -p .gtd
  rm -f .gtd/QUESTIONS.md
  cat "$assumptions" >> .gtd/ASSUMPTIONS.md
  # `-v blockfile=`/`-v resolvedfile=` (PATHS, one line each)
  # rather than `-v` carrying either file's own multi-line text: a
  # whole-value `-v` with an embedded newline is a hard `awk` parse
  # error on at least one POSIX awk this script must run under —
  # `dumpblock()`'s own `getline < blockfile` loop streams the
  # resolved Q&A text in, and `resolved[]` (built once, in BEGIN,
  # from `$resolvedfile`) is the exact-heading-text drop set: a
  # `### ` block under `## Open Questions` is removed ONLY when its
  # own heading text is a member, so an already-ticked SIBLING
  # question — resolved by an earlier human lap, not this judged
  # one — survives untouched. `## Open Questions` itself is only
  # dropped when NOTHING survives under it (`any_kept` stays 0).
  awk -v blockfile="$answered" -v resolvedfile="$resolved" '
    function dumpblock(   line) {
      while ((getline line < blockfile) > 0) print line
      close(blockfile)
    }
    BEGIN {
      while ((getline line < resolvedfile) > 0) resolved[line] = 1
      close(resolvedfile)
    }
    /^## Open Questions[ \t]*$/ {
      in_open = 1; open_heading = $0; buf_n = 0; any_kept = 0
      next
    }
    in_open && /^## / {
      in_open = 0
      if (any_kept) {
        print open_heading
        for (k = 1; k <= buf_n; k++) print buf[k]
      }
    }
    in_open {
      if ($0 ~ /^### /) {
        line = $0
        sub(/^### /, "", line)
        dropping = (line in resolved)
        if (!dropping) any_kept = 1
      }
      if (!dropping) { buf_n++; buf[buf_n] = $0 }
      next
    }
    /^## Answered Questions[ \t]*$/ {
      print
      print ""
      dumpblock()
      printed = 1
      next
    }
    { print }
    END {
      if (in_open && any_kept) {
        print open_heading
        for (k = 1; k <= buf_n; k++) print buf[k]
      }
      if (!printed) {
        print ""
        print "## Answered Questions"
        print ""
        dumpblock()
      }
    }
  ' "$file" > "$file.new" && mv "$file.new" "$file"
fi
rm -f "$assumptions" "$answered" "$resolved"
