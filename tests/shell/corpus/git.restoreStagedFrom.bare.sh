if ! out=$(git restore --staged --source='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' -- '.gtd' 2>&1); then
  case "$out" in
    *"index.lock"*|*"Another git process seems to be running"*) printf '%s\n' "$out" >&2; exit 1 ;;
    *) : ;;
  esac
fi
