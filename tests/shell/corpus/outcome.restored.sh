set -eu

# gtd: outcome (print-only)
printf 'restored the retained history — HEAD is back at %s ("%s"), resting at "%s". Resume with the loop, or `git reset` to any earlier turn to restart from there.\n' "$(git rev-parse --short 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')" "$(git log -1 --format=%s 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')" 'await-review'
