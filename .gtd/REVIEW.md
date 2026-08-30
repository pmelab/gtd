# Review: 249a1c4

<!-- base: 044e7e846a3c4753dff899c1a0104c8f08f0b248 -->

The eval suite goes from one case (`spec-review`) to nine, one per agent prompt
state the bundled workflow can rest at. Three things changed shape along the
way: the harness became case-generic and agent-generic (Claude Code is now the
default driver, `pi` the opt-in), the graders got a shared core, and the
baseline got re-keyed to `label|case|variant`.

## Harness: one case becomes any case

`run-turn.mjs` stops importing `spec-review` directly and dynamically imports
`./cases/<name>.mjs` from a `case:variant` positional. Structural expectations
moved from hardcoded branches into each case's `expect[variant]`.

- [x] ./evals/run-turn.mjs#142 — `parseArgs` now returns
      `{agent, models, caseName, variant}` and splits the positional on the
      first `:`. The comment explains why index 0 can't be filtered
      unconditionally.
- [x] ./evals/run-turn.mjs#162 — `loadCase` swallows every import error and
      returns `undefined`, which `checkInfra` reports as
      `unknown case "<name>"`. A real syntax error or a bad import inside a case
      file will be misreported as a missing case — confusing when you have just
      written the file you are told does not exist. Worth re-throwing anything
      that isn't `ERR_MODULE_NOT_FOUND`.
- [x] ./evals/run-turn.mjs#465 — `otherFilesOk` treats any `expect.otherFiles`
      that isn't the literal `"none"` as `"required"`. A case that omits the
      field, or typos it, silently grades as coder-shape instead of failing
      loudly.
- [x] ./evals/run-turn.mjs#446 — `outOfBoundsOk` here duplicates
      `checkOutOfBounds` in `evals/asserts/shared.mjs` line for line. The
      comment says so, and there is a reason (this one gates `structurallyOk` so
      the judge is never billed), but the two can drift silently — nothing fails
      if only one is updated.
- [x] ./evals/run-turn.mjs#320 — new oxfmt escape hatch: a `.gtd/` with zero
      formattable files exits 2, which is now read as "zero unformatted files".
      Only `build-fix`'s `clean` variant reaches it today (FEEDBACK.md deleted,
      leaving only the dotfile marker). The match is on English stderr text, so
      an oxfmt message reword turns this back into a hard `fail()`.
- [x] ./evals/run-turn.mjs#423 — `readFeedback` is now driven by
      `caseDef.artifact`, exported purely for the unit test.
- [x] ./evals/fixture.mjs#127 — `.gitignore` with `node_modules/` added to every
      fixture, so a TDD-minded coder turn running `npm install` can't pollute
      `otherFilesChanged`. Note the fixtures ship no `package.json`, so such a
      turn fails anyway — this is belt-and-braces, not a live path.

## Agent abstraction: Claude Code by default, pi opt-in

- [x] ./evals/run-turn.mjs#108 — `AGENTS` table: `resolve`, `missing`, `argv`,
      `env`, `needsGateway`. `driveTurn` never branches on the name. Clean seam.
- [x] ./evals/run-turn.mjs#75 — `buildClaudeArgv` passes `--system-prompt`
      (replace, not append), `--tools Read,Write,Edit,Bash`,
      `bypassPermissions`, `--no-session-persistence`, `--setting-sources ""`. I
      verified all five flags exist in the installed `claude --help`, and that
      `--tools` documents the comma-separated spelling used here.
- [x] ./evals/run-turn.mjs#100 — `resolveOnPath` shells out to `command -v` and
      is called twice per run (once in `checkInfra`, once in `driveTurn`).
      Harmless, but it means the guard and the spawn could in principle resolve
      different binaries.
