# Review: e71b62d

<!-- base: 2a0f82cb1814c7045c2825cfaad983b7d2a94bf1 -->

**Quality-fix round on the stacked ship: tighter writer git allowlist, one
closure dropped, docs and a key comment brought in line with the resume rule.**
No `.feature` file changed. `claude/hooks/ship.test.ts` passes (154/154, unit
project).

**Not addressed in this round, still open from the quality pass:** no test for a
failed `git branch -f` revive after a one-slice squash, no three-slice resume to
exercise the merged-slice offsets, no CLOSED-top-PR-on-resume test, no `@inmem`
scenario for the one-slice re-ship onto a stack.

## Writer git allowlist: refuse quoted `git diff`, narrow the flag blacklist

`READ_ONLY_GIT` gates what ship's message writer may run. Two changes. First,
**any `git diff` containing a quote or backslash is now refused outright**,
because the `..` path check could be dodged by shell quoting (`."."/x` becomes
`../x`, which makes diff fall back to `--no-index` and read files outside the
repo). Second, **the flag lookahead no longer refuses every `--no-*`, `--ex*`
and `--te*` flag** — it now blocks only `--no-index`, `--ext-diff` and
`--textconv`, so ship's own `git log --no-merges` is allowed again.

Checked against git 2.54: diff/log options take no abbreviations (`--outp`,
`--ext-d`, `--textc` are rejected; `--no-ind` is ambiguous), so matching the
full prefixes is enough. **FYI: a writer running `git diff --stat 'a..b'` is now
refused; it must drop the quotes.**

- [ ] ./claude/hooks/ship.ts#1082-1090 — quoted-diff refusal, narrowed flags
- [ ] ./claude/hooks/ship.test.ts#535-537 — accepts `--no-merges`, `--text`
- [ ] ./claude/hooks/ship.test.ts#562-565 — refuses quoted `..` diff paths
- [ ] ./claude/hooks/ship.test.ts#571-571 — refuses in-tree `--no-index`

## Squash: `land` builds slice links itself

`squash` used to pass `land` a `links` closure over `branch` and `groups`, which
`land` already receives. **The closure is gone; both call sites call
`sliceLinks` directly.** No behaviour change.

- [ ] ./claude/hooks/ship.ts#400-416 — dry run calls `sliceLinks` inline
- [ ] ./claude/hooks/ship.ts#420-440 — `land` drops its `links` parameter

## Resume rule: docs and key comment match the code

**`gtdStackTop` is never moved; a missing slice branch is rebuilt off it while
HEAD still contains it** — the old comment claimed HEAD had to equal it. Docs
now say **only a fresh multi-slice stack refuses a merged lower slice's pull
request; a resume or a one-slice re-ship skips it.** The rest of the paragraph
is only reflowed. **The split stays: same branch, same merged PR, the outcome
depends on how many slices the new process landed** — documented, not unified.

- [ ] ./claude/hooks/ship.ts#295-297 — `TOP_KEY` comment: ancestor rule
- [ ] ./docs/driver.md#401-418 — merged-PR refusal narrowed to fresh stacks

## Tests: call-shape assertion removed

**The one-slice re-ship test no longer asserts
`git merge-base --is-ancestor C1 BASE` ran**: unscripted commands succeed, so it
only proved the call happened. The `at = base` ancestry check stays pinned by "a
record that no longer chains retires…".

- [ ] ./claude/hooks/ship.test.ts#1590-1597 — drops the is-ancestor assertion
