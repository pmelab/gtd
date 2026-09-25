# Merge `main` into the branch

## Requirement

The branch conflicts with `main` in `tests/tooling/support/run-in-pty.py`.

One file conflicts; `README.md` auto-merges and nothing else does. The merge
base is `63a57f36`.

The conflict is not a real disagreement. This branch widened the post-exit drain
timeout from `0.5s` to `2.0s`. `main` deleted the whole poll-then-drain shape it
widened, replacing it with a read-straight-to-EOF loop plus a 10s watchdog
thread that kills a wedged child — it removes the same flake by construction
rather than by a bigger timeout.

Take `main`'s version of the file whole. Keep no trace of the `2.0s` bump; the
code it edits no longer exists.

Merge, never rebase: rebasing rewrites `1cc43fad`, and this repo's own `gtd`
process commits sit on top of it and reference it by hash.

## Tasks

### Merge `origin/main` and resolve the one conflict

Paths: `tests/tooling/support/run-in-pty.py`, `README.md`.

- [ ] `git fetch origin main`, then `git merge origin/main` — a merge commit,
      never a rebase
- [ ] `tests/tooling/support/run-in-pty.py` resolves to `main`'s version whole
      (`git checkout --theirs` on that path)
- [ ] `grep -n '2\.0' tests/tooling/support/run-in-pty.py` finds no
      drain-timeout constant — the `0.5s` → `2.0s` bump leaves no trace
- [ ] The resolved file still contains `main`'s read-to-EOF loop and its 10s
      watchdog thread
- [ ] `README.md` carries the auto-merged result, unedited by hand
- [ ] `git log --oneline -1` shows a merge commit whose second parent is
      `origin/main`'s head
- [ ] `1cc43fad4f59ec10926af868f6a0076f0c9f0557` is still reachable from `HEAD`
      (`git merge-base --is-ancestor 1cc43fad HEAD` succeeds)

### Prove the merged tree is green

Paths: whole repository.

- [ ] `npm test` passes on the merge commit
- [ ] No `turbo.json`, `package.json` or `.gtd/` file changed as part of the
      merge resolution