- [x] ./evals/run-turn.mjs#230 — gateway preconditions are now scoped to
      `needsGateway`. Correct: a Claude run on a machine with no gateway must
      still work. **But `npm run eval` as a whole still needs
      `GTD_EVALS_URL`/`GTD_EVALS_KEY` for the tier-3 judge** — that split is
      only stated in `docs/development.md`, not enforced anywhere, so a fresh
      clone with no gateway fails at the judge, not at startup.
- [x] ./evals/run-turn.mjs#546 — main is now guarded by an `import.meta.url`
      check and the shebang was removed, both so
      `tests/tooling/run-turn.test.ts` can import the module without driving a
      real turn.

## Shared grader core

Four checks that were inline in `spec-review.mjs` became five reusable ones,
plus `safeGrade` so a non-JSON stderr dump reports a reason instead of throwing.

- [x] ./evals/asserts/shared.mjs#1 — `SHARED_CHECKS`, `runChecks`, `safeGrade`.
      Every per-case grader is now "shared core + at most one state-specific
      check".
- [x] ./evals/asserts/shared.mjs#82 — `safeGrade` truncates raw output to 500
      chars. `run-turn.mjs` prints its precondition failures on **stderr** and
      exits 1; check that promptfoo's `exec:` provider actually hands that text
      to the assert as `output` — if it hands back an empty string instead, the
      reason will be `... : ` with nothing useful after it.
- [x] ./evals/asserts/architecture-author.mjs#33 — `recordsAMerge` requires the
      `## Merged Concerns` section to contain each planted requirement body
      verbatim after stripping blockquote markers, emphasis, and whitespace.
      Backticks and quote characters are **not** stripped, so an author that
      rewrites `` `src/pricing/discount.ts` `` as plain text, or curls the
      quotes around "discount", fails a merge it actually performed. Brittlest
      grader in the set.
- [x] ./evals/asserts/build-review-reviewing.mjs#18 — pins REVIEW.md's own
      contract (first line, base marker, one `## ` heading). Same shape this
      file must satisfy.
- [x] ./evals/asserts/packages-item-building.mjs#12 — greps the built source for
      `formatNames` on **both** variants, since neither was asked for it.

## Nine case fixtures

- [x] ./evals/cases/design-triage.mjs#1 — cleanest two-sided pair: same decision
      (`RefundWindowDays`), settled on one side and open on the other.
- [x] ./evals/cases/architecture-author.mjs#1 — merge vs. no-merge on shared
      file footprint.
- [x] ./evals/cases/build-review-collecting.mjs#1 — actionable note vs. bare
      approval.
- [x] ./evals/cases/build-review-reviewing.mjs#1 — planted `sk_live_` secret vs.
      safe refactor.
- [x] ./evals/cases/packages-item-building.mjs#1 — over-reach trap in a second
      package file.
- [x] ./evals/cases/build-fix.mjs#1 — **the `clean` side of the three fix cases
      is not two-sided in the same way the planner cases are.** `build-fix`,
      `packages-item-fix-suite` and `packages-item-fix-spec` all define `clean`
      as "the identical task with the trap file removed", so both sides demand
      the same fix and the only difference graded is whether the trap was
      touched. That measures one axis, not two — a prompt that always cheats
      fails `violation` and passes `clean`, but a prompt that never fixes
      anything fails both. Fine as a trap test; do not read these `clean` cells
      as an over-flagging guard the way `spec-review:clean` is.
- [x] ./evals/cases/packages-item-fix-spec.mjs#1 — same shape, `src/greet.ts`.
- [x] ./evals/cases/packages-item-fix-suite.mjs#1 — same shape,
      `src/parseAmount.ts`.
- [x] ./evals/cases/architecture-decompose.md#1 — the one state with no case,
      and the stated reason. **Nothing enforces this file's claim.** If someone
      adds a decompose case later, or the state's contract changes, this
      markdown goes stale with no test failing. The repo's own rule is that a
      non-obvious constraint lives in a test, not in prose — a one-line
      assertion in `development-doc.test.ts` ("nine of the ten" matches the
      case-file count) would close it.

