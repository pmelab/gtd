# Architecture: PR 391 review 2 — harden `/gtd ship`

Concerns 1–4 merge into **A** (all in `claude/hooks/ship.ts` +
`claude/hooks/ship.test.ts`); concern 5 stays **B** (`.gtd/TODO.md` only).

## Open Questions

### Where does a one-slice re-ship keep the recorded stack top?

**Moving `gtdStackTop` to the new HEAD, as concern 2 states, makes a later
missing-branch rebuild land on the wrong commit.** The rebuild reads a lower
slice at `HEAD~n`, which assumes the top slice is one commit; after a one-slice
re-ship the top slice is two, so `HEAD~1` is the old top commit, the ancestry
check still passes, and `git branch -f` silently points the lower branch there.
The same hits a retry after a `git branch -f` failure inside the re-ship itself.

- [x] Keep `gtdStackTop` at the commit the stack was built at; guard becomes
      "recorded top is an ancestor of HEAD", rebuild reads `<top>~n`
  - drops concern 2's literal "recorded top moves to the new HEAD"; the goal (a
    later resume's top check passes) still holds
  - no new key, no data change; correct for any number of re-ships
  - matches `docs/driver.md`'s "rebuilt only at the commit the stack was built
    at" verbatim
- [ ] Move `gtdStackTop` to the new HEAD as written, plus a new
      `branch.<b>.gtdStackDepth` key (commits on the top slice beyond one);
      rebuild reads `HEAD~(n + depth)`
  - keeps the requirement literally
  - a third record key that must stay paired with the other two on every record,
    retire and forget path
- [ ] Move `gtdStackTop` to the new HEAD as written, rebuild unchanged
  - smallest diff
  - a lower branch deleted after a one-slice re-ship is rebuilt at the wrong
    commit and its pull request shows the top slice's changes
- [ ] _your answer_

## Interfaces

```ts
// claude/hooks/ship.ts — contract unchanged in shape, widened in what it refuses.
// Quote and backslash characters are transparent to the flag check: any word that,
// with `"`, `'` and `\` removed, starts `-o` or `--ou` refuses. Quotes elsewhere
// (`--format='%h %s'`) stay accepted.
export const READ_ONLY_GIT: RegExp
// lookahead becomes, with Q = ["'\\]*:
//   (?![^;&|<>`$()\n]*\sQ-Q(?:o|-Q(?:o)Q(?:u)))   — every char of -o / --ou may be
//   preceded by any run of Q

// Unchanged signature. New behaviour: stack mode + one landed slice + live
// gtdStack record resumes the stack instead of unstacking.
export async function ship(
  io: ShipIo,
  isDry: boolean,
  rawMode?: string,
): Promise<Shipped>
```

```ts
// Module-internal seam (private, tested only through ship()).

// Replaces resumable + resolveStack + settle. Order is fixed:
//   1. read gtdStack; empty -> {}
//   2. viewPr every recorded branch; unreadable -> refusal "… Nothing changed."
//   3. drop leading MERGED slices (never the top)
//   4. any remaining non-OPEN PR -> the closed-slice refusal naming GTD_SHIP_MODE=commits
//   5. top guard, chain check, missing-branch list over the REMAINING uppers only;
//      fallback offsets keep each slice's ORIGINAL index (merged slices still sit
//      in history). No remaining uppers = valid stack of the top alone.
//   6. chain broken -> { forget: true } (log "dropped it" unless dry)
//   7. not dry -> branch -f each missing remaining branch; never a merged one
// `at` is what the chain must reach: "HEAD" on the no-process path, the process
// base (pre-squash HEAD's process start) on the one-slice path.
async function resumable(
  io: ShipIo,
  git: Git,
  ok: Ok,
  branch: string,
  isDry: boolean,
  at: string,
): Promise<{ links?: Link[]; floor?: string; forget?: boolean } | string>
// floor: commit of the highest merged slice, resolved like a missing branch
// (never its local ref), so it resolves after the merged branch is deleted.

// squash()'s result gains `floor`; `resumed` and resolveStack go away —
// ship() passes squashed.stack + squashed.floor straight to stackPreview /
// stackPullRequests.

