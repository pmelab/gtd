# Land `each:` — resolve the main conflict and the three P1 review findings

Four packages, in order: merge `main` in, quote the two bundled `each:` call
sites, fix both engine findings in `src/PatternMachine.ts`, then land with the
right footer and a clean Greptile re-review.

## Open Questions

### Should the new load-time refusal also cover `entries.manual`, or only `entries.default`?

- [ ] Only `entries.default` — exactly what concern 3 settled; a manual entry
      inside an `each:` subtree keeps its current silent behaviour
      (`manualEntryStates` withholds it from `gtd --entry`'s offer list, and the
      workflow still loads)
- [ ] Both — `validateEntries` rejects `entries.default` AND any
      `entries.manual` state inside an `each:` subtree, so a workflow can never
      declare an entry point that `gtd --entry` will refuse at runtime; widens
      the breaking change to a second class of workflow
- [ ] _your answer_

### What Greptile verdict is good enough to land?

- [ ] Every P1 gone — P2/P3 findings are noted in the PR and land unaddressed;
      concern 7 only asks that Greptile has re-reviewed the fixed head
- [ ] A confidence score of 4/5 or better AND no P1 — a re-review that still
      reads "not safe to merge" blocks the land regardless of finding severity
- [ ] _your answer_

## 1. Merge `main` into the branch

Primary paths: `tests/tooling/support/run-in-pty.py`, `README.md`.

`git merge origin/main` (currently `d6720aa8`, three commits ahead of the merge
base `63a57f36`: `6e901572` and `d6720aa8` release bumps, `a26381d8` a web-UI
change). Merge, never rebase — this repo's own `gtd` process commits sit on top
of `1cc43fad` and reference it by hash.

Resolve `tests/tooling/support/run-in-pty.py` with `git checkout --theirs`
(`main`'s version whole). The `0.5s` → `2.0s` post-exit drain widening this
branch made edits a poll-then-drain shape `main` deleted outright, replacing it
with a read-to-EOF loop plus a 10s watchdog thread that kills a wedged child.
Keep no trace of the `2.0s` bump. `README.md` auto-merges; nothing else
conflicts.

Verify the merge commit with a full `npm test` before the next package starts —
Turborepo caches per task, so a `main`-side change to a `test:unit` or e2e input
re-runs only what it touched.

## 2. Single-quote the bundled `each:` item interpolation, and document the rule

Primary paths: `src/workflows/unified.yaml` (lines 1710 and 1907),
`docs/configuration.md`, one cucumber feature.

Two call sites, `packages.scoping` and `packages.closing`, render
`pkg="<%= it.item %>"`. `it.item` comes from the working-tree glob
`.gtd/packages/*.md`, unfiltered. Double quotes stop word-splitting; they do not
stop `$(...)`, a backtick, or `$var`. `.gtd/packages/01-$(touch marker).md`
executes its own name.

**Change both to `pkg='<%= it.item %>'`.** Single quotes disable `$(...)`,
backticks and `$var` outright. The only break-out character — a literal `'` —
can never reach the rendered script: Eta's default autoescape turns it into
`&#39;` first. Nothing in `src/PatternTemplates.ts` changes; nothing filters at
snapshot time. Shell safety is the workflow author's job, and only the two
bundled authors are at fault here.

Accepted limit: a package filename containing `'`, `"` or `&` renders mangled
into HTML entities, so `[ -f "$pkg" ]` misses it and `closing`'s `rm -f "$pkg"`
silently removes nothing. That mangling exists today under double quotes;
single-quoting neither creates nor worsens it, and no package file gtd writes
has ever carried one of those characters. Do not add a guard for it.

Document the rule on `docs/configuration.md`'s `it.item` bullet (around line
214), beside the `var:` line that already says a `var:` value never reaches a
shell: an `each:` item value is untrusted text, and a `script:` interpolating
one is responsible for quoting it. State what a workflow author must do — never
how the renderer escapes. `docs/**` is already declared in `test:unit`'s and
both e2e tasks' `inputs`, so no `turbo.json` edit follows from touching it.

Scenario: a package file whose name carries `$(touch marker)`, run through the
bundled `packages` loop, asserting the `marker` file never appears. Composable
`Given` steps with the literal filename in the scenario text.

## 3. Refuse an `each:` default entry, and let loop A advance past an empty loop B

Primary paths: `src/PatternMachine.ts`, `src/PatternMachine.test.ts`,
`tests/integration/features/each-loop.feature` (plus one load-error feature).

Both findings live in one file and one decision path. They ship together.

### 3a. `entries.default` inside an `each:` subtree is a load error

`initialStateOf` returns `def.entries.default` verbatim — no qualifier, no
snapshot. Item qualification happens only inside `qualifyLoopTarget`, which only
a transition reaches. A default entry inside an `each:` subtree therefore runs
its first prompt or script with `it.item` empty. `resolveState` widens this past
cold start: any unrecognised commit subject falls back to `initialStateOf`.

