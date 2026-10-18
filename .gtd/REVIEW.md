# Review: 1d97e42

<!-- base: 08eaee961b25a96b9d39f6286a03704ad9bd4310 -->

**Fix: a build turn that creates a test marked `(unchanged)` is now refused.**
Before, a marker on a not-yet-existing test let the builder write it fresh and
pass — the added file satisfied the "exists in tree" check. No risks found.

## Scenarios

- [ ] ./tests/integration/features/declared-tests.feature#354-371 — **A build
      turn that adds a file under an `(unchanged)` line fails `gtd land`**,
      naming the file and telling the agent to stop and leave it to a person.

## Guard: refuse an added marked test

The declared-tests guard grows an `addedMarked` bucket, build turn only; fix
turns still pass. Duplicate `## Tests` lines now report a path once.

- [ ] ./src/workflows/feature/packages.ts#60-76 — new `addedMarked` bucket;
      build turn sorts a marked test's diff status into modified/added, fix turn
      ignores it as before.
- [ ] ./src/workflows/feature/packages.ts#91-134 — JSDoc updated; `seen` set
      dedupes repeated paths; new refusal group sits between "revert" and
      "restore". Message gives no repair step on purpose: the package text is
      read as of `since`, so the only way out is a person (`gtd abandon`).
      [^turn-default]
- [ ] ./src/workflows/feature/packages.test.ts#286-358 — added-marked refusal
      (never phrased as revert/delete/restore), fix-turn exemption, unmarked
      entry winning over a marked duplicate, single listing of duplicated lines,
      and the extended group order.

## Builder prompt and user docs

Prompt and README now say a marked test must exist **before** the turn and that
creating, editing or deleting it refuses the turn.

- [ ] ./src/workflows/shared/text.ts#433-440 — build prompt: if the marked test
      does not exist yet, stop without creating it.
- [ ] ./src/workflows/shared/text.test.ts#1305-1311 — pins the new prompt
      phrases.
- [ ] ./README.md#421-436 — workflow step 3: marker must pre-exist; wrong marker
      is fixed in the plan; a stuck process ends with `gtd abandon`.
- [ ] ./tests/integration/features/declared-tests.feature#4-8 — feature
      description reworded. Nit: line 8 now runs past the 80-column wrap of the
      surrounding prose.

[^turn-default]:
    `requireDeclaredTests` still declares `turn: DeclaredTestsTurn = "fix"`
    (line ~101). The requirement was to make `turn` required with no default;
    drop the default so every caller must name it.
