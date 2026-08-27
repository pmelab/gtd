# gtd emitted this and did NOT run it — pipe it into `sh` to land the turn

set -eu

git add -A &&
if ! out=$(git commit --allow-empty -m 'gtd(agent): sample' 2>&1); then
  case "$out" in
    *"empty git commit"*) git commit --allow-empty --no-verify -m 'gtd(agent): sample' ;;
    *) printf '%s\n' "$out" >&2; exit 1 ;;
  esac
fi

# presentation only — safe to skip
(
set -eu

git update-ref 'refs/worktree/gtd/history' 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
) || printf 'gtd: presentation-only follow-up failed — continuing\n' >&2