Add the rule to `validateEntries`, reusing the already-exported
`isInEachSubtree` predicate that `manualEntryStates` uses to guard
`gtd --entry`. Both doors then agree, and `resolveState`'s fallback becomes safe
for free — a default entry that can never sit inside a loop can never land there
unqualified.

Error string: name the state, name the rule, and name the fix, because
`validateReachability` only runs when entries validate clean — a workflow
tripping this rule stops reporting reachability errors in the same run, so this
one line is all the author gets. Write it as
`entries.default "<state>" is inside an each: reference — a process may not start inside a loop`.
Assert the exact text in a unit test.

Breaking: a workflow authored this way loads today. Not reachable in the bundled
workflow, whose default entry is `idle`.

Scenario: a workflow whose `entries.default` sits inside an `each:` subtree,
with the YAML inline in the scenario text, asserting `gtd` fails to load and
prints that named error.

### 3b. An empty second loop must not make the first loop skip its items

With loop A's `drained:` pointed at loop B's reference and B's snapshotted list
empty, `qualifyLoopTarget` runs first and chains B through to B's own `drained:`
target. `applyEachDrainAdvance` then runs against that already-rewritten target
and scans for `baseTarget === ref.drained`. A's `drained:` is B's entry, not B's
drained — no ref matches, so A never advances. A ends after its first item and
silently drops the rest.

**Fix by carrying the pre-chain target out of `qualifyLoopTarget`, not by
reordering `step`.** `qualifyLoopTarget` already recurses on `ref.drained` when
a snapshotted list is empty; have it also return the target it was asked to
qualify before that chaining rewrote it. Thread that value through `applyRetry`
the same way `enteredEachRef` is already threaded, and have
`applyEachDrainAdvance` match `ref.drained` against both the resolved target and
that pre-chain target, advancing on either.

`applyEachDrainAdvance` still runs LAST. The existing comment in `step`
insisting on that ordering is load-bearing — a `retry: otherwise:` target that
happens to BE a `drained:` target must obey the same advance-or-end rule an
ordinary edge would. A reordering would break it; threading an extra value does
not.

Two unit tests, each failing if its property is lost: loop A with a non-empty
list advances to its next item when its `drained:` names an empty loop B, and a
`retry: otherwise:` landing on a `drained:` target still advances.

Scenario: two loops in sequence, A's `drained:` naming B's reference, B's glob
matching nothing, asserting A builds every one of its items. This is the exact
shape `qualifyLoopTarget`'s own doc comment describes and nothing exercises.

### Test-suite obligations for this package

Extend `tests/integration/features/each-loop.feature` for 3b — it already sets
up the two-package `glob:` loop these scenarios need. Put 3a's load error in its
own scenario beside the existing config-error features; a load failure is not an
`each:` behaviour.

Add no new `npm test` task. Adding one means all three of a `package.json`
script, a `turbo.json` task with an explicit `inputs` array, and the task name
in the `test` script's list, or `tests/tooling/turbo.test.ts` fails.

## 4. Land with a breaking-change footer and a clean Greptile re-review

Primary paths: the landing commit message; no source file.

The landing commit needs a literal `BREAKING CHANGE` footer naming BOTH breaks —
semantic-release in this repo reads the footer, not the `!` in the type:

- the state re-homing `packages.item.building` → `packages.building` the PR body
  already documents, and
- package 3a's new load error rejecting a workflow whose `entries.default` sits
  inside an `each:` subtree.

Then re-request Greptile. Its last-reviewed commit is `1cc43fad`, its confidence
score is 1/5, and its verdict reads "not safe to merge". Nothing lands until it
has re-reviewed the fixed head.

Risk: merging `main` again between package 1 and this one moves the head
Greptile reviewed. Re-request after the final merge, not before.

## Merged Concerns

### Concerns 3, 4 and 5 → package 3

Concerns 3 and 4 are two fixes in `src/PatternMachine.ts`, both on `step`'s own
target-resolution path; concern 5 is their test obligation plus package 2's.
Merged because the footprints coincide, not because the fixes depend on each
other. Package 2 carries concern 5's finding-2 scenario in its own spec.

> ### 3. Entering an `each:` reference as the workflow's initial state leaves `it.item` empty (Greptile P1)
>
> TECHNICAL. `initialStateOf` returns `def.entries.default` verbatim — no
> qualifier, no snapshot. Item qualification happens only inside
> `qualifyLoopTarget`, which only a transition reaches. So if `entries.default`
> names a state inside an `each:` subtree, the first prompt or script runs with
> `it.item` empty.
>
> `resolveState` widens the blast radius: any unrecognised commit subject falls
> back to `initialStateOf`, so this is not only a cold start.
>
> Refuse it at load time rather than supporting it. A process may not start
> inside an `each:` loop, exactly as manual entry (`gtd --entry`) already
> refuses any state inside an `each:` subtree. Add the rule to
> `validateEntries`, reusing the same `isInsideEachRef` predicate that guards
> manual entry, so the two doors agree. `resolveState`'s fallback then becomes
> safe for free — a default entry that can never sit inside a loop can never
> land there unqualified.
>
> Not reachable in the bundled workflow, whose default entry is `idle`.
>
> Risk: this is a new load error that rejects a workflow which loads today.
> `validateReachability` only runs when entries validate clean, so a workflow
> tripping the new rule will also stop reporting reachability errors in the same
> run — check that the error message alone is enough to act on.