// One-slice stack-mode path inside squash(), with a live record:
//   resumable(at = groups[0].base)            — before pushHistory: refusal changes nothing
//   forget -> today's single-commit path (retire, unstack, forget)
//   dry   -> dryRun with links; messages aligned so only the top index holds fulls[0]
//   else  -> pushHistory, commitSquash, revive missing branches, top record per the
//            open question, links with top.commit = new HEAD; forget NOT set
// GTD_SHIP_MODE=commits never enters this path.

// pullRequest() and preview() call viewPr(io, branch). viewPr is unchanged:
// non-zero exit = no PR; zero exit with unparseable (incl. empty) stdout = string.
//   preview: string -> fail(`${view} Nothing changed.`)   (dry run, nothing pushed)
//   pullRequest: string -> fail(`${view} ${branch} is pushed; nothing else changed.`)
```

## Call Stacks

- `/gtd ship` → `ship()` → `squash()` → `plan()` → no process →
  `resumable(at=HEAD)` → states → guard/chain over remaining →
  `stackPullRequests(floor)` / `stackPreview`
- `/gtd ship` → `ship()` → `squash()` → `plan()` → one landed slice, stack mode,
  live record → `resumable(at=process base)` → `pushHistory` → `commitSquash` →
  revive → `stackPullRequests(floor)`
- `/gtd ship` → `ship()` → `squash()` → one slice, commits mode or no record →
  `commitSquash` → `pullRequest()` → `viewPr(branch)` → `createPr` / `unstack` +
  `updatePr`
- `/gtd ship -n` → `ship()` → `preview()` → `viewPr(branch)`
- shipper subagent Bash call → `register.tsx` `mayRun` → `READ_ONLY_GIT.test()`

## E2E Scenarios

No e2e change. `/gtd ship` lives in the Claude Code mod (`claude/hooks/`), whose
only test tier is its scripted-`ShipIo` vitest suite; no cucumber scenario
drives it.

## Unit Tests

### READ_ONLY_GIT

- unit: claude/hooks/ship.test.ts — `bad` list gains and refuses
  `git log "--output=x"`, `git log '--output' x`, `git log \--output=x`,
  `git show "-ox"`, `git log -"-"output=x`, `git diff ''--output=x` (covers A/1)
- unit: claude/hooks/ship.test.ts — `ok` list gains and accepts
  `git log --format='%h %s'`, `git log --format="%H%n%B" a..b`; every existing
  `ok` and `bad` entry keeps its verdict (covers A/1)

### ship

- unit: claude/hooks/ship.test.ts — stack mode, one landed slice, live record
  chaining to the process base: squash commit lands on the top branch, no
  `git branch -f`/`gh pr edit --base main` for any slice, top PR refreshed with
  its slice base, no `--unset` of gtdStack (covers A/2)
- unit: claude/hooks/ship.test.ts — same, then a second no-process run with a
  lower branch deleted: rebuilds it at the lower slice's commit, not the old top
  commit (covers A/2)
- unit: claude/hooks/ship.test.ts — stack mode, one landed slice, record that no
  longer chains: retires, ships one PR to the default branch, forgets after the
  PR step (covers A/2)
- unit: claude/hooks/ship.test.ts — `GTD_SHIP_MODE=commits`, one landed slice,
  live record: one commit, retarget to default, record forgotten (existing
  "defers the unset" and "retry after a failed single-squash" tests move to
  commits mode) (covers A/2)
- unit: claude/hooks/ship.test.ts — dry run, stack mode, one landed slice, live
  record: output lists every remaining slice with the commit message only under
  the top, writes nothing (covers A/2)
- unit: claude/hooks/ship.test.ts — one-slice re-ship with a closed lower PR
  refuses before the history push, naming `GTD_SHIP_MODE=commits` (covers A/2,
  A/3)
- unit: claude/hooks/ship.test.ts — resume with bottom slice MERGED and its
  branch missing locally, HEAD not the recorded top: no refusal, no
  `git branch -f` for it, lowest remaining targets the default branch, writer
  range starts at the merged slice's commit (covers A/3)
- unit: claude/hooks/ship.test.ts — resume with every lower slice MERGED: top PR
  retargets to the default branch, stack not dropped as "no longer chains"
  (covers A/3)
- unit: claude/hooks/ship.test.ts — `gh pr view` states are read before any
  `git rev-parse refs/heads/<slice>` or `merge-base --is-ancestor` call (call
  order) (covers A/3)
- unit: claude/hooks/ship.test.ts — closed (not merged) lower slice still
  refuses a resume naming commits mode, nothing pushed (covers A/3)
- unit: claude/hooks/ship.test.ts — "HEAD moved" missing-branch refusal still
  refuses under the new guard (script the ancestor check to fail if the open
  question picks the ancestor guard) (covers A/2, A/3)

### viewPr (via pullRequest / preview)

- unit: claude/hooks/ship.test.ts — real run, single PR path,
  `gh pr view feat/x --json …` returns `not json`: `ok: false`, text names the
  branch, no throw, no `gh pr create|edit` after the push (covers A/4)
- unit: claude/hooks/ship.test.ts — dry run, `gh pr view feat/x --json …`
  returns `not json`: `ok: false`, text names the branch, no throw, no
  `git push` (covers A/4)
- unit: claude/hooks/ship.test.ts — scripted keys `gh pr view --json url` and
  branchless `gh pr view --json number,…` re-keyed to
  `gh pr view <branch> --json number,title,body,url,state,baseRefName`; grep of
  `ship.ts` finds no `JSON.parse` on a `gh pr view` reply outside `viewPr`
  (covers A/4)

### Chores

- chore: docs/driver.md — stacked-ship paragraph: "A single slice ships as one
  commit and one pull request in either mode" becomes: a single slice on a
  branch without a recorded stack ships as one commit and one PR; in `stack`
  mode a single slice on a stacked branch lands on the top branch and keeps the
  stack; `GTD_SHIP_MODE=commits` ships it alone. Rebuild sentence adjusted to
  whatever the open question settles (covers A/2)
- chore: README.md — line ~340 states no one-slice case; leave unchanged (covers
  A/2)
- chore: .gtd/TODO.md — delete the `## Deferred review notes (15386cd)` section;
  keep `836985b`, `daed27f`, `eda53bb` verbatim; no sketch paragraph remains to
  drop (covers B/5)

