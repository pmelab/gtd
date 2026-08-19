set -eu

# gtd: human-facing outcome rendering (see src/OutcomeScript.ts)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-}" != dumb ]; then
  gtd_c_reset=$(printf '\033[0m'); gtd_c_bold=$(printf '\033[1m'); gtd_c_dim=$(printf '\033[2m')
  gtd_c_cyan=$(printf '\033[36m'); gtd_c_green=$(printf '\033[32m')
  gtd_m_trans="➡️"; gtd_m_commit="✅"; gtd_m_ellipsis="…"
else
  gtd_c_reset=""; gtd_c_bold=""; gtd_c_dim=""
  gtd_c_cyan=""; gtd_c_green=""
  gtd_m_trans="->"; gtd_m_commit="[commit]"; gtd_m_ellipsis="..."
fi
gtd_files() {
  gtd_files_sha="$1"
  gtd_files_shown=0
  gtd_files_total=0
  gtd_files_list="$(git diff-tree --no-commit-id --name-only -r --root "$gtd_files_sha" 2>/dev/null || true)"
  [ -z "$gtd_files_list" ] && { unset gtd_files_sha gtd_files_f gtd_files_shown gtd_files_total gtd_files_list; return 0; }
  while IFS= read -r gtd_files_f; do [ -n "$gtd_files_f" ] && gtd_files_total=$((gtd_files_total + 1)); done <<EOF
$gtd_files_list
EOF
  while IFS= read -r gtd_files_f; do
    [ -z "$gtd_files_f" ] && continue
    if [ "$gtd_files_shown" -ge 3 ]; then
      printf '   %s%s (%d more)%s\n' "$gtd_c_dim" "$gtd_m_ellipsis" "$((gtd_files_total - 3))" "$gtd_c_reset"
      break
    fi
    printf '   %s%s%s\n' "$gtd_c_dim" "$gtd_files_f" "$gtd_c_reset"
    gtd_files_shown=$((gtd_files_shown + 1))
  done <<EOF
$gtd_files_list
EOF
  unset gtd_files_sha gtd_files_f gtd_files_shown gtd_files_total gtd_files_list
}
gtd_report_transition() {
  gtd_rt_from="$1"
  gtd_rt_to="$2"
  printf '%s %s%s → %s%s\n' "$gtd_m_trans" "${gtd_c_bold}${gtd_c_cyan}" "$gtd_rt_from" "$gtd_rt_to" "$gtd_c_reset"
  gtd_files HEAD
  unset gtd_rt_from gtd_rt_to
}
gtd_report_commit() {
  gtd_rc_subject="$1"
  printf '%s %s%s%s\n' "$gtd_m_commit" "$gtd_c_green" "$gtd_rc_subject" "$gtd_c_reset"
  gtd_files HEAD
  unset gtd_rc_subject
}
gtd_report_note() {
  printf '%s\n' "$1"
}
gtd_report_abandoned() {
  gtd_ra_from="$1"
  gtd_ra_head="$2"
  gtd_ra_state="$3"
  gtd_ra_short="$(git rev-parse --short "$gtd_ra_head")"
  gtd_ra_subject="$(git log -1 --format=%s "$gtd_ra_head")"
  printf 'abandoned the process resting at "%s" — HEAD is back at %s ("%s"), resting at "%s".
Everything the process produced is kept as uncommitted changes (`git status`); discard them with `git checkout -- . && git clean -fd .gtd` for a clean tree.
' "$gtd_ra_from" "$gtd_ra_short" "$gtd_ra_subject" "$gtd_ra_state"
  unset gtd_ra_from gtd_ra_head gtd_ra_state gtd_ra_short gtd_ra_subject
}
gtd_report_restored() {
  gtd_rr_to="$1"
  gtd_rr_state="$2"
  gtd_rr_short="$(git rev-parse --short "$gtd_rr_to")"
  gtd_rr_subject="$(git log -1 --format=%s "$gtd_rr_to")"
  printf 'restored the retained history — HEAD is back at %s ("%s"), resting at "%s". Resume with the loop, or `git reset` to any earlier turn to restart from there.
' "$gtd_rr_short" "$gtd_rr_subject" "$gtd_rr_state"
  unset gtd_rr_to gtd_rr_state gtd_rr_short gtd_rr_subject
}

gtd_report_note 'no gtd process is underway (resting at "idle") — nothing to abandon
'
