# Requirements: PR 391 review 3 fixes

Source: the entry commit `5eb0a983` replaced `.gtd/TODO.md` with a three-point
note ("Fix PR 391 review 3"); its deletion of the three
`## Deferred review notes` sections was incidental (see concern 4). All three
fixes live in `claude/hooks/ship.ts` and its tests in
`claude/hooks/ship.test.ts`.

## 1. A failing `gh pr view` refuses instead of reading as "no PR" — PRODUCT

**Today `viewPr` treats every non-zero `gh pr view` exit as "no pull request".**
A network error, an auth failure or a rate limit therefore lets ship open a
second pull request, or skip the closed/merged-PR refusals in the stack checks.

- **Only a non-zero exit whose stderr reads `no pull requests found` means "no
  PR".** Match that phrase in stderr; nothing else counts as absence.
- **Any other `gh pr view` failure refuses before any write** — no squash, no
  history push, no branch move, no `git config` write. The refusal names the
  branch and carries gh's stderr.
- Every caller already treats a string from `viewPr` as a refusal
  (`stackPrecheck`, `mergedSlices`, `stackPreview`, `sliceStep`, `preview`,
  `pullRequest`); keep that, and check each one returns the refusal before its
  first write.
- **Risk: `sliceStep` and `pullRequest` run after the squash has landed.** There
  "before any write" means before that step's own writes (push,
  `gh pr create/edit`); the squash already made stays, and `/gtd ship` resumes.
- Dry runs refuse the same way.

Acceptance:

- gh stderr `no pull requests found for branch "x"` → ship creates the PR as
  today.
- gh exits non-zero with any other stderr → ship fails, names the branch, shows
  gh's stderr, and the repository (HEAD, branches, git config, remote) is
  unchanged when the failure hits in a pre-squash read.

## 2. A fresh multi-slice stack ship refuses over a live recorded stack — PRODUCT

**Today a multi-slice ship in `stack` mode on a branch that already has a
recorded stack overwrites the record** (`recordStack` writes new
`gtdStack`/`gtdStackTop` keys) and orphans the old slice branches and their pull
requests.

- **Refuse when `branch.<branch>.gtdStack` is set and the process has more than
  one landed slice, in `stack` mode.** "Live" means the `gtdStack` key, the same
  value `ship()` reads as `live`; a retired record (`gtdStackRetired`) alone
  does not refuse.
- **The refusal changes nothing and names both ways out:** ship with
  `GTD_SHIP_MODE=commits`, or unset the record with
  `git config --local --unset branch.<branch>.gtdStack` (and
  `branch.<branch>.gtdStackTop`), then ship again.
- Runs inside `stackPrecheck`, before the history push, so it shares the
  "refusal changes nothing" property and also fires on a dry run.
- Unaffected: a single-slice ship onto the stack (`squashOntoStack`), a resume
  with no gtd process at HEAD, and `GTD_SHIP_MODE=commits`.
- **Docs: `docs/driver.md`'s ship paragraph gets one sentence for this
  refusal**, next to the existing merged/closed-PR refusals.

Acceptance:

- stack mode, two landed slices, `gtdStack` set → ship fails with a message
  naming `GTD_SHIP_MODE=commits` and the `git config --unset` command; HEAD,
  branches, config and remote unchanged.
- same setup with `GTD_SHIP_MODE=commits` → ships as today.
- same setup with only `gtdStackRetired` set → ships a fresh stack as today.

## 3. `sinceHead` uses the synced head only when it sits above `from` — TECHNICAL

**Today `sinceHead` trusts `prSyncHead` whenever it exists and is an ancestor of
`to`.** A synced head below `from` (a stacked slice whose floor moved up, a
lower slice that merged) widens the "commits since the last ship" range past the
PR's own base, so the description update weighs commits that are not this PR's.

- **Use `prSyncHead` only if it resolves to a commit, is an ancestor of `to`,
  AND `from` is an ancestor of it.** Otherwise fall back to `from` (the
  `mergeBase`/floor passed in), as today's fallback does.
- Covers both `updatePr` call shapes: single PR and per-slice stacked PRs.

Acceptance:

- synced head below `from` → range is `from..to`.
- synced head between `from` and `to` → range is `synced..to` (unchanged).
- synced head missing or not an ancestor of `to` → `from..to` (unchanged).

## 4. Keep the deferred review notes — PRODUCT (settled)

**The three `## Deferred review notes` sections stay in `.gtd/TODO.md`
verbatim.** The entry commit's deletion was scratch from replacing TODO.md, not
intent; the notes came from main.

- **Keep all three exactly as they stand after `unwind`:** note-3 (836985b,
  garbled-flag stdout assertion), note-2 (daed27f, `gtd history list` scenario),
  note-1 (eda53bb, `runSummaryCommand` doc comment) — headings, text and
  `[^...]` markers unchanged.
- **Parked, not built:** no package implements, edits, reorders or deletes them.
- The "Fix PR 391 review 3" sketch line is the only TODO.md input folded here.

Acceptance:

- After the process, `.gtd/TODO.md`'s three deferred-note sections match their
  current text byte for byte.

## Answered Questions

### Does "live recorded stack" include a stale record whose top HEAD no longer contains?

Yes. The sketch says "live recorded stack" and `ship()` already names the
unretired `gtdStack` record `live`; refusing on any such record is the safe
reading, and the refusal itself names the one-line unset that clears a stale
one.

### Does the new stack refusal also fire on a dry run?

Yes. Every other stack precheck refuses on a dry run too, so a dry run keeps
predicting the real ship.

### Should an unexpected `gh pr view` failure retry before refusing?

No. The sketch asks for a refusal; ship's other gh failures refuse and leave
`/gtd ship` to retry, and a silent retry hides auth problems.

### Are the three deleted deferred review notes still to be built?

No, and they are not dropped either: the deletion was scratch, so the notes stay
parked in `.gtd/TODO.md` verbatim.
