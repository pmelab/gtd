# Task: Build the pure xstate machine core

Create `src/Machine.ts` — the event-sourced state machine used as a **pure
fold**, plus the typed event/context model it folds over. This is self-contained
and must be unit-testable in complete isolation (no git, no filesystem).

## What to build

1. **Add `xstate` (^5) to `package.json` dependencies and install it** (run the
   project's install command so `npm test`/`typecheck` resolve the import).

2. **Event types** (exported):
   - `COMMIT` — `{ type: "COMMIT"; isFixGtd: boolean }`. Only a binary
     `fix(gtd):`-or-not distinction is needed (subject parsing happens at the
     edge, not here).
   - `RESOLVE` — `{ type: "RESOLVE"; payload: ResolvePayload }` where
     `ResolvePayload` carries the terminal working-tree facts the guards branch
     on: `reviewModified` (REVIEW.md exists with edits), `codeDirty` (any
     non-`TODO.md` uncommitted change), `hasPackages`, `gtdDirExists`,
     `todoDirty` ("new" | "modified" | null), `todoFinalized`, `todoSimple`,
     `reviewBasePresent` + non-empty `refDiff`, plus passthrough context
     (`lastCommitSubject`, `workingTreeClean`, `packages`, `diff`, `baseRef`,
     `refDiff`).

3. **Context type** carrying everything `Prompt` needs:
   `verifyIterations`, `maxVerifyIterations`, `lastCommitSubject`,
   `workingTreeClean`, `packages`, `diff`, `baseRef`, `refDiff`.
   Export `MAX_VERIFY_ITERATIONS = 5` as a hardcoded constant (no AGENTS.md
   parsing — see plan). `maxVerifyIterations` initializes from it.

4. **Leaf-state id union** (exported), the final states only:
   `review-process | code-changes | execute | cleanup | decompose |
   execute-simple | escalate | new-todo | modified-todo | human-review |
   verified`. (No `verify`, `todo-markers`, or `review-create`.)

5. **Machine** via `setup({ types, guards, actions }).createMachine`:
   - Initial state `replaying`.
   - On `COMMIT` (self-transition): action updates the counter —
     `isFixGtd` ⇒ `verifyIterations++`, else `verifyIterations = 0`. This yields
     the trailing run of `fix(gtd):` commits at HEAD.
   - On `RESOLVE`: guarded transitions to exactly one leaf, in this **priority
     order** (first match wins):
     1. `reviewModified` → `review-process`
     2. `codeDirty` → `code-changes`
     3. `hasPackages` → `execute`
     4. `gtdDirExists` (empty `.gtd`) → `cleanup`
     5. `todoFinalized` (committed, not dirty) → `execute-simple` if `todoSimple`
        else `decompose`
     6. `verifyIterations >= maxVerifyIterations` → `escalate`
     7. `todoDirty === "new"` → `new-todo`; `todoDirty === "modified"` →
        `modified-todo`
     8. else `reviewBasePresent && refDiff` non-empty → `human-review`; else
        → `verified`
   - **Tags** (`tags: ["auto-advance"]`) on: `review-process`, `code-changes`,
     `execute`, `cleanup`, `decompose`, `execute-simple`, `new-todo`,
     `modified-todo`. **Not** tagged: `human-review`, `verified`, `escalate`.

6. **Pure `resolve(events) → { value, context, autoAdvance }`**: create the
   actor (`createActor`), send the events in order, read `snapshot.value`,
   `snapshot.context`, and `snapshot.hasTag("auto-advance")`. No
   `invoke`/actors/delays/async.

## Acceptance criteria

- [ ] `xstate` ^5 in `package.json` and installed
- [ ] `src/Machine.ts` exports the event types, context type, leaf-id union,
      `MAX_VERIFY_ITERATIONS`, the machine, and `resolve(events)`
- [ ] `resolve` is synchronous and pure (no IO)
- [ ] Priority order and tag set match the list above exactly
- [ ] `npm run typecheck` passes

## Files

- `src/Machine.ts` (new)
- `package.json` (add dependency)
- Reference for behavior parity: `src/State.ts` (current `detect()` decision
  tree, lines 238–284), `src/Prompt.ts` (`AUTO_ADVANCE_BRANCHES`, lines 76–87)

## Constraints

- The machine MUST be pure and isolated — no `GitService`/`FileSystem` imports.
- `maxVerifyIterations` is hardcoded 5; do not add AGENTS.md parsing.
