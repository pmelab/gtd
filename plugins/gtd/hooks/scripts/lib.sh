# Shared guard helpers, sourced (not executed) by every hook script in this
# plugin. Every guard here follows one rule shared with the rest of the
# plugin plan: "inert outside gtd repos" — an install-and-forget plugin must
# never break, or even visibly react in, a session that isn't a gtd-active
# repository, so every failure path below is silent (exit 0, no output)
# rather than a surfaced error. Callers source this file, then run the
# guards below top-to-bottom before doing anything gtd-shaped.
#
# This file is itself sourced under the caller's `set -euo pipefail`, so a
# function meant to be called as a bare statement (not `$(...)`) can use
# `exit 0` directly to abort the WHOLE script on a guard failure. A function
# meant to be called via command substitution (its stdout is the point) must
# never `exit` — that would only kill the subshell the substitution runs in
# and silently leave the caller with an empty string and a misleadingly
# happy `$?` — so those instead `return` a non-zero status for the caller to
# check explicitly (see armed_marker_path below).

# read_stdin_json — capture the hook's stdin JSON exactly once into
# $HOOK_JSON, so a script can pull multiple fields out of it without racing
# stdin across separate `jq` invocations (stdin can only be read once).
read_stdin_json() {
  HOOK_JSON="$(cat)"
}

# hook_cwd — the session's own working directory, per the hook JSON payload
# (`.cwd`, or `.workspace.current_dir` for the statusline payload shape) —
# and `cd`s the process there. The hook PROCESS's own cwd is not guaranteed
# to match the session it's reporting on, so every script must land here
# before touching git or gtd. Missing/unreachable -> nothing to guard
# against, exit 0 silently.
hook_cwd() {
  local dir
  dir="$(jq -r '.cwd // .workspace.current_dir // empty' <<<"$HOOK_JSON")"
  [[ -n "$dir" ]] || exit 0
  cd -- "$dir" 2>/dev/null || exit 0
}

# require_deps — jq and git are load-bearing for every guard below; an
# install-and-forget plugin must never break a session over a missing
# dependency, so their absence is just another silent-exit guard.
require_deps() {
  command -v jq >/dev/null 2>&1 || exit 0
  command -v git >/dev/null 2>&1 || exit 0
}

# resolve_gtd — from the hook cwd (already `cd`'d to by hook_cwd), finds the
# repo root and the gtd binary to run: the project's own
# node_modules/.bin/gtd when present (never risk driving a DIFFERENT gtd
# install/version than the repo pins), else `gtd` on PATH — the same
# resolution order skills/go/SKILL.md's own preflight uses. Sets $GTD_ROOT
# (and `cd`s there) / $GTD_BIN; either failing to resolve (no repo here, or
# gtd isn't installed) -> exit 0 silently.
resolve_gtd() {
  GTD_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
  cd -- "$GTD_ROOT" 2>/dev/null || exit 0
  if [[ -x "$GTD_ROOT/node_modules/.bin/gtd" ]]; then
    GTD_BIN="$GTD_ROOT/node_modules/.bin/gtd"
  elif command -v gtd >/dev/null 2>&1; then
    GTD_BIN="gtd"
  else
    exit 0
  fi
}

# gtd_active — true iff $GTD_ROOT actually looks like a gtd-managed repo: a
# `.gtd/` state directory, or a `.gtdrc*` config file, at its root. This is
# the "inert outside gtd repos" contract from the plugin plan — every script
# must be a no-op in an ordinary, non-gtd repository. Not active -> exit 0
# silently, same as every other guard here.
gtd_active() {
  [[ -d "$GTD_ROOT/.gtd" ]] && return 0
  compgen -G "$GTD_ROOT/.gtdrc*" >/dev/null 2>&1 && return 0
  exit 0
}

# worktree_git_dir — byte-for-byte bin/gtd's own env-scrubbed
# `git rev-parse --git-dir` (see its comment there for the full rationale):
# GIT_DIR/GIT_WORK_TREE/GIT_COMMON_DIR/GIT_INDEX_FILE are unset for this one
# call so an inherited value (leaked from a parent git process, another
# hook, or another worktree's shell) can never point this hook's
# per-worktree state at a DIFFERENT worktree. Safe to call in the plain
# zero-argument form because resolve_gtd already `cd`'d the process into
# $GTD_ROOT.
worktree_git_dir() {
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR -u GIT_INDEX_FILE \
    git rev-parse --git-dir
}

# armed_marker_path — echoes the loop-armed marker skills/go/SKILL.md writes
# before its first beat and removes when the loop halts: per-worktree,
# inside the git dir, never the work tree (the same placement convention as
# bin/gtd's own memory marker). Called via command substitution, so on
# failure it `return`s non-zero rather than `exit`ing — see the file header.
armed_marker_path() {
  local gd
  gd="$(worktree_git_dir 2>/dev/null)" || return 1
  printf '%s/gtd-claude-loop' "$gd"
}