## Merged Concerns

### A — harden `ship.ts` (concerns 1, 2, 3, 4)

All four change `claude/hooks/ship.ts` and its tests; 2 and 3 rewrite the same
resume path (`resumable`/`settle`), 1 and 4 sit beside it.

**1. `READ_ONLY_GIT` rejects quoted or escaped write flags — TECHNICAL**

**The writer's shell guard lets `git log "--output=x"`, `git log '--output' x`
and `git log \--output=x` through today.** Its lookahead only catches a bare
`-o`/`--ou` right after whitespace, so a quote or backslash before the dash
hides it — and the shell then writes the file.

- Reject every quoted (`"`, `'`) or backslash-escaped form of `-o…` and `--ou…`,
  in `log|show|diff|status|rev-parse|rev-list|merge-base`
- Keep every currently accepted command accepted; keep every currently refused
  one refused
- Add each bypass form to the `bad` list of the `READ_ONLY_GIT` test
- Open for the technical phase: reject quotes and backslashes outright, or strip
  them before the flag check. **Outright rejection also blocks
  `git log --format='%h %s'`, which the writer plausibly runs** — check what the
  writer prompt asks for before picking

**2. One-slice stack-mode ship on a recorded stack resumes it — TECHNICAL**

**Today a process that lands one slice on top of a stack `/gtd ship` built
squashes to one commit, retargets the top pull request to the default branch and
forgets the stack.** The squash takes the single-commit path (`!many`), which
always returns `forget: true`.

- In `stack` mode (the default), a one-slice process whose branch carries a live
  recorded stack resumes that stack: the squash commit lands on the top branch,
  lower slice branches and pull requests stay, the top pull request keeps its
  slice base and is refreshed
- The recorded top moves to the new HEAD, so a later resume's top check still
  passes
- A recorded stack that no longer chains to HEAD still drops and ships alone, as
  resume does today
- `GTD_SHIP_MODE=commits` keeps today's behaviour: one commit, unstack, forget
- Dry run previews the resumed stack, not a single pull request
- Update the stacked-ship paragraph of `docs/driver.md` (and README's ship line
  if it states the one-slice case) to say a one-slice re-ship keeps the stack

**3. Resume drops merged slices before guarding, chaining and rebuilding —
TECHNICAL**

