# Update tests + README for the four-rule review base

Reflect the new four-rule review-base semantics (see `01-events-ts.md`) in the
unit tests, the integration feature, and the README.

## The four rules (summary)

1. Within a gtd process, after first build (no review yet) → whole task (from
   first `gtd: grilling` of the current cycle to HEAD).
2. Within a process, after feedback + more build → only changes since the last
   `gtd: awaiting review`.
3. Outside a process, feature branch → whole branch (merge-base to HEAD).
4. Outside a process, default branch → skip review (Idle; `reviewBase`/`refDiff`
   unset).

"Within a process" = a `gtd: grilling` commit exists after the last process
boundary (`gtd: done` / task start).

## Files

- `/Users/pmelab/.herdr/worktrees/gtd/issue-24-branch-review/src/Events.test.ts`
  — the `gatherEvents — review base (reviewBase / refDiff)` describe block
  (~lines 449+). Replace the merge-base-vs-deletion cases with cases covering
  the four rules.
- `/Users/pmelab/.herdr/worktrees/gtd/issue-24-branch-review/tests/integration/features/review.feature`
  — update the feature preamble (currently says "review base is the merge-base
  on a feature branch, or the last REVIEW.md deletion on the default branch")
  and add scenarios for the four rules.
- `/Users/pmelab/.herdr/worktrees/gtd/issue-24-branch-review/README.md` — update
  any prose describing how the review commit range / base is chosen.

## Acceptance criteria

- [ ] `Events.test.ts` review-base describe block covers all four rules:
  - [ ] within-process, first review → base = first `gtd: grilling`; refDiff
        spans the whole task.
  - [ ] within-process, incremental (after `gtd: awaiting review` + more
        commits) → base = last `gtd: awaiting review`; refDiff spans only the
        post-review changes.
  - [ ] outside-process feature branch → base = merge-base; refDiff spans the
        whole branch.
  - [ ] outside-process default branch → `reviewBase`/`refDiff` undefined.
- [ ] `review.feature` preamble updated + Cucumber scenarios added for the four
      rules, following repo conventions (composable, generic Given steps; expose
      real commit subjects/file content in scenario text; one commit per step).
- [ ] README prose matches the four rules; no stale "last REVIEW.md deletion"
      description of the base.
- [ ] `npm test` (or the project's unit + integration runners) passes.

## Constraints / edge cases

- Follow AGENTS.md testing conventions: reuse existing composable Given steps
  (e.g. "a commit \"...\" that adds \"...\"") rather than one-off setup; keep
  commit subjects visible in scenario text.
- Reuse existing step definitions where possible; only add new generic steps if
  none fit.
- File-disjoint: edit only the three files listed above. Do NOT edit
  `src/Events.ts` or `src/Git.ts` (tasks 01/02 own those).
- Do not commit anything. Leave changes uncommitted.
- Keep the CLAUDE.md rule in mind: every significant change reflected in README.
