# Part B — machine: intent descriptors + generalized commit action

Part B moves the post-agent `git commit` out of the agent prompts and into the
NEXT cycle's edge as another `commitPending`-shaped `EdgeAction`. The agent
leaves output uncommitted (plus an explicit intent descriptor); the next edge
detects the dirty tree + intent and the machine emits a disambiguated commit
action. This task owns the MACHINE side: the intent-descriptor fold, the
extended commit `EdgeAction`, and the guard-ordering reconciliation with
`code-changes`/`execute`.

## Files (this task)

- `src/Machine.ts`
- `src/Machine.test.ts`

> File-disjoint from sibling tasks `02-git-commit-messages.md`
> (`Git.ts`/`Git.test.ts`) and `03-driver-and-prompt-wiring.md`
> (`main.ts` + prompt `.md`s). The package is green only when all three land
> together; design the `EdgeAction` shape here as the contract the siblings
> consume.

## Design

### 1. Extend the commit `EdgeAction`

Generalize `{ kind: "commitPending" }` so it carries the disambiguated message
and cleanup. Prefer a discriminated payload over per-state hacks:

```ts
| {
    kind: "commitPending"
    message?: string          // explicit subject; absent → "chore(gtd): commit pending changes"
    removeLastPackage?: boolean // execute: drop the consumed `.gtd/NN-...`
    restorePaths?: ReadonlyArray<string> // default ["TODO.md","REVIEW.md"]
  }
```

(Keep the no-message form working for Part A's `code-changes`.)

### 2. Intent descriptor → RESOLVE payload

The next edge sees a dirty tree but must know WHICH state produced it. Add the
descriptor to `ResolvePayload` (read-only fact gathered by `Events.ts`, wired in
the driver/Events task) and fold it in the machine. Per state, the descriptor is
a committed/on-disk marker the agent leaves behind:

- `execute` → a marker that the selected package is "executed, ready to commit"
  vs "decompose just wrote it, not executed" (the crux). Model a payload field
  e.g. `pendingCommitIntent?: "execute" | "decompose" | "human-review" |
  "new-todo" | "modified-todo" | "execute-simple" | "fix-tests"`. The machine
  routes a dirty tree + intent to a `commitPending` action carrying the right
  message/cleanup; the message text itself is computed edge-side (sibling 02)
  OR passed through as `message` on the action — decide and document. Keep the
  MACHINE pure: it only selects the intent → action mapping; it never reads
  files.

### 3. Guard ordering

- Resolve the overlap: a "just-produced, uncommitted" tree must NOT be misrouted
  to the existing `code-changes` leaf (which today fires on any dirty non-
  TODO/REVIEW path, `Machine.ts:125`). Add the intent-aware commit branch
  AHEAD of (or guarding) `code-changes` so an intent-bearing dirty tree commits
  with the right message instead of the generic one.
- `decompose`'s uncommitted `.gtd/` vs `execute`'s consumed `.gtd/`: decide
  whether they need distinct markers; if so, encode both in the intent field and
  branch on them. Document the decision in a code comment.
- The A0 `noAgentHops`/`stuck` cap already bounds a post-agent commit that fails
  to clear its dirty tree → escalate (no extra guard needed; verify the new
  branch participates in `foldAdvance`).

## Acceptance criteria

- [ ] The commit `EdgeAction` carries optional `message` / `removeLastPackage` /
      `restorePaths`; the bare Part A `code-changes` form still works.
- [ ] `ResolvePayload` gains the `pendingCommitIntent` descriptor; the machine
      folds it into the correct `commitPending` action per state
      (execute/decompose/new-todo/modified-todo/execute-simple/human-review/
      fix-tests).
- [ ] Intent-bearing dirty tree routes to the disambiguated commit BEFORE the
      generic `code-changes` leaf; no misrouting of a just-produced tree.
- [ ] `decompose` vs `execute` `.gtd/` disambiguation is resolved (distinct
      markers if needed) and documented.
- [ ] `noAgentHops`/`stuck` still bounds the loop including the new commit
      branch.
- [ ] `npm run test` green; `npm run typecheck` passes.

## Tests this task MUST add (`src/Machine.test.ts`)

- For each intent value: a dirty-tree `RESOLVE` with that `pendingCommitIntent`
  emits a `commitPending` action with the expected `message`/`removeLastPackage`
  (assert the action payload, machine-only — no git).
- `execute` intent emits `removeLastPackage: true` only when it is the last
  package (or document where last-package detection lives — edge vs machine).
- A dirty tree with NO intent still routes to `code-changes` (Part A regression).
- The new commit branch increments `noAgentHops`; a commit that fails to clear
  the tree (intent persists) hits `stuck`/cap → escalate.

## Constraints / edge cases

- Machine stays pure: it maps intent → action; it does NOT compute commit
  messages from file contents (that is edge work — sibling 02). If a message is
  fully determined by the intent (fixed strings), the machine MAY pass it as
  `message`; for content-derived messages (execute's COMMIT_MSG.md,
  execute-simple from TODO.md), leave `message` undefined and let the edge fill
  it. Document which path each intent takes.
- Land AFTER Part A (packages 01–04) is proven.
