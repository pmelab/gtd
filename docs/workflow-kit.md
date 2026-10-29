# Workflow kit

`@pmelab/gtd/workflow-kit` holds building blocks a workflow composes its phases
from. They are policy-free: every step name, prompt, path, skill list and
threshold arrives as an argument, so a workflow built on them inherits none of
another workflow's choices. Each one awaits steps, so call it from flow code
like any step (see [Configuration](./configuration.md#steps)).

The examples below import every name they use from `@pmelab/gtd/flows` and
`@pmelab/gtd/workflow-kit`; the imports are left out.

## Health

### `healthy(fix, health)`

Loops until the suite is green: runs `health.check()`, and on red runs `fix`.
After `fixCap` fixes, or when `compare` calls a red report `identical` to the
previous one, it escalates through `health.escalation` (unless `recheck`
passes). A round that reaches the cap while `compare` calls it `progress` earns
one extra fix.

```ts
const escalations = { rounds: 0 }
await healthy(
  () => agent("fix", "Fix what .gtd/FEEDBACK.md reports, then delete it."),
  {
    check: () => check("check", "npm test", ".gtd/FEEDBACK.md"),
    report: ".gtd/FEEDBACK.md",
    fixCap: 3,
    compare: async () => undefined,
    escalations,
    escalation: {
      limit: 2,
      describe: () =>
        agent("describe", "Explain the failure in .gtd/STUCK.md.", {
          file: ".gtd/STUCK.md",
        }),
      stop: () =>
        human("stuck", "Narrow the task in .gtd/STUCK.md, then land."),
      exhausted: () =>
        human("exhausted", "The fix budget is spent: take over, then land."),
    },
  },
)
```

### `escalation(count, steps)`

Hands a red suite to a person: runs `describe` then `stop`, counting the round
in `count.rounds`, or runs `exhausted` once `limit` rounds are spent. `healthy`
calls it; call it yourself to escalate from somewhere else in the same run of
red checks, sharing `count`.

```ts
const count = { rounds: 0 }
await escalation(count, {
  limit: 2,
  describe: () =>
    agent("describe", "Explain the failure in .gtd/STUCK.md.", {
      file: ".gtd/STUCK.md",
    }),
  stop: () => human("stuck", "Narrow the task in .gtd/STUCK.md, then land."),
  exhausted: () => human("exhausted", "Take over, then land."),
})
```

### `untilSettled(check, pending)`

Runs `check` again while `pending()` holds — such a run does not count — and
resolves the first run that does.

```ts
const green = await untilSettled(
  () => check("suite", "npm test", ".gtd/FEEDBACK.md"),
  () => read(".gtd/RETRY") !== undefined,
)
```

### `gate(name, passes, blocked)`

Holds the process in scope `name` until `passes()` resolves `true`, resting at
`blocked()` between tries.

```ts
await gate(
  "deps",
  async () => read("package-lock.json") !== undefined,
  () =>
    human(
      "install",
      "Run npm install and commit package-lock.json, then land.",
    ),
)
```

## Quality lenses

A lens list is a comma-separated setting, each entry `<lens>` or
`<lens>=<model>`.

### `lensEntriesOf(value)`, `lensesOf(value)`, `lensOf(entry)`

```ts
lensEntriesOf(" correctness, security=opus ,") // ["correctness", "security=opus"]
lensesOf("correctness, security=opus") // ["correctness", "security"]
lensOf("security=opus") // { lens: "security", model: "opus" }
```

### `lensScopes(scope, lenses, entry)`

One `<scope>.<lens>` entry per lens — the per-lens part of a workflow's `skills`
or `access` option.

```ts
const skills = lensScopes("quality", ["correctness", "security"], (lens) => [
  lens,
])
// { "quality.correctness": ["correctness"], "quality.security": ["security"] }
```

### `qualityLap(lenses, review, findings)`

One `review(lens)` turn per lens, each appending to `findings`; resolves
`"findings"` when that file has any, else `"clean"`.

```ts
const outcome = await qualityLap(
  lensesOf(settings.qualityReviews ?? ""),
  (lens) =>
    scope("quality", () =>
      scope({ name: lens, skills: [lens] }, () =>
        agent(
          "review",
          `Review the change as ${lens}; append findings to .gtd/FINDINGS.md.`,
          {
            allowEmpty: true,
          },
        ),
      ),
    ),
  ".gtd/FINDINGS.md",
)
```

### `fixFindings(f)`

Runs `f.fix` until `f.findings` is gone, at most `f.cap` turns; then runs
`f.escalate`. Resolves `true` when the findings were fixed.

```ts
const fixed = await fixFindings({
  fix: () =>
    agent("fix", "Resolve .gtd/FINDINGS.md, then delete it.", {
      file: ".gtd/FINDINGS.md",
      mode: "findings",
    }),
  findings: ".gtd/FINDINGS.md",
  cap: 2,
  escalate: () =>
    human("findings-stuck", "Resolve .gtd/FINDINGS.md yourself, then land."),
})
```

## Scenarios

### `assertionLines(source)`

The `Then` step lines of a `.feature` file (an `And`/`But`/`*` continuing one
included, doc strings skipped), each with the scenario it sits in.

```ts
const lines = assertionLines(read("features/login.feature") ?? "")
// [{ scenario: "Scenario: a user logs in", line: "Then the dashboard shows" }, …]
```

### `removedAssertions(changes)`

The assertions each changed `.feature` file lost — the one way rewording a
scenario can weaken it.

```ts
const weakened = removedAssertions(changes("**/*.feature"))
if (weakened.length > 0) {
  refuse(`gtd land: ${weakened.map((r) => r.path).join(", ")} lost assertions`)
}
```

## Review rounds

### `review(base, policy)`

A reviewer writes the review file over everything since `base`, a person reviews
it, and each note is judged: edits go to another lap, questions are answered in
place, nits are fixed in one batch, praise is dropped. Resolves
`{ verdict: "signoff" }`, or
`{ verdict: "feedback", base, restoreFrom, edited }` for the caller to re-plan
from.

```ts
const policy: ReviewPolicy = {
  file: ".gtd/REVIEW.md",
  feedback: ".gtd/FEEDBACK.md",
  isCode: (path) => !path.startsWith(".gtd/"),
  reviewing: (base) =>
    agent("reviewing", `Write .gtd/REVIEW.md over everything since ${base}.`, {
      file: ".gtd/REVIEW.md",
      mode: "review",
    }),
  fixRisks: () => agent("risks", "Fix the risks .gtd/REVIEW.md marks."),
  keepGreen: async () => {
    await check("green", "npm test", ".gtd/FEEDBACK.md")
  },
  awaitReview: () =>
    human("review-gate", "Review .gtd/REVIEW.md, then land.", {
      file: ".gtd/REVIEW.md",
      mode: "review",
    }),
  reviewMissing: () => agent("rewrite", "Write .gtd/REVIEW.md again."),
  collecting: (capture) => agent("collect", capture, { allowEmpty: true }),
  triage: async () => new Map(),
  answerQuestions: () =>
    agent("answer", "Answer the questions in .gtd/REVIEW.md."),
  fixNits: () => agent("nits", "Fix the nits in .gtd/REVIEW.md."),
  close: () => run("close", removeScript([".gtd/REVIEW.md"])),
  captures: {
    edits: (round) =>
      `Fold the hand-edits since ${round} into .gtd/FEEDBACK.md.`,
    notes: (round) => `Fold the notes of ${round} into .gtd/FEEDBACK.md.`,
    editNotes: (round) =>
      `Fold the edit notes of ${round} into .gtd/FEEDBACK.md.`,
  },
  refusals: {
    deleted: "gtd land: keep .gtd/REVIEW.md — sign off by changing nothing.",
    unmatched: "gtd land: write .gtd/FEEDBACK.md, or change nothing.",
  },
}
const outcome = await review(start(), policy)
```

`ReviewPolicy` is one interface of many members, optional hooks (`decided`,
`settles`, `learn`, `pending`, `refusals.dropped`) among them. It stays one
interface: splitting it would change the type every workflow passing one names.

### `reviewToHandOff(base, policy)`

The same review round, without judging: no note signs off and closes, any note
ends the round with the review left in place for another workflow to act on,
through `policy.handOff`.

```ts
await reviewToHandOff(start(), {
  ...policy,
  handOff: () => run("hand-off", moveScript(".gtd/REVIEW.md", ".gtd/NOTES.md")),
  deleted: "gtd land: keep .gtd/REVIEW.md — sign off by changing nothing.",
  threadsPending: "gtd land: answer every thread in .gtd/REVIEW.md first.",
  unparsed: "gtd land: write your notes as review notes in .gtd/REVIEW.md.",
})
```
