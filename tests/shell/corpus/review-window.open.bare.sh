git update-ref 'refs/worktree/gtd/review-base' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' &&
git update-ref 'refs/worktree/gtd/review-head' 'HEAD' &&
git reset --mixed 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' &&
if ! out=$(git restore --staged --source='refs/worktree/gtd/review-head' -- '.gtd' 2>&1); then
  case "$out" in
    *"index.lock"*|*"Another git process seems to be running"*) printf '%s\n' "$out" >&2; exit 1 ;;
    *) : ;;
  esac
fi
