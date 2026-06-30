# Plan: Fix all GitHub issues labeled "bug"

Fix all 13 open bug issues (#11–#23). Each is self-contained with a known
location. Bugs are grouped by source area; bugs within a group touch the same
file and should be batched into one work package to avoid merge conflicts.
Groups are independent and can run in parallel.

Every group must follow AGENTS.md testing rules: add cucumber.js scenarios for
each fix using composable generic `Given` steps that expose actual file
content/changes in scenario text. Update the README for any behavior change.

## Group A — Config schema & loading (src/Config.ts)

All five touch `src/Config.ts`; do as one package, sequentially within it.

- #14 `fixAttemptCap`/`reviewThreshold` accept negative/zero/float silently.
  - `src/Config.ts:70-71`. Replace `Schema.optional(Schema.Number)` with a
    positive-integer constraint (`Schema.Int` + `Schema.positive` /
    `greaterThanOrEqualTo(1)`). Decide bound vs #15: `fixAttemptCap` may legitly
    be 0 (see #15) while `reviewThreshold` likely must be >= 1 — apply `>= 0`
    for cap, `>= 1` for threshold, both integer.
- #16 Non-object config (null, []) silently ignored.
  - `src/Config.ts:169`. The `isPlainObject(result.config)` guard drops a found
    config that decoded to null/array with no warning. Surface an error naming
    the file (`result.filepath`) instead of skipping silently.
- #17 Config parse error doesn't name the offending file.
  - `src/Config.ts:129-131` (yaml/json loaders) and `:147` (`loadMerged`). Wrap
    each loader so a `YAMLParseError`/`SyntaxError` is re-thrown with the
    `filepath` prefixed.
- #21 Config parse errors written to stdout, not stderr.
  - `src/Config.ts:147` uses `Effect.promise`, so a loader exception becomes an
    Effect _defect_ (escapes the typed-error channel and the `main.ts:95`
    `catchAll`, landing on stdout). Switch `loadMerged` to `Effect.tryPromise`
    with a typed `Error`, so it flows through the `main.ts` `catchAll` to stderr
    - exit 1. Coordinate with #17 (same file path message).
- #23 Schema validation error message is ~600 chars.
  - `src/Config.ts:204-205`. Unknown config key dumps the full stringified
    `Schema.Struct` type. Use `ArrayFormatter`/`TreeFormatter` or extract just
    the offending key + a short reason instead of `String(e.message ?? e)`.

## Group B — `format` command (src/main.ts, src/Format.ts)

All touch the format path; one package.

- #18 `format` exits 0 on usage/IO errors.
  - `src/main.ts:43-48` (missing path returns void = exit 0) and
    `src/Format.ts:22-26` (nonexistent file writes stderr, returns void). Make
    both fail the Effect so `main.ts` `catchAll` exits 1.
- #19 `format` silently corrupts non-markdown files.
  - `src/Format.ts:5-9,17` applies `parser: "markdown"` unconditionally.
    Restrict accepted input to markdown (`.md`/`.markdown`) — reject other
    extensions with an error — or infer parser from extension. Given gtd only
    formats TODO/steering markdown, rejecting non-`.md` is the safe choice.
- #20 `format` extra trailing args silently ignored.
  - `src/main.ts:41-48` reads only `argv[3]`. Either format every path argument,
    or reject when more than one path is given. gtd only ever formats one file
    (TODO.md), so reject extra args with a usage error + exit 1 (consistent with
    #18).

## Group C — Git porcelain & code-fence parsing (src/Events.ts)

Both touch `src/Events.ts`; one package.

- #11 Quoted git paths misclassify steering vs code.
  - `src/Events.ts:46-52` `parsePorcelainPaths` does raw `line.slice(3)` without
    C-unquoting. Git C-quotes paths with non-ASCII/space/special chars (wrapped
    in `"` with backslash escapes). Add an unquote step: if the field starts
    with `"`, strip quotes and decode the C-escapes (`\n`, `\t`, `\"`, `\\`,
    octal `\NNN` → bytes → utf8). Then `isGtdPath`/`isSteeringFile` match
    correctly. Add scenarios with a TODO.md path containing a space and a
    unicode filename.
- #12 Unclosed code fence fails to strip the open-question marker.
  - `src/Events.ts:63` `stripCode` regex requires a matching closing fence, so a
    marker inside an _unclosed_ fence is not stripped (read at `Machine.ts:486`
    via `todoMarkerPresent`). Make the fence regex also match an unterminated
    fence running to EOF (alternation: closing fence OR end-of-string). Verify
    inline-code stripping still works.

## Group D — Machine resolve & idempotency (src/Machine.ts, src/Git.ts, src/TestRunner.ts)

- #13 Grilling STOP not idempotent — empty `gtd: grilling` commit per re-run.
  - `src/Machine.ts:486-493` (actually the grilling marker branch at
    `Machine.ts:499-507`) returns `commitPending` even when the tree is clean
    and HEAD is already `gtd: grilling`, and `src/Git.ts:231`/the commit edge
    creates a fresh empty commit. Guard: when waiting for the human answer
    (marker present, tree clean, HEAD already `gtd: grilling`), drop the
    `edgeAction` so re-runs are no-ops. Add a scenario re-running gtd twice at
    the grilling STOP and asserting the commit count is unchanged.
- #15 `cap=0` human-resume sets `capReached:false`, allowing one unintended
  FEEDBACK attempt.
  - `src/Machine.ts:403-406`. Resume path hardcodes
    `capReached: resume ? false : ...`, so with `fixAttemptCap = 0` a resume
    still grants one attempt. Compute `capReached` from the (reset) count vs cap
    even on resume: `(resume ? 0 : counters.testFixCount) >= p.fixAttemptCap`.
    Coordinate the cap=0 semantics with #14's schema bound (cap must allow 0).
- #22 Nonexistent `testCommand` crashes unformatted after committing
  `gtd: building`.
  - `src/TestRunner.ts:59` `Effect.orDie` turns a missing-binary `SystemError`
    into a raw stack on stdout; `src/Events.ts:340-343` consumes the run.
    Replace `orDie` with a typed-error catch: a spawn failure (ENOENT) should
    produce a clean, actionable message routed to stderr (exit 1) rather than a
    defect, and not after a misleading state commit. Treat a failed spawn
    distinctly from a non-zero test exit.

## Cross-cutting

- README: reflect every behavior change (config validation rules, format
  rejecting non-md/extra args + nonzero exit, error-to-stderr semantics).
- Each fix gets cucumber scenarios per AGENTS.md; reuse generic `Given` steps.

no open questions — run gtd to plan
