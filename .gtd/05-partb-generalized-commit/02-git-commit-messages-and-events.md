# Part B — edge: disambiguated commit messages + intent gathering

The edge side of Part B: extend `commitPending` to honor the
`message`/`removeLastPackage`/`restorePaths` payload, compute the
content-derived messages, and gather the `pendingCommitIntent` descriptor in
`Events.ts` so the machine can fold it.

## Files (this task)

- `src/Git.ts`
- `src/Git.test.ts`
- `src/Events.ts`
- `src/Events.test.ts`

> File-disjoint from sibling tasks `01-...` (`Machine.ts`/`Machine.test.ts`) and
> `03-...` (`main.ts` + prompts). Consumes the `EdgeAction` commit shape and the
> `pendingCommitIntent` field defined by task 01.

## Changes

### `GitService.commitPending(opts)` (`src/Git.ts`)

Extend the Part A `commitPending` to accept options matching the task-01 action
payload:

- `message?: string` — commit subject; default `chore(gtd): commit pending
  changes`.
- `restorePaths?: ReadonlyArray<string>` — paths to `git restore --staged`
  before commit; default `["TODO.md", "REVIEW.md"]`.
- `removeLastPackage?: boolean` — when true, `git rm -r` the consumed
  `.gtd/NN-...` package dir (the lowest-numbered, already-executed one) as part
  of the same commit. (Coordinate "which dir" — the edge knows the selected
  package; pass its path in via the action or recompute from `.gtd/` listing.)
- Still skip the commit when nothing is staged after restores.

Add a small message-derivation helper used by the driver (task 03) for the
content-derived intents:

- `execute` → read the selected package's `COMMIT_MSG.md`.
- `decompose` → `plan(gtd): decompose TODO.md into N work packages` (N = package
  count in `.gtd/`).
- `human-review` → `review(gtd): create review for <short>` (short from base).
- `new-todo`/`modified-todo` → fixed-ish message (define exact subjects).
- `execute-simple` → message derived from `TODO.md` (mild judgment — keep the
  derivation deterministic, e.g. first heading; document).
- `fix-tests` → the agent already committed in Part A's loop? NO — Part B moves
  it: the `Gtd-Test-Fix:` trailer counting stays edge-side; commit subject is the
  agent's fix description carried via descriptor OR a fixed `fix(gtd): ...`
  with the trailer appended. Document the chosen message + ensure the
  `Gtd-Test-Fix:` trailer is preserved so the verify counter still advances.

### `Events.ts` — gather `pendingCommitIntent`

- Detect the intent descriptor the agent left behind (committed marker or on-disk
  file) and set `payload.pendingCommitIntent` accordingly. Keep `Events.ts`
  READ-ONLY (no writes). Define the on-disk/committed marker format here to match
  task 01's fold (e.g. a sentinel file under `.gtd/` or a commit-message marker —
  pick the simplest that disambiguates `decompose`-wrote-it vs
  `execute`-finished-it, per task 01's decision).

## Acceptance criteria

- [ ] `commitPending` honors `message`, `restorePaths`, `removeLastPackage`;
      default behavior matches Part A when called with no opts.
- [ ] Message-derivation helper produces the right subject per intent
      (COMMIT_MSG.md for execute, counted N for decompose, base short-sha for
      human-review, fixed for new/modified-todo, derived for execute-simple,
      trailer-preserving for fix-tests).
- [ ] `Events.ts` gathers `pendingCommitIntent` and stays write-free.
- [ ] `Gtd-Test-Fix:` trailer survives the moved fix-tests commit (verify
      counter still advances).
- [ ] `npm run test` green; `npm run typecheck` passes.

## Tests this task MUST add/update

- `src/Git.test.ts`:
  - `commitPending({ message })` uses the given subject.
  - `commitPending({ removeLastPackage, ... })` removes the consumed package dir
    in the same commit.
  - `commitPending({ restorePaths })` keeps the listed paths uncommitted.
  - message-derivation helper cases (COMMIT_MSG.md read, decompose count,
    human-review short-sha).
- `src/Events.test.ts`:
  - a tree with the execute-finished marker yields
    `pendingCommitIntent === "execute"`.
  - a tree with the decompose-wrote-it marker yields
    `pendingCommitIntent === "decompose"`.
  - no marker → `pendingCommitIntent` absent (Part A `code-changes` path).

## Constraints / edge cases

- `Events.ts` stays read-only; all writes are in `Git.ts`.
- Keep the message derivation deterministic; the only residual LLM work per the
  plan is hunk grouping (human-review) and execute-simple's mild judgment — those
  stay in the agent prompt (task 03).
