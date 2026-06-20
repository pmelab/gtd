# Add human-review / verified branches and wire inference

Add the two new terminal branches to the `Branch` union and route the clean-tree
"verify" path so that it advances into `human-review` (when there is an
un-reviewed base with a non-empty diff) or terminates at `verified`.

DEPENDS ON task 01 (`computeReviewBase`) in this package. Coordinate: if done in
parallel, agree the `computeReviewBase` signature first.

## Files

- `src/State.ts`

## Changes

### Branch union

Add `"human-review"` and `"verified"` to the `Branch` type union (alongside the
existing `"verify"`). Do NOT remove `"verify"`.

### Inference (the `else { branches.push("verify") }` arm, ~line 199-201)

Today the clean-tree, no-packages, no-`.gtd/`, no-finalized-`TODO.md` path
unconditionally pushes `"verify"`. Replace that single push with this logic:

1. Compute `const base = yield* computeReviewBase(git)`.
2. If `base` is `Option.none()` → keep current behaviour: push `"verify"` is NO
   longer the terminal here. Re-read the sequencing note in `TODO.md`:
   - `verify` runs the tests and auto-advances on green (handled by the prompt +
     `AUTO_ADVANCE_BRANCHES` in package 03).
   - On the FOLLOW-UP run (tests already green, tree still clean), inference
     must route to `human-review` or `verified`.

   Since "tests are green" is not git-observable, distinguish the two runs by
   the presence of a resolvable, non-empty review base:
   - If `base` is `some(hash)` AND `git diff hash HEAD` is non-empty → push
     `"human-review"`, and set `baseRef = hash` and
     `refDiff = yield* git.diffRef(hash)` on the returned state (reuse the
     existing `baseRef`/`refDiff` plumbing — same fields the `review-create`
     manual path populates).
   - Else (no base, or base == HEAD / empty diff) → the run is either
     pre-tests-green or fully reviewed. Emit BOTH the test-running step and the
     terminal: push `"verify"` so tests run AND auto-advance; the next run with
     no new base yields `"verified"`.

   IMPORTANT — avoid an infinite loop and avoid emitting `verify` forever:
   resolve the intended semantics precisely against `TODO.md` §3 and the "base
   == HEAD → verified" answer:
   - base present + non-empty diff → `["human-review"]` (terminal, STOP).
   - no base / base == HEAD → `["verified"]` (terminal: run tests once, STOP).
   - `verify` remains the step that runs tests and auto-advances; it is emitted
     when there is pending un-reviewed work to push the workflow forward, but
     the terminal states (`human-review`, `verified`) are what the user lands
     on.

   Implement the simplest correct mapping consistent with the feature scenarios
   in package 04:
   - Resolvable base with non-empty diff → `human-review`.
   - Otherwise → `verified`. (If the planner intended `verify` to still appear
     as a distinct first step, keep `verify` reachable only while there is
     un-reviewed work AND tests have not been confirmed — but since that is not
     git-observable, the scenarios in package 04 drive `human-review` /
     `verified` directly. Match those scenarios; do not invent extra states.)

### State fields

`human-review` returns a `State` with `branches: ["human-review"]`, plus
`baseRef` and `refDiff` populated so `Prompt.ts`'s existing `refDiff` context
block renders the diff. `verified` returns `branches: ["verified"]` with no
`baseRef`/`refDiff`.

### Leave untouched

- The `refArg` manual review path (`detect(refArg)`).
- The `REVIEW.md` / `review-process` branch.
- All other clean-tree arms (`execute`, `cleanup`, `decompose`,
  `execute-simple`).

## Constraints

- Reuse `git.diffRef` and the `baseRef`/`refDiff` fields already on `State`.
- Do not parse `lastCommitSubject` for inference; keep it informational only.
- Type the returned objects with `satisfies State` as the surrounding code does.

## Acceptance criteria

- [ ] `Branch` union includes `"human-review"` and `"verified"` and still
      includes `"verify"`.
- [ ] Clean tree + resolvable base + non-empty `base..HEAD` diff →
      `branches: ["human-review"]` with `baseRef` and `refDiff` set.
- [ ] Clean tree + no resolvable base (e.g. no remote, no prior review) →
      `branches: ["verified"]`.
- [ ] Clean tree + base == HEAD (empty diff) → `branches: ["verified"]` (no
      `human-review`, no loop).
- [ ] Manual `gtd <ref>` and `REVIEW.md` paths unchanged.
- [ ] `npm run typecheck` passes (note: `Prompt.ts` `SECTIONS` map will not
      typecheck until package 03 adds the new keys — coordinate package
      sequencing; this package may temporarily leave `SECTIONS` exhaustiveness
      failing, which package 03 resolves. If you want this package to typecheck
      standalone, add placeholder entries to `SECTIONS` here and let package 03
      replace them with real prompts.)
