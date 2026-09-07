# Spec feedback — 02 Worktree discovery and the fleet screen

Two concrete problems. Everything else in T1–T6 checks out.

## 1. The loop-log cache axis is wrong for every plain repo (T3)

`src/serve/Beat.ts` joins the beat's `file` against the worktree path
(`okResult`, and the warm-path check in `BeatCache.read`) but passes the beat's
`log` to `statMtime` verbatim. `log` is only absolute for a LINKED worktree. For
an ordinary clone — a `.git` directory, no `gitdir:` pointer — `loopLogPath`
falls back to `worktreeGitDir`'s literal `".git"` and `gtd next --json` reports
the relative `.git/gtd-loop.log`. Verified against the built bundle in a fresh
`git init` repo: `log= .git/gtd-loop.log file= .gtd/TODO.md`.

So `statMtime(".git/gtd-loop.log")` resolves against the SERVER process's own
cwd, not the worktree:

- touching a worktree's real loop log never invalidates its entry — T3's
  "touching the loop log invalidates the entry" is unmet on the real path
- `gtd serve` runs inside a gtd repo, so that relative path usually resolves to
  the SERVER's own log, one shared file across every plain-repo row; touching it
  invalidates all of them at once and forces a full 30-worktree cold reload
- linked worktrees are unaffected, which is why the bug is invisible in normal
  use of a herdr-style fleet and fires on plain clones

The T3 test masks it: `beatJson()` in `src/serve/Beat.test.ts` hardcodes
`log: "/repos/gtd/.git/gtd-loop.log"`, an absolute path. A fix needs a case with
a relative `log` asserting the stat lands under the worktree path.

## 2. The version check inspects a gtd that never runs (T5)

`coldRead` calls `readLocalGtdVersion` → `readLocalGtdVersionAt`, which reads
`<worktree>/node_modules/@pmelab/gtd/package.json`. But the beat is spawned by
`liveRunInWorktree` as `bash -c "gtd next --json"` with the inherited
environment — `node_modules/.bin` is not on `$PATH`, so the binary that actually
runs is the server's own `$PATH` gtd, never that local install.

Consequences, both wrong:

- a worktree with an older gtd devDependency is marked Broken ("unsupported gtd
  version: X") even though its beat would have read fine
- the range check that T5 asks for never guards the version that is really
  parsing the beat

Either put the local install on the spawn's `$PATH` so the checked version is
the executed one, or drop the local-install probe and range-check what the run
actually reports.
