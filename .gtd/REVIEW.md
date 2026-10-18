# Review: a674f32

<!-- base: 6230714423ca81186820540e7b7d5154778a2c94 -->

No `.feature` file changed. All changes sit in `claude/hooks/ship.ts`, its unit
tests, and `docs/driver.md`.

## Stack record lifecycle: retire, then forget after the PR step

A ship that drops the stack (commits mode, single squash, broken chain) used to
unset the record straight away. A failed PR step then lost the slice names it
needed to retarget the PR on retry. Now the record moves to a `gtdStackRetired`
key, and all three keys are unset only once the PR step succeeds.

- [ ] ./claude/hooks/ship.ts#186-210 — reads live and retired records before the
      squash, retires the live one when this ship drops the stack, forgets all
      keys after a successful PR step.
- [ ] ./claude/hooks/ship.ts#208-208 — Risk: **a leftover retired record wipes a
      freshly built stack.** If a commits-mode ship fails at the PR step
      (retired key set) and a later stack-mode ship succeeds, `retired.length`
      is non-zero, so `forgetStack` unsets the new `gtdStack`/`gtdStackTop` too.
      The next resume then ships one PR, and a commits re-ship no longer
      retargets off the slice base. Fix: on the stack path, unset only
      `RETIRED_KEY`. No test covers this.
- [ ] ./claude/hooks/ship.ts#212-222 — `resolveStack` pulls the
      resume-and-settle branch out of `ship`. Behaviour unchanged.
- [ ] ./claude/hooks/ship.ts#305-321 — new `TOP_KEY`/`RETIRED_KEY`,
      `forgetStack` (unsets all three), and `retireStack` (writes the retired
      key first, so a failed write keeps the live record).
- [ ] ./claude/hooks/ship.ts#325-364 — `plan` reports `forget` instead of
      unsetting the record itself. The no-process commits path always sets
      `forget`.
- [ ] ./claude/hooks/ship.ts#386-439 — `squash` drops its inline unsets and
      `squashOne`. The single and unstacked chain paths return `forget: true`.
      The dry-run object moves to `dryRun` (#366-384).
- [ ] ./claude/hooks/ship.ts#441-461 — `recordStack` writes `gtdStackTop` before
      `gtdStack`. On either failure it runs `forgetStack` and undoes the squash,
      so the two keys only exist as a pair. `forgetStack` here also drops any
      retired record. That is harmless, because the squash is undone and the
      process is back.

## Missing slice branch rebuilt only at the recorded top

On resume, a missing `<branch>-<slice>` branch was rebuilt from `HEAD~n` even
when HEAD had moved, so the slice could point at the wrong commit. Now it is
rebuilt only when HEAD equals the recorded `gtdStackTop`. Otherwise the ship
refuses and names commits mode.

- [ ] ./claude/hooks/ship.ts#552-578 — `topGuard` refuses on the first missing
      slice branch when HEAD is not the recorded top. `reviveMissing` is the
      extracted rebuild loop. **A record written before this change has no top
      key, so any missing slice branch now refuses instead of being rebuilt.**
      That is intended, and tested ("no top recorded").
- [ ] ./claude/hooks/ship.ts#580-613 — `resumable` runs the guard before the
      chain check and returns `{ links, forget }` instead of unsetting the
      record itself. The guard also runs on dry runs, so dry and real runs
      refuse alike.
- [ ] ./claude/hooks/ship.ts#630-634 — a closed lower slice's refusal now names
      `GTD_SHIP_MODE=commits` instead of a raw `git config --unset`.

## Retargeting: only off slice bases, thrown drafts included

- [ ] ./claude/hooks/ship.ts#686-703 — `sliceStep` now retargets a thrown draft
      before rewriting it. A failed retarget keeps the THROWN marker, so a retry
      still rewrites it.
- [ ] ./claude/hooks/ship.ts#909-937 — `unstack` handles both the retarget and
      the stack-line strip, and reports whether anything changed.
- [ ] ./claude/hooks/ship.ts#939-988 — `pullRequest` retargets only when the
      PR's base is one of the recorded (live or retired) slice branches. An
      author-chosen base such as `release/1` stays. The stack line is stripped
      on a slice base or the default branch. A thrown draft is retargeted but
      not body-edited before `createPr` rewrites it. **Behaviour change: any
      other non-default base used to be forced to the default branch. It now
      stays put.**

## Tests

- [ ] ./claude/hooks/ship.test.ts#884-885 — new `TOP`/`RETIRED` key constants.
- [ ] ./claude/hooks/ship.test.ts#1180-1206 — existing resume fixtures gain the
      top key. The config-failure test now also expects the top key to be unset.
- [ ] ./claude/hooks/ship.test.ts#1220-1226 — the closed-slice refusal now
      expects commits mode to be named.
- [ ] ./claude/hooks/ship.test.ts#1260-1263 — `reshipped` now carries a live
      record, so the retarget comes from it.
- [ ] ./claude/hooks/ship.test.ts#1297-1375 — covers: a non-slice base left
      alone; a stale line stripped on the default branch; the unset only after
      the retarget; a failed retarget keeping the record; a single-slice
      stack-mode ship deferring the unset; a no-process commits ship unsetting,
      never on a dry run.
- [ ] ./claude/hooks/ship.test.ts#1377-1403 — a thrown draft is retargeted
      before `gh pr ready`, and a failed retarget stops before any rewrite.
- [ ] ./claude/hooks/ship.test.ts#1405-1421 — a fresh stack writes both keys
      before the branches. A failed top write undoes the squash with no side
      effects.
- [ ] ./claude/hooks/ship.test.ts#1423-1451 — a retry after a failed
      single-squash PR step uses the retired record and does not resume the
      dropped stack.
- [ ] ./claude/hooks/ship.test.ts#1453-1501 — missing slice branch: refuses when
      HEAD moved or no top is recorded, a dry run refuses the same way, a dry
      run at the top never runs `git branch -f`, and with every branch present
      the chain check decides. **Gap: no case ships a stack while a retired
      record exists (see the Risk above).**

## Docs

- [ ] ./docs/driver.md#396-415 — splits the refusal advice: commits mode for a
      lower slice's PR, a renamed branch for a merged or closed top PR. Adds
      what squash and rebase merges do to the PR above, that a commits re-ship
      retargets and leaves the lower PRs open, and that a non-slice base and the
      top-only rebuild rule both hold. This resolves the deferred 15386cd note
      in `.gtd/TODO.md`.
