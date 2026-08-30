A `gtd land` refusal still grades as a PASS for one bundled cell, and
`matchGtdFiles` throws on two reachable inputs. Everything else in the package
checks out: `evals/expect.mjs` is the single comparison site, both importers
call it, the case/grader/config/doc edits and the deletion of
`evals/cases/architecture-decompose.md` match their acceptance criteria, and
`npm test` is green.

## 1. Task 4 — `landError` is emitted but no grader reads it, so `spec-review:clean` passes on a refused land

`evals/run-turn.mjs`'s new `landAndInspect` catch returns `gtdFilesChanged: []`,
`otherFilesChanged: []`, `unformatted: []` and `landError`. For a variant whose
expectation _is_ "changed nothing", every shared check then passes and
`safeGrade` returns `pass: true`. Reproduced:

```
node -e 'Promise.all([import("./evals/asserts/shared.mjs"),import("./evals/cases/spec-review.mjs")]).then(([s,c])=>{
const json = JSON.stringify({feedbackExists:false,feedback:"",gtdFilesChanged:[],otherFilesChanged:[],unformatted:[],landedSubject:"",structurallyOk:false,packageFiles:{},landError:"refusing"});
console.log(s.safeGrade(json,{vars:{variant:"clean"}},c.default,s.SHARED_CHECKS))})'
=> { pass: true, score: 1, reason: "structural checks and grep floor passed" }
```

`evals/cases/spec-review.mjs`'s `clean` declares `gtdFiles: []` /
`otherFiles: "none"`, so a turn that leaves a scratch note under `.gtd/`,
matches no edge, gets its land refused, and produces **no reviewed output at
all** is reported as a clean pass. This violates the Task 4 criterion
"`safeGrade` reports a failing verdict with a reason from that JSON" — the
verdict is a pass, and the refusal message reaches no report.

**Fix:** add a `landError` check to `SHARED_CHECKS` in
`evals/asserts/shared.mjs` — fail with the refusal message whenever
`result.landError` is present, ahead of the file-list checks so the reason names
the refusal rather than a downstream symptom. It is case-independent, like the
other five.

## 2. Task 1 — `matchGtdFiles` throws on a malformed descriptor instead of returning a reason

The criterion is "returns `undefined` on a match and a reason string on a
mismatch — **it never throws**". Two reachable inputs throw:

- **Invalid `matching.pattern`.** `new RegExp(expected.matching.pattern)` in
  `evals/expect.mjs` is unguarded:
  `matchGtdFiles([".gtd/A.md"], {exact: [".gtd/A.md"], matching: {pattern: "[", count: 0}})`
  →
  `SyntaxError: Invalid regular expression: /[/: Unterminated character class`.
- **Non-array `exact`.**
  `matchGtdFiles([], {exact: ".gtd/A.md", matching: {pattern: "^.*$", count: 0}})`
  → `TypeError: expected.exact.filter is not a function`. The existing guard is
  `!expected.exact`, which a plain string passes.

Both are the crash class Task 4 exists to eliminate: nothing wraps `runChecks`,
and in `run-turn.mjs` `isStructurallyOk` a throw reaches `main().catch` →
`fail()` → **exit 1 with byte-empty stdout**, so a case-author typo kills a paid
trial with a stack trace instead of reporting a reason.

**Fix:** in `matchGtdFiles`, reject a non-array `exact` and a non-number
`matching.count` with a named reason, and compile the pattern inside a
`try`/`catch` that returns a reason naming the bad pattern. Keep it to the one
export — a helper used by one caller reds `deadcode`.
