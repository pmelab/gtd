# Review: 9aa2f63

<!-- base: 53f0c6742f2e34646972bea75a17c3e20ddcb9cc -->

No `.feature` file changed in this range, so there is no Scenarios chunk.

## One-slice ship onto a recorded stack

**A one-slice ship in `stack` mode on a stacked branch now keeps the stack**:
the squash lands on the top branch and the recorded slices, their PRs and the
recorded top stay. Before, it retired the record and retargeted the top PR to
the default branch. That old behaviour now needs `GTD_SHIP_MODE=commits`.

- [ ] ./claude/hooks/ship.ts#394-410 — `squash` runs the stack reads before the
      history push, then branches: a resumed stack goes to `squashOntoStack`,
      everything else to `land`
- [ ] ./claude/hooks/ship.ts#412-441 — `land` and `sliceLinks` pulled out of
      `squash` unchanged; only the many-slice path writes a new record
- [ ] ./claude/hooks/ship.ts#443-455 — `stackReads` picks the read: the precheck
      for many slices, `resumable` at the squash base for one slice, nothing in
      `commits` mode
- [ ] ./claude/hooks/ship.ts#457-484 — `squashOntoStack` squashes, then revives
      missing lower branches, then swaps the top link's commit for the new HEAD.
      **The recorded top is never rewritten.** Later resumes read missing
      branches off `<top>~n`, so this only holds while the squash base sits at
      or above the old top. A base below it drops the old top from HEAD; the
      next resume then refuses (branch missing) or drops the stack (merged
      floor). Both fail safe.
- [ ] ./docs/driver.md#395-401 — documents the new split: a single slice on a
      stacked branch keeps the stack in `stack` mode, `GTD_SHIP_MODE=commits`
      ships it alone

## Resuming reads PR states before anything else

**`settle` and `resolveStack` are folded into `resumable`.** Merged lower slices
now drop out before the chain check, and the merged floor is read off the
recorded top instead of a lower slice's local ref.

- [ ] ./claude/hooks/ship.ts#194-198 — `ship` takes `stack`/`floor` straight
      from the squash result; the post-squash settle step is gone
- [ ] ./claude/hooks/ship.ts#321-331 — the no-process path resumes at HEAD and
      runs `revive` itself, since nothing is squashed first
- [ ] ./claude/hooks/ship.ts#575-604 — `chain` checks only the unmerged lower
      slices and rebuilds a missing branch from `<top>~n`, not `HEAD~n`
- [ ] ./claude/hooks/ship.ts#605-623 — `topGuard` accepts any HEAD that still
      contains the recorded top. Before, HEAD had to equal it exactly. If the
      top is gone and nothing is missing but lower slices merged, it returns
      `rebased` and the stack is dropped.
- [ ] ./claude/hooks/ship.ts#625-652 — `mergedSlices` reads every slice's PR up
      front. A closed lower PR, or a merged or closed top PR, refuses, and the
      top case now says to rename the branch. **Any `gh` failure still counts as
      "no PR"**, so offline or unauthenticated runs count every slice as
      unmerged.
- [ ] ./claude/hooks/ship.ts#654-700 — `resumable` does every read before any
      write and hands back `revive` for the caller to run after the squash. It
      refuses when a merged floor's commit cannot be resolved off the top

## PR lookup by branch name

**`gh pr view` now names the branch, and a reply that is not JSON is an error
instead of a crash.** Both the dry-run preview and the real single-branch ship
go through `viewPr`.

- [ ] ./claude/hooks/ship.ts#954-960 — the dry run fails with "Nothing changed."
      on an unreadable reply instead of letting `JSON.parse` throw
- [ ] ./claude/hooks/ship.ts#1021-1026 — the real ship fails after the push,
      saying the branch is pushed and nothing else changed

## Read-only git allowlist hardening

**`READ_ONLY_GIT` now sees through quotes and backslashes, rejects glob/brace
characters, and blocks `--no-*`, `--ex*` and `--te*` flags.** That stops
`--output` smuggled in quoted, escaped or globbed, plus `--no-index`,
`--ext-diff` and `--textconv`.

