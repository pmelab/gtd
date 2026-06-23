---
status: grilling
---

# Escalate cap counts feature `fix(gtd):` commits, not just test-fix attempts

Surfaced by dogfooding: a normal multi-package build false-triggered the
`escalate` gate even though the test suite was green.

## Open Questions

### Marker mechanism: a `Gtd-Test-Fix:` commit trailer, a reserved subject token, or forbidding decompose from emitting `fix(gtd):`?

**Recommendation:** A **commit trailer** `Gtd-Test-Fix: 1` on test-fix commits,
and the edge counts the trailing run of commits carrying that trailer (not the
trailing run of `fix(gtd):` subjects). Reasoning:

- **Survives rewording.** The whole bug is that the convention is coupled to
  subject wording. A trailer is body metadata, invisible to Conventional Commits
  tooling and to humans skimming `git log --oneline`, and it cannot collide with
  a feature work package — `decompose` (`src/prompts/decompose.md:55-62`) and
  `execute-simple` (`src/prompts/execute-simple.md:50-52`) generate plain
  `<type>(<scope>): <subject>` messages and will never emit this trailer.
- **Keeps `fix(gtd):` as the subject.** The fix-tests prompt
  (`src/prompts/fix-tests.md:21`) can keep instructing a `fix(gtd): <desc>`
  subject for readability; the _counter_ just stops looking at the subject. No
  reserved-token noise in the subject line, no need to police the decompose
  scope namespace.
- **Why not "forbid decompose from emitting `fix(gtd):`" alone?** It's the
  weakest option: it relies on the agent reliably picking a different scope for
  every bug-fix package forever, and it still breaks the moment a human makes a
  genuine `fix(gtd):` commit by hand between attempts (exactly the third commit
  in the observed repro). The counter must be positively identified, not
  identified-by-absence.
- **Why not a subject token like `fix(gtd): [test-fix] …`?** Works, but pollutes
  every escalate-loop subject line with bracket noise and is still subject-
  coupled (a reword silently resets the counter). A trailer is strictly better
  on both axes.
- **Belt-and-suspenders (both)?** Not worth it. Once counting keys off the
  trailer, the decompose scope is irrelevant to the gate; adding a decompose
  prohibition buys nothing and adds a rule to maintain.

<!-- user answers here -->

### Backward compatibility: existing repos whose history already has plain `fix(gtd):` test-fix commits with no trailer

**Recommendation:** Accept the behaviour change; do **not** add a fallback that
also counts subject-only `fix(gtd):` commits. Reasoning:

- The counter only ever looks at the _trailing run at HEAD_ over the
  `merge-base(defaultBranch, HEAD)..HEAD` range (`src/Events.ts:190-199`). The
  only way an in-flight loop is affected is if, at the instant of upgrade, HEAD
  already sits on top of 1-2 trailing markerless `fix(gtd):` test-fix attempts.
  After the change those stop counting, so the loop gets _more_ attempts before
  escalating — strictly safer (it never escalates a green/recoverable build
  early; worst case it tries one or two extra fixes). It never _masks_ a real
  ERRORS.md escalation, because that path is the independent `errorsPresent`
  guard (`src/Machine.ts:122,183`), unchanged.
- A dual-count fallback (count trailer OR subject) would re-introduce the exact
  false-trigger we're removing, for the sake of a one-cycle transient. Reject
  it.
- Net: the only observable BC effect is "loops mid-flight at upgrade may run up
  to 2 extra attempts once." Documented in the changelog note, no code fallback.

<!-- user answers here -->

### Does the failure-signature-recurrence check need any change?

**Recommendation:** No. Exploration shows there is **no code-level
signature-recurrence comparison**. "Escalate immediately on a recurring
signature" is entirely prompt-driven: the fix-tests prompt
(`src/prompts/fix-tests.md:14`) tells the agent to stop and commit `ERRORS.md`,
and the edge then escalates via the `errorsPresent` guard
(`src/Machine.ts:122`), which keys off a committed `ERRORS.md`, not the subject.
The `spec-test-loop.feature` "recurring error signature escalates immediately"
scenario (lines 112-130) drives escalation purely through a committed
`ERRORS.md`. So the marker change is orthogonal to recurrence — only the
_attempt counter_ (the cap) is touched. Confirm this is acceptable scope.

