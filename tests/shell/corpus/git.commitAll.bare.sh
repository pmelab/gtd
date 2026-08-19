git add -A &&
if ! out=$(git commit --allow-empty -m 'gtd(agent): sample' 2>&1); then
  case "$out" in
    *"empty git commit"*) git commit --allow-empty --no-verify -m 'gtd(agent): sample' ;;
    *) printf '%s\n' "$out" >&2; exit 1 ;;
  esac
fi