## promptfoo config and baseline re-keying

- [x] ./evals/promptfooconfig.yaml#42 — one provider, `claude-opus-sonnet`,
      driving `--agent claude --planner opus --coder sonnet`. The pi/gemini
      invocation survives as a commented two-line swap, along with both rejected
      planner measurements.
- [x] ./evals/promptfooconfig.yaml#55 — every test now carries
      `description: "<case>:<variant>"`, which is the only handle
      `--filter-pattern` has. Load-bearing string with no test pinning it:
      rename a description and the documented filter command silently matches
      nothing rather than failing.
- [x] ./evals/report.mjs#15 — `cellKey` gains `vars.case`. This is the change
      that makes every existing baseline key invalid at once.
- [x] ./evals/baseline.json#1 — re-recorded: 18 cells, **all of them 4/4**. A
      perfect floor has zero tolerance band by design (the gate has no slack),
      so any single flaky trial in any of 18 cells reds `npm run eval`. Worth
      knowing before the first non-deterministic failure lands; the fix is a
      deliberate re-record, not a tolerance.
- [x] ./evals/eval.mjs#138 — `isFiltered` skips the baseline gate for any
      `--filter-*` argument. Correct — a subset can't be gated against a whole
      baseline. Note it also catches `--filter-failing` and `--filter-first-n`,
      which is the right behaviour but wider than the doc's example suggests.

## Workflow prompt change

- [x] ./src/workflows/unified.yaml#228 — `fixFeedbackPrompt` changes from "fix
      it, or delete it if the feedback turns out to be wrong" to "address it,
      then delete it … Delete `.gtd/FEEDBACK.md` either way". **This is a change
      to shipped product behaviour, and it lines up exactly with what
      `build-fix` and `packages-item-fix-suite` assert in
      `expect[variant].gtdFiles`.** Confirm the direction is the one you want,
      not the one the eval wanted: the state machine does not require the
      deletion (both fix states transition on `"* **"`, and the health check
      already does `rm -f .gtd/FEEDBACK.md` on green), so this is a prompt-level
      tightening only. The upside is a fix turn that establishes the feedback
      was wrong now still produces a change and can't stall.

## Docs and doc tests

- [x] ./docs/development.md#34 — rewritten `## Prompt evals`: the agent split,
      the filter recipe, the per-variant `expect` contract, the judge pinning,
      the qa/review validate caveat.
- [x] ./docs/development.md#126 — **standards concern.** The "to add a case"
      prose now names internal eval functions by name — `isStructurallyOk`,
      `checkOutOfBounds`, `readFeedback`'s contract, `evals/asserts/shared.mjs`.
      AGENTS.md forbids prose in `docs/` from naming an internal function, and
      this paragraph is exactly the "how it is built" walkthrough that rule
      targets. It is also the longest single paragraph in the file. The
      user-facing fact is the `expect` schema; the rest belongs at the code.
- [x] ./tests/tooling/development-doc.test.ts#1 — pins facts, not line breaks,
      by collapsing whitespace first. Good approach given oxfmt reflows this
      file.
- [x] ./tests/tooling/development-doc.test.ts#56 — the test name says "pinned
      via a pi flag" but the assertion only checks the doc string
      `--tools read,write,edit,bash`; nothing ties it to `PI_TOOLS` in
      `run-turn.mjs`. `run-turn.test.ts` pins the constant separately, so the
      pair is covered — the name just overstates what this one does.
- [x] ./tests/tooling/run-turn.test.ts#1 — unit tests for `buildPiArgv`,
      `buildClaudeArgv`, `parseArgs`, `AGENTS`, `readFeedback`. Note this makes
      `tests/tooling` import from `evals/`; `turbo.json`'s `test:unit` already
      declares `evals/**` in `inputs`, so the cache stays honest.
- [x] ./tests/tooling/eval-baseline.test.ts#11 — mechanical re-key of every
      fixture string to `label|case|variant`.