<!-- user answers here -->

### Trailer value — bare marker (`Gtd-Test-Fix: true`) or attempt ordinal (`Gtd-Test-Fix: 2`)?

**Recommendation:** Bare presence is sufficient for the cap, since the edge
recomputes the count from the trailing run each cycle and does not trust a
per-commit number. But emit the **ordinal** (`Gtd-Test-Fix: <n>`) anyway: it's
self-documenting in `git log`, costs nothing, and matches the sketch's wording.
The edge ignores the value and counts presence. Detection regex keys on the
trailer key only: `/^Gtd-Test-Fix:/m` against the full commit message (subject +
body), not just the subject.

<!-- user answers here -->

## The bug

The Effect edge decides `fix-tests` vs `escalate` by counting the **trailing run
of `fix(gtd):` commit subjects at HEAD**; once that run reaches the fixed cap
(`MAX_VERIFY_ITERATIONS = 3`) it resolves to `escalate` instead of emitting
another `fix-tests` prompt.

The counter assumes every trailing `fix(gtd):`-subject commit is a failed
test-fix attempt. But `fix(gtd):` is also the natural Conventional Commits type
for ordinary bug-fix **work packages** — `decompose`
(`src/prompts/decompose.md:55-62`) writes `COMMIT_MSG.md` files as
`<type>(<scope>): <subject>`, and for a repo named `gtd` a bug fix is exactly
`fix(gtd): …`. So a build that legitimately lands several bug fixes in a row
accumulates a trailing run of `fix(gtd):` commits that have nothing to do with
the test gate, and the cap escalates on green tests.

### Where it lives (traced)

- **Detection:** `src/Events.ts:198` — `isFixGtd: /^fix\(gtd\):/.test(subject)`,
  built in `gatherEvents` from `git.commitSubjects(base)` over the
  `merge-base(defaultBranch, HEAD)..HEAD` range (`src/Events.ts:190-199`).
- **Fold:** `src/Machine.ts` `foldCommit` action (lines 153-158) — increments
  `verifyIterations` when `event.isFixGtd`, resets to 0 otherwise.
- **Cap guard:** `src/Machine.ts:134` `capReached`
  (`verifyIterations >= maxVerifyIterations`), routed to `escalate`
  (`src/Machine.ts:227-231`). Cap constant: `src/Machine.ts:14`
  `MAX_VERIFY_ITERATIONS = 3` (also surfaced in `State.ts:40-43`).
- **Commit convention emitted by the loop:** `src/prompts/fix-tests.md:21`
  ("commit … in a single `fix(gtd): <desc>` commit").
- **No code-level signature-recurrence:** recurrence escalation is prompt-driven
  via a committed `ERRORS.md` → `errorsPresent` guard
  (`src/Machine.ts:122,183`).

## Goal

The `fix-tests`/`escalate` iteration counter must count **only genuine test-fix
attempts** emitted by the fix-tests prompt — never feature/work-package commits
that happen to use the `fix(gtd):` type.

## Plan (pending Open Questions; assumes the trailer recommendation)

