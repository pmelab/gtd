# gtd emitted this and did NOT run it — run it with `sh` to apply it

set -eu

git add -A || exit 1
if ! out=$(git commit --allow-empty -m 'gtd(agent): sample' 2>&1); then
  case "$out" in
    *"empty git commit"*) git commit --allow-empty --no-verify -m 'gtd(agent): sample' || exit 1 ;;
    *) printf '%s\n' "$out" >&2; exit 1 ;;
  esac
fi