**Resume checks the top guard, walks the chain and recreates missing slice
branches before it asks GitHub which slices merged.** A bottom slice merged and
deleted locally therefore trips the top guard ("Slice branch … is missing") or
gets its branch recreated with `git branch -f`.

- Read pull request states first; drop the leading merged slices
- Run the top guard, the chain check and the missing-branch rebuild over the
  remaining slices only — never recreate a merged slice's branch
- The lowest remaining slice targets the default branch, as `settle` does today;
  the floor commit for it still resolves when the merged branch is gone
- A closed (not merged) slice still refuses with the `GTD_SHIP_MODE=commits`
  hint
- Test: merged-and-deleted bottom slice resumes without refusal and without a
  `git branch -f` for it

**4. `pullRequest` and `preview` read pull requests through `viewPr` —
TECHNICAL**

**Both still call `gh pr view` and `JSON.parse` the reply raw, so a non-JSON
reply throws instead of refusing.**

- Route both through `viewPr`; no raw `JSON.parse` of a `gh pr view` reply
  remains in `ship.ts`
- An unreadable reply becomes a refusal naming the branch, with nothing pushed
  in the dry run and nothing changed after the push in the real run beyond what
  already happened
- `viewPr` already takes the branch; pass the current branch explicitly
- Test: unreadable `gh pr view` output in both paths yields the refusal, no
  throw

### B — prune the done review note (concern 5, unmerged)

**5. Prune the done review note from `.gtd/TODO.md` — TECHNICAL**

**The `15386cd` note is done: `docs/driver.md` lines 396–414 already offer
`GTD_SHIP_MODE=commits` only for a merged or closed lower slice, name a renamed
branch for the top, and describe the commits-mode retarget.**

- Delete the `## Deferred review notes (15386cd)` section
- Keep the `836985b`, `daed27f` and `eda53bb` sections verbatim — the sketch's
  deletion of them was scratch, not intent
- Drop the sketch paragraph itself once folded

## Answered Questions

### Does a one-slice re-ship on a recorded stack keep the lower slices' pull requests untouched?

Yes: only the top branch gains a commit, so lower pull requests are refreshed in
place at most, never retargeted or closed — that is what "resumes it" means.

### Does `GTD_SHIP_MODE=commits` still unstack a one-slice re-ship?

Yes: commits mode is the documented way to ship a stacked branch alone, and the
sketch scopes the change to stack mode.

### Is the `15386cd` deferred note already done?

Yes: the current `docs/driver.md` text covers every point the note asks for, so
it is deleted, not carried into the work.

### Reject quotes outright, or strip them before the flag check?

Strip: the shipper subagent is told to "read the repository with git", and the
workflow summary prompts it reads plausibly lead to `--format='…'`. `mayRun`
stays a `RegExp`, so "strip" is a lookahead that lets any run of `"`, `'`, `\`
precede each character of `-o`/`--ou` — equivalent to stripping, no signature
change.

### Does a quote inside an argument (`--grep='a -o'`) now refuse?

Yes, as an unquoted `--grep=a -o` already does today: a false refusal costs the
writer one retry, a false accept writes a file.

### What does the one-slice path check the chain against?

The process base (`groups[0].base`), not HEAD: before the squash HEAD is the
process tip, and the old stack top is where the process started.

### When does the one-slice path run its resume checks?

Before the history push, so a refusal (closed slice, missing branch with the
guard failing) leaves the repository exactly as it was; branch revives run after
the squash, like a fresh stack's `git branch -f`.

### Is a stack whose lower slices all merged still a stack?

Yes: no remaining uppers is a valid one-link stack whose top targets the default
branch, as `settle` does today — not a "no longer chains" drop.

### Where does the floor commit come from once the merged branch is gone?

From the same fallback the rebuild uses at the merged slice's original index,
never its local ref, which the user may have moved or deleted after the merge.

### Does `viewPr` treat a zero-exit empty reply as "no pull request"?

No: real `gh pr view` never exits zero with empty output, and `stackPrecheck`
and `settle` already treat it as unreadable; tests that left the call unscripted
get it scripted.

### Does the pullRequest refusal undo the push?

No: the push already happened and a force-push back would be a new risk; the
refusal says the branch is pushed and nothing else changed, and a rerun
refreshes.
