# Land `each:` — resolve the main conflict and the three P1 review findings

PR #248 — loop a machine reference over a list with `each:` — cannot merge:
GitHub reports `CONFLICTING` / `DIRTY` against `main`, and Greptile's review of
`1cc43fad` scored it 1/5 with three P1 findings, one of them a security finding.
Both have to close before this lands.

## Open Questions

### Does `each:` guarantee that a snapshotted item value is safe to interpolate into a `script:`?

- [ ] Yes — the engine makes it safe. Snapshot-time filtering or render-time
      shell-quoting, so a workflow author writing `pkg="<%= it.item %>"` can
      never be made to execute a filename. Matches the promise the PR body
      already makes for `var:` lists ("never reach a shell")
- [ ] No — it is the author's job. Fix only the two bundled call sites in
      `unified.yaml`, and document in `docs/` that an item value is untrusted
      text that a `script:` must quote itself
- [ ] _your answer_

### Should a process be allowed to start inside an `each:` loop?

- [ ] No — refuse it at load time, the way manual entry (`gtd --entry`) already
      refuses any state inside an `each:` subtree. A new validation error; it
      would reject a workflow that happens to be authored that way today
- [ ] Yes — support it. The initial state resolves qualified at index `0` with a
      snapshot taken, exactly as a transition into the reference does
- [ ] _your answer_

## Concerns

### 1. The branch conflicts with `main` in `tests/tooling/support/run-in-pty.py`

TECHNICAL. One file conflicts; `README.md` auto-merges and nothing else does.
`main` is two commits ahead (`6e901572` a release bump, `a26381d8` a web-UI
change); the merge base is `63a57f36`.

The conflict is not a real disagreement. This branch widened the post-exit drain
timeout from `0.5s` to `2.0s`. `main` deleted the whole poll-then-drain shape it
widened, replacing it with a read-straight-to-EOF loop plus a 10s watchdog
thread that kills a wedged child — it removes the same flake by construction
rather than by a bigger timeout.

Take `main`'s version of the file whole. Keep no trace of the `2.0s` bump; the
code it edits no longer exists.

### 2. A package filename can execute shell code (Greptile P1, security)

TECHNICAL, pending the product answer above. `packages.scoping` and
`packages.closing` in `src/workflows/unified.yaml` both render
`pkg="<%= it.item %>"`. `it.item` comes from the working-tree glob
`.gtd/packages/*.md`, unfiltered. Double quotes stop word-splitting; they do not
stop `$(...)`, a backtick, or `$var`. A file named
`.gtd/packages/01-$(touch marker).md` runs its own name.

Scope depends on the answer above: either the engine is hardened once for every
workflow, or only these two call sites are.

### 3. Entering an `each:` reference as the workflow's initial state leaves `it.item` empty (Greptile P1)

TECHNICAL, pending the product answer above. `initialStateOf` returns
`def.entries.default` verbatim — no qualifier, no snapshot. Item qualification
happens only inside `qualifyLoopTarget`, which only a transition reaches. So if
`entries.default` names a state inside an `each:` subtree, the first prompt or
script runs with `it.item` empty.

`resolveState` widens the blast radius: any unrecognised commit subject falls
back to `initialStateOf`, so this is not only a cold start.

Not reachable in the bundled workflow, whose default entry is `idle`. Manual
entry is already guarded (`isInsideEachRef`); `entries.default` is the one
unguarded door.

### 4. An empty second loop makes the first loop skip its remaining items (Greptile P1)

TECHNICAL, and unambiguous — no product fork; loop A must always finish its
items.

Confirmed by reading `step`'s ordering. With loop A's `drained:` pointed at loop
B's reference and B's snapshotted list empty, `qualifyLoopTarget` runs first and
chains B through to B's own `drained:` target. `applyEachDrainAdvance` then runs
against that already-rewritten target and scans for
`baseTarget === ref.drained`. A's `drained:` is B's entry, not B's drained — no
ref matches, so A never advances. A ends after its first item and silently drops
the rest.

The fix must let A's advance check see A's configured `drained:` target before
B's empty-loop chaining rewrites it away. Note the existing comment in `step`
insisting `applyEachDrainAdvance` runs LAST so a `retry: otherwise:` landing on
a `drained:` target still obeys the advance rule — a reordering must not break
that, and both properties need a test that fails if either is lost.

### 5. Each fix needs a scenario, and the suite must stay green

TECHNICAL. Findings 2, 3 and 4 are each a behaviour this repo has no test for.
Per `AGENTS.md`: a cucumber scenario per feature, composable `Given` steps, real
file content in scenario text. Finding 4 in particular needs a two-loop-in-
sequence scenario with an empty second list — the exact shape
`qualifyLoopTarget`'s own doc comment describes but nothing exercises.

### 6. Re-request Greptile after the fixes

TECHNICAL. Greptile's confidence score is 1/5 and its verdict reads "not safe to
merge". Its last-reviewed commit is `1cc43fad`. Nothing lands until it has
re-reviewed the fixed head.

## Answered Questions

### Should the branch be rebased onto `main` or merged from it?

Merge `main` in. Rebasing rewrites `1cc43fad`, and this repo's own `gtd` process
commits sit on top of it and reference it by hash.

### Does resolving the conflict lose the flake fix this branch made?

No. `main`'s read-to-EOF loop plus watchdog removes the truncated-output race by
construction; a wider drain timeout was the weaker form of the same fix.

### Is finding 4 a bug or intended "escalation ends the queue" behaviour?

A bug. The PR's own design says leaving an item's subtree for anything other
than `drained:` ends the loop — here the exit IS via `drained:`, so the loop is
meant to continue.
