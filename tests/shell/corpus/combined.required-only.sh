# gtd emitted this and did NOT run it — run it with `sh` to apply it

set -eu

git() {
  gtd_try=1
  while :; do
    gtd_rc=0
    { gtd_err=$(command git "$@" 2>&1 >&3 3>&-) || gtd_rc=$?; } 3>&1
    if [ -n "$gtd_err" ]; then printf '%s\n' "$gtd_err" >&2; fi
    gtd_lock=$(printf '%s\n' "$gtd_err" | sed -nE "s/^(fatal|error): Unable to create '(.*\.lock)': File exists.*/\2/p" | head -n 1)
    if [ "$gtd_rc" = 0 ] || [ -z "$gtd_lock" ] || [ "$gtd_try" -ge 5 ]; then return "$gtd_rc"; fi
    gtd_try=$((gtd_try + 1))
    echo "gtd: git lock busy: $gtd_lock, retry $gtd_try of 5" >&2
    sleep 2
  done
}

git add -A || exit 1
if ! out=$(git commit --allow-empty -m 'gtd(agent): sample' 2>&1); then
  case "$out" in
    *"empty git commit"*) git commit --allow-empty --no-verify -m 'gtd(agent): sample' || exit 1 ;;
    *) printf '%s\n' "$out" >&2; exit 1 ;;
  esac
fi
