# Plan

Two independent changes captured from a review of completed work:

1. Delete `TODO.md` once decomposition is done, so the build loop (Building,
   Testing, Fixing, …) and its subagents never see the full plan — only their
   concrete `.gtd/` task files.
2. Drop the `## Resolved` section from the `REVIEW.md` format authored by
   `clean.md`.

## Background (what the code does today)

- `src/Machine.ts` rule 3 (`.gtd present → build lifecycle`) runs **before**
  rule 6 (`todoExists → Grilling`). So while `.gtd/` exists, a coexisting
  `TODO.md` does **not** change state routing — the build loop already ignores
  it. Legal coexistence `.gtd`+`TODO.md` is documented in STATES.md.
- `TODO.md` is consumed by the **decompose prompt**
  (`src/prompts/decompose.md`), which is rendered for **both** the `grilled` and
  `planning` states (`src/Prompt.ts` `SECTIONS`/`MODEL_STATE`). Planning can
  span multiple turns; each turn commits `gtd: planning` and re-reads `TODO.md`
  to continue/refine the decomposition. So `TODO.md` must survive across
  Planning turns.
- `TODO.md` is currently deleted only by the `closePackage` edge action
  (`src/Events.ts`), and **only when the last package closes**
  (`packages.length <= 1`) — its sole purpose there is to let the next run fall
  through rule 6 → rule 7 (Clean/Idle). decompose.md's "After the subagent
  completes" section explicitly says _"Leave `TODO.md` in place — it is the plan
  of record while the packages are built."_
- The Building dispatch (`src/Machine.ts:400-402`) carries **no** edgeAction;
  the build agent runs, leaving code uncommitted, and the next run commits
  `gtd: building`.
- `clean.md` (`src/prompts/clean.md`) instructs the review subagent to write a
  `## Resolved` section at the bottom of `REVIEW.md` and to **move** resolved
  comments there as the user works through the review.

## Change 1 — delete TODO.md after decomposition

### Design decision: where to delete

`TODO.md` must survive every Planning turn (the decompose agent re-reads it) but
be gone before the first Building turn. The Planning→Building boundary is:
`.gtd/` clean + unmodified + clean tree + HEAD `gtd: planning`
(`src/Machine.ts:401`). That is the first point where decomposition is provably
finished and Building is about to start.

Plan: **delete-and-commit `TODO.md` as part of the first Building dispatch.**
Building currently has no edge action, so we add one that removes `TODO.md` and
commits it, then re-resolves into the real Building turn.

- Add a new edge action `removeTodo` (or reuse `commitPending` with a
  `removeTodo` flag) in `src/Machine.ts` and `src/Events.ts`.
- In rule 3, when `head === "gtd: planning" && p.todoExists` (clean `.gtd`,
  clean tree), return `state: "building"` with
  `edgeAction: { kind: "commitPending", prefix: "gtd: planning", removeTodo: true }`
  (a `gtd: planning` commit that records the `TODO.md` deletion). This keeps the
  Building HEAD prefix unchanged (`gtd: planning`), so the _next_ resolve — now
  with `todoExists: false` — falls into the existing Building dispatch and
  selects the first package. No new commit subject is introduced.
- When `head === "gtd: planning" && !p.todoExists`, behave exactly as today
  (dispatch Building with no edgeAction). The deletion fires **at most once**.
- `head === "gtd: package done"` Building keeps no edgeAction (TODO.md already
  gone from the planning turn).
- The `closePackage` action no longer removes `TODO.md`: drop the
  `if (packages.length <= 1) { fs.remove(TODO_FILE) }` block in `src/Events.ts`.
  By the time any package closes, `TODO.md` is already gone — the last-package
  removal and its rule 6→7 rationale become dead code. `closePackage`'s doc
  comment loses its "When it was the last package, also removes TODO.md" line.

### `removeTodo` plumbing

Mirror the existing `removeFeedback` flag on the `commitPending` action:

- `src/Machine.ts`: add optional `removeTodo?: boolean` to the `commitPending`
  variant of `EdgeAction`.