> ### 4. An empty second loop makes the first loop skip its remaining items (Greptile P1)
>
> TECHNICAL, and unambiguous — no product fork; loop A must always finish its
> items.
>
> Confirmed by reading `step`'s ordering. With loop A's `drained:` pointed at
> loop B's reference and B's snapshotted list empty, `qualifyLoopTarget` runs
> first and chains B through to B's own `drained:` target.
> `applyEachDrainAdvance` then runs against that already-rewritten target and
> scans for `baseTarget === ref.drained`. A's `drained:` is B's entry, not B's
> drained — no ref matches, so A never advances. A ends after its first item and
> silently drops the rest.
>
> The fix must let A's advance check see A's configured `drained:` target before
> B's empty-loop chaining rewrites it away. Note the existing comment in `step`
> insisting `applyEachDrainAdvance` runs LAST so a `retry: otherwise:` landing
> on a `drained:` target still obeys the advance rule — a reordering must not
> break that, and both properties need a test that fails if either is lost.

> ### 5. Each fix needs a scenario, and the suite must stay green
>
> TECHNICAL. Findings 2, 3 and 4 are each a behaviour this repo has no test for.
> Per `AGENTS.md`: a cucumber scenario per feature, composable `Given` steps,
> real file content in scenario text.
>
> Finding 2 wants a package file whose name carries `$(...)`, proving the marker
> it would create never appears. Finding 3 wants a workflow whose
> `entries.default` sits inside an `each:` subtree, proving it fails to load
> with a named error. Finding 4 wants a two-loop-in-sequence scenario with an
> empty second list — the exact shape `qualifyLoopTarget`'s own doc comment
> describes but nothing exercises.
>
> Adding no new `npm test` task means no `turbo.json` edit; adding one means all
> three of a `package.json` script, a `turbo.json` task with explicit `inputs`,
> and the task name in the `test` list, or `tests/tooling/turbo.test.ts` fails.

### Concerns 6 and 7 → package 4

Both are landing steps with no source-file footprint: the commit message's
footer, and the review that must clear before that commit merges.

> ### 6. The release footer must carry the new breaking change
>
> TECHNICAL. Concern 3 adds a load error that rejects a previously-valid
> workflow — a second breaking change on top of the state re-homing
> (`packages.item.building` → `packages.building`) the PR body already
> documents. semantic-release in this repo reads a literal `BREAKING CHANGE`
> footer, not the `!` in the type; make sure the landing commit carries one
> naming both breaks.

> ### 7. Re-request Greptile after the fixes
>
> TECHNICAL. Greptile's confidence score is 1/5 and its verdict reads "not safe
> to merge". Its last-reviewed commit is `1cc43fad`. Nothing lands until it has
> re-reviewed the fixed head.

## Answered Questions

### How should loop A's advance survive loop B's empty-list chaining?

Thread the pre-chain target out of `qualifyLoopTarget` and match
`applyEachDrainAdvance` against it as well as the resolved target. Reordering
`step` would break the `retry: otherwise:` property its own comment protects.

### Where does the untrusted-item rule go in `docs/`?

`docs/configuration.md`'s `it.item` bullet, beside the `var:` line that already
states a `var:` value never reaches a shell — the same place a workflow author
reads to learn what `it.item` holds.

### Do the new scenarios go in `each-loop.feature` or new feature files?

3b extends `each-loop.feature`, which already builds the two-package `glob:`
loop it needs; 3a gets its own scenario beside the existing config-error
features, because a load failure is not an `each:` behaviour.

### Does the predicate need a new name to match the requirement's `isInsideEachRef`?

No. The repo exports it as `isInEachSubtree`; reuse that. The requirement named
the concept, not the symbol.

### Does resolving the conflict lose the flake fix this branch made?

No. `main`'s read-to-EOF loop plus watchdog removes the truncated-output race by
construction; a wider drain timeout was the weaker form of the same fix.

### Should the branch be rebased onto `main` or merged from it?

Merge `main` in. Rebasing rewrites `1cc43fad`, and this repo's own `gtd` process
commits sit on top of it and reference it by hash.

### Does `each:` guarantee that a snapshotted item value is safe to interpolate into a `script:`?

No — it is the author's job. Fix only the two bundled call sites in
`unified.yaml` and document in `docs/` that an item value is untrusted text a
`script:` must quote itself.

### Should a process be allowed to start inside an `each:` loop?

No — refuse it at load time, the way manual entry (`gtd --entry`) already
refuses any state inside an `each:` subtree, accepting that this rejects a
workflow authored that way today.

### Is finding 4 a bug or intended "escalation ends the queue" behaviour?

A bug. The PR's own design says leaving an item's subtree for anything other
than `drained:` ends the loop — here the exit IS via `drained:`, so the loop is
meant to continue.
