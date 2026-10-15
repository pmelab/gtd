set -eu

git add -A || exit 1
gtd_tree=$(git write-tree)
gtd_kept=$(git commit-tree "$gtd_tree" -p HEAD -m 'gtd(agent): sample')
git update-ref 'refs/gtd/kept/entry/step/'"$gtd_kept" "$gtd_kept"
git reset --hard HEAD
gtd_marker=$(printf '%s\nGtd-Kept: %s' 'gtd(agent): sample' "$gtd_kept")
if ! out=$(git commit --allow-empty -m "$gtd_marker" 2>&1); then
  case "$out" in
    *"empty git commit"*) git commit --allow-empty --no-verify -m "$gtd_marker" ;;
    *) printf '%s\n' "$out" >&2; git read-tree -u --reset "$gtd_kept"; git reset -q; git update-ref -d 'refs/gtd/kept/entry/step/'"$gtd_kept"; exit 1 ;;
  esac
fi
