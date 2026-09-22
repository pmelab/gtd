#!/usr/bin/env sh
set +e
# A blank threshold disables striking entirely (never deletes a
# "no"-answered finding either) — the same "blank turns this judged
# gate off" convention `scoping`'s own `specPreJudge` guard follows,
# rather than the doc-contradicting "keep every yes, strike every
# no" a bare `[ -n "$threshold" ]`-free comparison would silently
# keep doing.
threshold=0.1; if [ -f .gtd/SPEC_FEEDBACK.md ] && [ -n "$threshold" ]; then
  strike_ids=$(git log -1 --format=%B HEAD | grep -o 'Gtd-Judge: {[^}]*}' | while read -r line; do
    json=${line#Gtd-Judge: }
    id=$(printf '%s' "$json" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
    answer=$(printf '%s' "$json" | sed -n 's/.*"answer":"\{0,1\}\([a-z]*\)"\{0,1\}.*/\1/p')
    # A noul answer is a JSON boolean (`true`/`false`), never the
    # bare "yes"/"no" `routes:` matching normalizes it to
    # internally (`asRouteAnswers`, src/step/planStep.ts) — the
    # committed trailer carries the RAW verdict, so this shell
    # parse must accept both spellings.
    case "$answer" in (true) answer=yes ;; (false) answer=no ;; esac
    p=$(printf '%s' "$json" | sed -n 's/.*"p":\([0-9.eE+-]*\).*/\1/p')
    idx=${id#finding-}
    case "$idx" in ("" | *[!0-9]*) continue ;; esac
    strike=0
    [ "$answer" = "no" ] && strike=1
    if [ "$answer" = "yes" ] && awk -v p="$p" -v t="$threshold" 'BEGIN{exit !(p<t)}' 2>/dev/null; then
      strike=1
    fi
    [ "$strike" -eq 1 ] && printf '%s\n' "$idx"
  done)
  if [ -n "$strike_ids" ]; then
    headings=$(awk '/^```/{f=!f} !f && /^## /{print NR":"$0}' .gtd/SPEC_FEEDBACK.md | cut -d: -f1)
    # `wc -l` counts NEWLINES, not lines — a file whose last line
    # has no trailing newline (nothing in gtd forces one on an
    # agent-authored file) undercounts by one, truncating the
    # final surviving finding's last line. `awk 'END{print NR}'`
    # counts the true line count either way.
    total=$(awk 'END{print NR}' .gtd/SPEC_FEEDBACK.md)
    tmp=$(mktemp)
    # Everything before the first `## ` heading (a preamble the
    # reviewer wrote, never a finding itself) survives
    # unconditionally — a strike must never depend on prose that
    # isn't one of the numbered findings.
    first_heading=$(printf '%s\n' "$headings" | head -n 1)
    if [ -n "$first_heading" ] && [ "$first_heading" -gt 1 ]; then
      sed -n "1,$((first_heading - 1))p" .gtd/SPEC_FEEDBACK.md >> "$tmp"
    fi
    n=0
    any_kept=0
    for start in $headings; do
      n=$((n + 1))
      end=$(printf '%s\n' "$headings" | awk -v s="$start" '$1>s{print $1-1; exit}')
      [ -z "$end" ] && end=$total
      keep=1
      for idx in $strike_ids; do
        [ "$idx" = "$n" ] && keep=0
      done
      if [ "$keep" -eq 1 ]; then
        any_kept=1
        sed -n "${start},${end}p" .gtd/SPEC_FEEDBACK.md >> "$tmp"
      fi
    done
    # Emptiness is judged on SURVIVING FINDINGS, never on bytes: a
    # preamble (title plus prose ahead of the first `## ` heading)
    # keeps the rebuilt file non-empty even after every finding is
    # struck, which would otherwise still land as `M
    # .gtd/SPEC_FEEDBACK.md` and spend the exact `fix-spec` turn
    # this post-judge exists to avoid, with nothing left in the
    # file to act on.
    if [ "$any_kept" -eq 1 ]; then
      mv "$tmp" .gtd/SPEC_FEEDBACK.md
    else
      rm -f "$tmp" .gtd/SPEC_FEEDBACK.md
    fi
  fi
fi