The `COMMIT` event already carries a single `isFixGtd` boolean; we only change
**what populates it** and **how the loop tags its commits**. The pure machine
(`foldCommit`, `capReached`) is untouched — its contract ("count trailing run of
flagged commits") is exactly right; only the flag's meaning changes from
"subject is `fix(gtd):`" to "commit carries the test-fix trailer".

1. **`src/prompts/fix-tests.md`** — instruct the success commit to include the
   trailer `Gtd-Test-Fix: <n>` in the commit body (e.g.
   `git commit -m "fix(gtd): <desc>" -m "Gtd-Test-Fix: 1"`), where `<n>` is the
   attempt number. Keep the `fix(gtd):` subject for readability. Make the
   trailer the load-bearing marker the gate counts.

2. **`src/Events.ts`** — the trailing-run flag must key off the trailer, not the
   subject:
   - Need the **full commit message** (subject + body), not just the subject, so
     the trailer is visible. Check `src/Git.ts` `commitSubjects` — if it returns
     subjects only, add/extend a git facet (e.g. `commitMessages` via
     `git log --format=%B%x00` first-parent) and have `gatherEvents` use it.
   - Replace `isFixGtd: /^fix\(gtd\):/.test(subject)` with a trailer test
     `/^Gtd-Test-Fix:/m.test(message)`. Consider renaming the event field
     `isFixGtd` → `isTestFix` across `Machine.ts` (event type line 75,
     foldCommit line 156) and `Events.ts` for clarity; mechanically a rename, no
     logic change. (Decide rename vs keep-name as a low-stakes cleanup, not an
     Open Question.)

3. **`src/Git.ts`** — if it currently exposes only `commitSubjects`, add the
   full-message reader (first-parent, oldest→newest, same range semantics).
   Verify the porcelain/range plumbing in `Events.ts:190-199` is reused so the
   counted range stays `merge-base(defaultBranch, HEAD)..HEAD`.

4. **Tests (cucumber, per AGENTS.md):**
   - **Step composability** — the existing
     `Given("a fix\\(gtd) commit {string}", …)`
     (`tests/integration/support/steps/common.steps.ts:61`) creates an empty
     `fix(gtd):` subject commit _to advance the counter_. After the change a
     bare `fix(gtd):` subject must **no longer advance the counter**. Update
     this step (or add a sibling) so it emits the trailer, and add a _negative_
     step for a plain `fix(gtd):` feature commit that does NOT carry the
     trailer.
   - **`tests/integration/features/verify-loop.feature`** — its premise (lines
     3-5: "counts consecutive `fix(gtd):` commits … a non-`fix(gtd):` commit
     resets") is now wrong. Rewrite around the trailer: trailing trailer commits
     advance; a plain `fix(gtd):` feature commit resets/does-not-advance.
     Scenarios at lines 28-62 use `a fix(gtd) commit "…"` — these must carry the
     trailer.
   - **`tests/integration/features/spec-test-loop.feature`** — scenarios at
     lines 79-107 (`fix(gtd): attempt N`) must carry the trailer; the
     recurring-signature scenario (112-130) is unchanged (ERRORS.md path). Add a
     NEW scenario: **a trailing run of plain `fix(gtd):` feature commits with
     green tests does NOT escalate** — the exact dogfooding repro from this
     report.
   - **`tests/integration/features/test-gate.feature`** — scenarios at lines
     48-64 (`fix(gtd): attempt N` to hit the cap) must carry the trailer; update
     the "consecutive-fix(gtd) cap" prose (lines 4-6, 48-51).
   - **`src/Events.test.ts` / `src/Machine.test.ts`** — update/extend unit tests
     for the new flag source (trailer present → flagged; plain `fix(gtd):` → not
     flagged).

5. **Docs (per CLAUDE.md "reflect every significant change in the readme"):**
   - **`README.md`** lines 58, 73-94, 141, 190-211, 241-242 — replace every
     "trailing run of `fix(gtd):` commits" / "any non-`fix(gtd):` commit resets"
     description with the trailer semantics; keep `fix(gtd): <desc>` as the
     subject the prompt instructs, but state the **counted** signal is the
     `Gtd-Test-Fix:` trailer. Update the mermaid edge labels (lines 190, 211).
   - **`SKILL.md`** lines 111-126, 157-161 — same correction (the
     `> the edge counts the trailing run of fix(gtd): commits at HEAD` paragraph
     at 113-116, the `escalate` row at 125-126, and the fix-tests-prompt
     paragraph at 157-161).
   - Add a short changelog/BC note: existing mid-flight loops at upgrade may run
     up to 2 extra attempts once (no code fallback — see Open Question 2).

### Out of scope

- The cap value (`MAX_VERIFY_ITERATIONS = 3`) stays hardcoded and
  non-overridable (README:88, SKILL:113-114) — unchanged.
- Recurrence-based early escalation (prompt + `ERRORS.md`/`errorsPresent`) —
  unchanged (Open Question 3).
- `execute-simple` / `decompose` commit-message generation — unchanged; with the
  trailer approach they need no constraint (they simply never emit the trailer).

## Resolved
