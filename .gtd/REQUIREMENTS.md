# Requirements: PR 391 review 2 — harden `/gtd ship`

Source: `.gtd/TODO.md` sketch in entry commit `2ff958db`. All code lives in
`claude/hooks/ship.ts`, tests in `claude/hooks/ship.test.ts`.

## 1. `READ_ONLY_GIT` rejects quoted or escaped write flags — TECHNICAL

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

## 2. One-slice stack-mode ship on a recorded stack resumes it — TECHNICAL

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

## 3. Resume drops merged slices before guarding, chaining and rebuilding — TECHNICAL

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

## 4. `pullRequest` and `preview` read pull requests through `viewPr` — TECHNICAL

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

## 5. Prune the done review note from `.gtd/TODO.md` — TECHNICAL

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
