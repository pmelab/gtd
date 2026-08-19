set -eu

[ "$(git rev-parse --verify --quiet HEAD 2>/dev/null)" = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' ] || { printf 'gtd: repository changed since this script was generated (expected HEAD %s) — re-run gtd\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' >&2; exit 1; }

gtd_retry() {
  gtd_cmd=$1
  gtd_attempt=1
  gtd_delay_ms=10
  while true; do
    if gtd_out=$(eval "$gtd_cmd" 2>&1); then
      [ -n "$gtd_out" ] && printf '%s\n' "$gtd_out"
      unset gtd_cmd gtd_attempt gtd_delay_ms gtd_out gtd_total_ms
      return 0
    fi
    case "$gtd_out" in
      *"index.lock"*|*"Another git process seems to be running"*) ;;
      *)
        printf '%s\n' "$gtd_out" >&2
        unset gtd_cmd gtd_attempt gtd_delay_ms gtd_out gtd_total_ms
        return 1
        ;;
    esac
    if [ "$gtd_attempt" -ge 6 ]; then
      printf '%s\n' "$gtd_out" >&2
      unset gtd_cmd gtd_attempt gtd_delay_ms gtd_out gtd_total_ms
      return 1
    fi
    gtd_total_ms=$(awk -v attempt="$gtd_attempt" -v ms="$gtd_delay_ms" 'BEGIN { jitter = (attempt * 2654435761) % ms + 1; printf "%.3f", (ms + jitter) / 1000 }')
    sleep "$gtd_total_ms"
    gtd_delay_ms=$(( gtd_delay_ms * 2 ))
    gtd_attempt=$(( gtd_attempt + 1 ))
  done
}

gtd_retry 'git update-ref '\''refs/worktree/gtd/history'\'' '\''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'\'''
