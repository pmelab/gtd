# Test coverage plan — close the gaps around the state machine's edges

## Goal

Systematically cover every use and edge case of gtd. The core state ladder and
the review/capture redesign are well covered (250 unit tests, 93 e2e scenarios
before this plan); the remaining risk lives in (1) full multi-run journeys
across state seams, (2) hostile git environments, (3) capture-path content edge
cases, and (4) interruption/resume windows. Each case lists the expected
behavior so a failing test is a spec violation, not a surprise.

**Status: implemented, and all five bugs below are now FIXED** — the nine
expected-fail tests that pinned them are green and remain in the suite as
regression guards. Suite: 269 unit tests, 118 e2e scenarios, all passing.

## Bugs found (pinned first with failing tests, then fixed)

- **B1 — git exit codes are silently swallowed.** `Git.ts`'s `run` helper uses
  `Command.string`, which only collects stdout; non-zero git exits do not fail
  the Effect. Consequences pinned by failing tests:
  - a rejected pre-commit hook → gtd prints a normal prompt, exit 0, nothing
    committed (`environment.feature` "failing pre-commit hook");
  - unusable gpg signing → same silent success (`environment.feature` "Unusable
    commit signing");
  - outside a git repository every probe "succeeds" empty → Idle, exit 0
    (`environment.feature` "outside a git repository");
  - `diffHead`'s intent-to-add feeds C-quoted (`"sketch \303\251..."`) ls-files
    output back to `git add`, the add fails SILENTLY, the capture diff comes
    back empty — and `captureGrillingEdits` then DELETES the file it failed to
    capture: **data loss** (`Events.test.ts` "unicode/space/emoji filename").
    Fix: fail on exit codes (Command.exitCode) or unquote/-z the path
    round-trip.
  - Side effect: `hasCommits` is always true (`rev-parse --verify HEAD`
    "succeeds" on empty repos), which _accidentally_ makes fresh-repo seeding
    work — pinned green by "A fresh repository with no commits seeds a new
    feature".
- **B2 — stripCode stops at the first fenced line.** The fence regex ends with
  `(?:\n\1[^\n]*|$)` under the `m` flag, where `$` matches at EVERY line end —
  so only the first line inside a fence is stripped and a
  `<!-- user answers here -->` marker deeper inside a captured diff arms the
  answers gate, breaking the seed's documented "markers in captures are inert"
  promise (`Events.test.ts` "raw seed containing a deep fenced marker"). Fix:
  anchor the fallback to end-of-input, e.g. `$(?![\s\S])`.
- **B3 — capture fences break under the gtd-format round-trip.** `seedTodo` /
  `appendCapturedInput` use a fixed three-backtick fence; CommonMark accepts a
  space-indented ` ``` ` diff CONTEXT line as a CLOSING fence, so
  `gtd format TODO.md` (instructed after every edit; run by the recommended
  pre-commit hook) truncates the fence and rewrites the captured diff — marker
  included — into plain paragraphs (`Events.test.ts` format round-trip tests).
  Fix: fenceFor-style fence sizing (closing fence must be ≥ opener).
- **B4 — subdirectory invocation mis-derives state.** Steering files and
  pathspecs resolve against cwd, not the repo root; from a subdir gtd hits a
  misleading corruption error (or would silently mis-derive in dirtier states).
  Decided spec: hard-error naming the repo-root requirement
  (`environment.feature` "from a subdirectory refuses").
- **B5 — a CRLF editor defeats checkbox-only approval.** Rewriting line endings
  makes every line a change, so pure ticking routes to Accept Review (feedback)
  instead of Done (`environment.feature` "Checkbox approval survives a CRLF
  editor"). Fix: normalize `\r` in `isCheckboxOnlyDiff`.

## Decisions (grilled 2026-07-02, answered inline)

- Subdir invocation → **hard error** with a clear repo-root message.
- Manual steering-file deletion → **keep the corruption hard-error** (current
  behavior pinned green in `steering-misuse.feature`); message-quality
  improvements welcome later.
- Hanging `testCommand` → **document** (no timeout): the runner waits forever on
  a hung command; noted here as a known limitation. Also documented-
  unsupported: shell metacharacters in `testCommand` (whitespace-tokenized argv,
  no shell — see `TestRunner.ts`).

## Current coverage (inventory)

- Pure machine: all 7 precedence rules, illegal combos, corruption, counter
  folds, gate/filter, capture-action emission, regen carve-out (Machine.test) —
  plus a fast-check property sweep (Machine.property.test).
- Edge: payload facts, review-base rules 1–4 + gate + filter, all EdgeActions
  incl. commit-then-revert and grilling capture (Events.test, Git.test).
- E2e: per-state scenarios across 16 feature files, five full-lifecycle
  journeys, environment/hostility matrix, replay/idempotence sweep.

## 1. Full-journey e2e scenarios — DONE (`journeys.feature`)

- [x] Happy path: dirty tree → … → done → idle, exact subject sequence, idle
      stable on re-run.
- [x] Feedback journey: annotations → `gtd: review feedback` capture → rebuild →
      follow-up review covers only the new package → approve → idle.
- [x] Escalation journey: red ×cap → ERRORS.md → human resume → fresh budget →
      green (no re-escalation).
- [x] Two-package journey: counters reset at the package seam.
- [x] Multi-review branch: approve → gate holds idle → new commit re-opens
      whole-branch review → second approve.

## 2. Pure-machine property sweep — DONE (`Machine.property.test.ts`)

- [x] 2000-run sweep over edge-consistent payloads: only GtdStateError throws,
      illegal throws match the documented combos, one known state, edge action
      from the state's allowed set, `done` requires REVIEW.md, regen carve-out
      shadows Done, deterministic resolution.
- [x] Fold invariants: non-negative counters; RESOLVE events are fold no-ops.

## 3. Capture-path content edge cases — DONE (`Events.test.ts`)

- [x] Binary file added during review → preserved in the capture commit.
- [x] Binary file in a grilling round → accepted loss, pinned.
- [x] `.gitignore`d files survive capture untouched.
- [x] Untracked nested directory captured + removed recursively.
- [x] `git mv` rename during review AND during a grilling round.
- [x] Unicode/space/emoji filename — regression guard for the B1 data loss
      (fixed).
- [x] Mixed checkbox-tick + code edit → feedback, not approval
      (`review.feature`).
- [x] Emptied REVIEW.md → textual change, not approval (`review.feature`).
- [x] Fence collisions — regression guards ×3 for B2 + B3 (fixed).
- [x] Idempotence false-positive (prose identical to capture) → pinned as
      accepted behavior.

## 4. Hostile environments — DONE (`environment.feature`)

- [x] Subdirectory invocation — regression guard for B4 (fixed: clear repo-root
      hard error).
- [x] Not a git repository — regression guard for B1 (fixed: fails fast).
- [x] Fresh repo, no commits, dirty tree → seeds correctly (now via the real
      path: the porcelain probe runs unconditionally).
- [x] Detached HEAD → reviews from merge-base (green).
- [x] Merge commit at HEAD → graceful Idle, no destructive action (green).
- [x] Transport commit as root → clear error (green).
- [x] Reformatting pre-commit hook → flow converges (green).
- [x] Failing pre-commit hook — regression guard for B1 (fixed: the git error
      surfaces, exit 1); resume-after-removal covered too.
- [x] CRLF editor on REVIEW.md checkboxes — regression guard for B5 (fixed).
- [x] Unusable gpg signing — regression guard for B1 (fixed).
- [x] Submodule pointer change → routed as code change, no crash (green).

## 5. Interruption & resume — DONE (`replay.feature`)

- [x] Escalate, Clean, and pending-Agentic-Review double-runs: identical prompt,
      zero new commits. (Auto/approval states are intentionally NOT idempotent —
      regen re-seeds, a committed REVIEW.md approves.)
- [x] Grilling-capture crash window: identical re-capture never double-appends
      (`Events.test.ts`).
- [x] Kill mid-test recovery: clean `gtd: building` HEAD re-enters agentic
      review losslessly.
- [ ] DEFERRED: MAX_EDGE_HOPS runaway guard — untestable without either a
      machine bug to bounce on or extracting the driver loop from `main.ts` into
      a testable unit; revisit if the driver is ever refactored.

## 6. Steering-file misuse — DONE (`steering-misuse.feature`)

- [x] Hand-committed FEEDBACK.md deletion at `gtd: errors` → corruption
      hard-error (pinned; decided to keep).
- [x] Hand-committed REVIEW.md deletion at `gtd: awaiting review` → same.
- [x] Non-package junk inside `.gtd/` ignored by the build loop.
- [x] Empty `.gtd/` directory → Building without a package, no crash.
- [x] Stale-steering illegal-combo messages name the offending file (existing
      `illegal-combinations.feature`, extended with the committed-TODO and
      uncommitted-REVIEW variants).

## 7. Config & test-runner edges — mostly pre-existing

- [x] Malformed YAML/JSON, null-root, list-root, unknown keys, validation
      messages (existing `config.feature`).
- [x] Parent-directory cascade + innermost-wins (existing `config.feature`).
- [x] `fixAttemptCap: 1` boundary (existing "lowered fixAttemptCap" scenario).
- [ ] DEFERRED by decision: hanging `testCommand` (documented, no timeout) and
      shell metacharacters (documented-unsupported tokenized argv).

## 8. Performance smokes — DONE (`Perf.test.ts`)

- [x] 300-commit history: full gatherEvents under 5s (generous CI budget).
- [x] 10k-line review diff renders through buildPrompt under 2s.
