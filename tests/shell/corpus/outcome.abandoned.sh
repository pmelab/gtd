set -eu

# gtd: outcome (print-only)
printf 'abandoned the process resting at "%s" — HEAD is back at %s ("%s"), resting at "%s".\nEverything the process produced is kept as uncommitted changes (`git status`); discard them with `git checkout -- . && git clean -fd .gtd` for a clean tree.\n' 'build.fix' "$(git rev-parse --short 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')" "$(git log -1 --format=%s 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')" 'idle'
