# gtd: spawn E2BIG when the worktree has a large untracked tree (e.g. node_modules not ignored)

Closes pmelab/gtd#568 (https://github.com/pmelab/gtd/issues/568)

After an agent step (`seam.naive`) left a new untracked directory containing an
installed `node_modules` (12,448 files, 222 MB, not gitignored), every following
`gtd next`/landing failed with:

```
{"state":"error","prompt":"spawn E2BIG"}
gtd: spawn E2BIG
✗ landing refused
```

gtd apparently passes every untracked path as argv to a spawned process; the OS
arg limit is exceeded. Workaround applied: added `node_modules/` to
`.git/info/exclude`, re-drove; the process continued.

Expected: gtd never builds argv from an unbounded file list (use
`--pathspec-from-file`/stdin, `-z` + batching, or directory-level paths), and if
a step leaves a huge untracked tree it should surface a clear error ("N
untracked files; add a .gitignore?") instead of E2BIG.