- `src/Events.ts` `case "commitPending"`: if `action.removeTodo === true`,
  `yield* fs.remove(TODO_FILE).pipe(Effect.catchAll(() => Effect.void))` before
  `commitAllWithPrefix`, so the deletion lands in the `gtd: planning` commit
  (provenance preserved in git, exactly like `removeFeedback`).

### Prompt update

- `src/prompts/decompose.md` "After the subagent completes": replace "Leave
  `TODO.md` in place — it is the plan of record while the packages are built"
  with a note that `TODO.md` is deleted once decomposition finishes (its history
  is preserved in git) and that build subagents receive only their task files.
- `src/prompts/building.md` already says "Context: the task content only" and
  "do not browse `.gtd/`" — verify and, if useful, add a one-line note that
  `TODO.md` is intentionally absent during the build loop. No behavioral change.

### Docs

- `STATES.md` Planning/Building/Close package sections: document that the first
  Building dispatch deletes `TODO.md` (committed under `gtd: planning`), and
  remove the Close-package "When it was the last package, also remove TODO.md …
  rule 6 → rule 7" paragraph. Update the legal-coexistence note: `.gtd`+TODO.md
  is legal only during Planning, not the build loop.
- `README.md`: update the TODO.md lifecycle description and the state-flow
  summary to reflect the post-decomposition deletion.

## Change 2 — remove the `## Resolved` section

Pure prompt edit, no machine/edge changes (`REVIEW.md` parsing in
`src/Events.ts` only checks presence/committed/dirty, not section structure).

- `src/prompts/clean.md`:
  - Remove the `## Resolved` block and its `<!-- resolved items move here … -->`
    line from the format example (lines 36-38).
  - Remove the final bullet (lines 50-52): "Open/unresolved comments stay at the
    top … it **moves** into the `## Resolved` section at the bottom — it is not
    deleted." Replace with guidance that the user simply checks off / edits
    items in place; no separate Resolved section.

## Tests

Per AGENTS.md, add cucumber.js scenarios for the new behavior (composable,
generic `Given` steps that map one-to-one to commits; expose real file content
in scenario text). There is no `features/` dir yet — create one with the
supporting step definitions, or, if a cucumber harness does not exist for this
repo, fall back to extending the existing vitest suites and note that in the
build packages.

Existing tests to update:

- `src/Events.test.ts`:
  - `closePackage (empty FEEDBACK)` (lines 515-532) asserts `TODO.md` is removed
    by close-package and `git ls-files TODO.md` is empty. With Change 1, by
    close-package time `TODO.md` is already gone — rework the assertion to set
    up a tree with no `TODO.md` (deleted at the planning→building boundary) and
    drop the close-package removal expectation.
  - `closePackage (force-approve …)` (lines 534-549) asserts `TODO.md` still
    exists after closing a non-last package — update to reflect that `TODO.md`
    is no longer present during the build loop.
  - Add a `commitPending` test with `removeTodo: true` asserting the
    `gtd: planning` commit records the `TODO.md` deletion (mirror the
    `removeFeedback` tests at lines 493-513).
- `src/Machine.test.ts`:
  - `clean + HEAD gtd: planning → building` (line 278) — add a variant with
    `todoExists: true` asserting the Building dispatch returns the
    `commitPending { prefix: "gtd: planning", removeTodo: true }` edge action,
    and a variant with `todoExists: false` asserting no edge action (current
    behavior preserved).
- `src/Prompt.test.ts`: if any assertion references the `## Resolved` text or
  the decompose "Leave TODO.md in place" wording, update it.

## Trace checklist (AGENTS.md "Removing a Workflow Step" discipline)

`TODO.md` is not a workflow step, but trace every reference before changing its
lifecycle:

- `EdgeAction` `commitPending` type (`src/Machine.ts`) — add `removeTodo`.
- Rule 3 Building dispatch (`src/Machine.ts`) — gate on `todoExists`.
- `commitPending` / `closePackage` edge actions (`src/Events.ts`).
- `decompose.md`, `building.md`, `clean.md` prompts.
- STATES.md Planning / Building / Close package / legal-coexistence sections.
- README.md TODO.md lifecycle + state-flow summary.
- `Events.test.ts`, `Machine.test.ts`, `Prompt.test.ts`.

no open questions — run gtd to plan
