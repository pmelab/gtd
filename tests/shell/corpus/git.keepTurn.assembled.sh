set -eu

git add -A || exit 1
gtd_sign_cfg=$(git config --type=bool --default=false commit.gpgSign) || exit 1
if [ "$gtd_sign_cfg" = true ]; then gtd_sign=-S; else gtd_sign=--no-gpg-sign; fi
gtd_head=$(git rev-parse --verify HEAD) || exit 1
gtd_tree=$(git write-tree) || exit 1
gtd_kept=$(git commit-tree "$gtd_tree" -p "$gtd_head" -m 'gtd(agent): sample') || exit 1
git update-ref 'refs/gtd/kept/entry/step/'"$gtd_kept" "$gtd_kept" || exit 1
gtd_marker=$(printf '%s\nGtd-Kept: %s' 'gtd(agent): sample' "$gtd_kept")
if ! gtd_tip=$(git commit-tree "$gtd_sign" "$gtd_head^{tree}" -p "$gtd_head" -m "$gtd_marker") || ! git update-ref -m 'commit: gtd(agent): sample' HEAD "$gtd_tip" "$gtd_head"; then
  git reset -q && git update-ref -d 'refs/gtd/kept/entry/step/'"$gtd_kept"
  exit 1
fi
git reset --hard HEAD