- [ ] ./claude/hooks/ship.ts#1076-1083 — Risk: **quoted or escaped `..` still
      reads files outside the repository.** The fix adds a `diff`-only lookahead
      that refuses absolute, `~` and `..` path arguments, so
      `git diff /etc/hosts /dev/null` and `git diff ../x y` now fail. But the
      `..` check, unlike the flag check, is not quote-transparent:
      `git diff '.'./x README.md`, `git diff .\./x README.md`,
      `git diff ."."/x y` and `git diff x/.\./.\./y z` all pass. Verified in
      bash:
      `git diff --stat '.'./feat-381-naive-pass-slices/package.json package.json`
      diffs a sibling worktree's file, so git fell back to no-index. Fix: refuse
      any `"`, `'` or `\` in a `diff` command outright, or strip them before
      testing. Add those four strings to the rejected list. The blanket `--no-`
      block also rejects harmless flags such as `--no-ext-diff`, `--no-textconv`
      and `--no-merges`. The writer just gets refused, so nothing is unsafe.
- [ ] ./claude/hooks/ship.test.ts#526-527 — accepted: a `--` pathspec and a
      trailing-slash directory, so the new path check does not refuse ordinary
      relative paths
- [ ] ./claude/hooks/ship.test.ts#564-570 — rejected: absolute paths plain,
      after `--` and quoted, plus `~`, leading `..`, embedded `/../` and a
      double-quoted `..`. None covers a single-quoted or backslash-escaped dot

## Tests

- [ ] ./claude/hooks/ship.test.ts#1556-1564 — `lowerGone` fixture: HEAD past the
      top with the lower branch deleted, and `HEAD~1` scripted to a wrong commit
      so a `HEAD~n` rebuild would show up
- [ ] ./claude/hooks/ship.test.ts#1566-1664 — one-slice resume: stack kept, no
      top write, lower branch revived only after the reset, a broken chain
      retires then forgets after the retarget, `commits` mode forgets, dry run
      puts the message only under the top, a closed lower PR refuses before any
      push
- [ ] ./claude/hooks/ship.test.ts#1666-1742 — PR states read first: merged
      bottom with branch gone needs no revive, all lower merged retargets to
      main without unsetting, floor read off the top and never the local ref, a
      dropped top ships alone, an unreadable floor refuses with nothing mutated,
      rebuild uses `<top>~1` and never `HEAD~`
- [ ] ./claude/hooks/ship.test.ts#1744-1764 — non-JSON `gh pr view`: the real
      ship names the branch, pushes and edits no PR; the dry run pushes nothing
- [ ] ./claude/hooks/ship.test.ts#1504-1525 — refusal case renamed: "HEAD no
      longer contains the top" is now an ancestry failure instead of HEAD
      inequality
- [ ] ./claude/hooks/ship.test.ts#1388-1399 — the deferred-unset test now runs
      in `commits` mode, because one-slice `stack` mode no longer retargets
- [ ] ./claude/hooks/ship.test.ts#1468-1468 — the retired-record retry test also
      switched to `commits` mode for the same reason
- [ ] ./claude/hooks/ship.test.ts#1200-1219 — the revive retry now rebuilds from
      `${C2}~1` (the recorded top) instead of `HEAD~1`
- [ ] ./claude/hooks/ship.test.ts#1241-1249 — the merged-lower test now scripts
      the recorded top, which the floor read needs
- [ ] ./claude/hooks/ship.test.ts#533-534 — allowlist accepts quoted `--format`
      values
- [ ] ./claude/hooks/ship.test.ts#553-574 — allowlist rejects quoted, escaped,
      braced and globbed `--output`, plus `--no-index`, `--ext-diff` and
      `--textconv`; the new no-index cases are listed under the allowlist chunk
- [ ] ./claude/hooks/ship.test.ts#67-67 — `gh pr view` fixtures now carry the
      branch argument
- [ ] ./claude/hooks/ship.test.ts#403-405 — same fixture rename
- [ ] ./claude/hooks/ship.test.ts#450-452 — same fixture rename
- [ ] ./claude/hooks/ship.test.ts#471-473 — same fixture rename
- [ ] ./claude/hooks/ship.test.ts#1300-1300 — same fixture rename
- [ ] ./claude/hooks/ship.test.ts#1341-1341 — same fixture rename
- [ ] ./claude/hooks/ship.test.ts#1357-1357 — same fixture rename
- [ ] ./claude/hooks/handoff.test.ts#218-220 — same fixture rename in the
      handoff test

## Docs and housekeeping

- [ ] ./docs/driver.md#415-417 — a missing slice branch is now rebuilt while the
      branch still contains the commits the stack was built at, not only while
      HEAD equals the top
- [ ] ./.gtd/TODO.md#15-17 — the deferred driver.md note (15386cd) is removed;
      the doc text it asked for is already there
