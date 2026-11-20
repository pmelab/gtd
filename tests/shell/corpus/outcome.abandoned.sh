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

# gtd: outcome (print-only)
printf 'abandoned the process resting at "%s" — HEAD is back at %s ("%s"), resting at "%s".\nEverything the process produced is kept as uncommitted changes (`git status`); discard them with `git checkout -- . && git clean -fd .gtd` for a clean tree.\n' 'build.fix' "$(git rev-parse --short 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')" "$(git log -1 --format=%s 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')" 'idle'
