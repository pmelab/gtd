# Task: Rewrite `src/Prompt.ts` + `src/prompts/` for the 16 states

Replace prompt assembly so it renders one section per agent/human-facing state
of the new machine, and replace the prompt markdown set. Part of the **atomic
cutover** package (shared contract in `01-machine-resolver.md`).

Spec pointers: `STATES.md` § States (the "Prompt:" line of each); `TODO.md` →
"Modules to rewrite → src/Prompt.ts + src/prompts/", "Throw away → Old prompts",
and Resolved Q "Which new states are subagent-spawning".

## Prompt sections (new `src/prompts/*.md`)

Author these (one per prompt-bearing state). Reuse `header.md` and
`partials/auto-advance.md` unchanged. **Delete** every old prompt file
(`new-todo`, `modified-todo`, `execute`, `fix-tests`, `spec-review`, `spec-fix`,
`human-review`, `review-process`, `review-incomplete`, `await-answers`,
`verified`, and the old `decompose`/`escalate`/`await-review` which you rewrite):

- `grilling.md` — ask-questions grilling. Must support the 3-way tail: leave one
  `<!-- user answers here -->` placeholder per open question and **STOP for
  answers** when questions are open (`grillingCase:"stop"`); incorporate edits +
  push back + re-open markers when iterating (`grillingCase:"iterate"`); and the
  convention to write the sentinel "no open questions — run gtd to plan" when
  converged. (planning tier, `{{MODEL}}`)
- `decompose.md` — Grilled **and** Planning. Create `.gtd/NN-name/NN-task.md`
  ordered packages of parallel, file-disjoint subtasks. **No `COMMIT_MSG.md`
  step** (dropped). Leave changes uncommitted; the edge commits `gtd: planning`.
  (planning tier, `{{MODEL}}`)
- `building.md` — ex-`execute`: subagents build the subtasks of the first
  package in parallel, leave the work **uncommitted** (Testing commits it
  `gtd: building`). (execution tier, `{{MODEL}}`)
- `fixing.md` — ex-`fix-tests`+`spec-fix`: read `FEEDBACK.md`, make one fix,
  leave uncommitted (returns through Testing). (execution tier, `{{MODEL}}`)
- `agentic-review.md` — ex-`spec-review`: review the package's accumulated diff
  and **always write `FEEDBACK.md`** — empty = approval, findings = fix.
  (planning tier, `{{MODEL}}`)
- `clean.md` — ex-`human-review`: write `REVIEW.md` for `base..HEAD`.
  (planning tier, `{{MODEL}}`)
- `await-review.md` — STOP; tell the user to review via `REVIEW.md`.
- `escalate.md` — STOP; surface `ERRORS.md`, tell the human to investigate.
- `idle.md` — nothing to do.

States that emit **no** agent prompt: transport, new-feature, testing,
accept-review, close-package, done (edge-only / auto / STOP-without-section).

## `src/Prompt.ts`

- `buildPrompt(result, resolveModel)` assembles `header` + a `## Context` block
  (last commit, working-tree, packages, diffs) + the state's section + the
  `auto-advance` partial when `result.autoAdvance`.
- Model states needing `{{MODEL}}`: `grilling`, `decompose`, `agentic-review`,
  `clean` (planning) and `building`, `fixing` (execution). Resolve via the
  Config `stateTier`/`builtinTierDefault` as today. Edge-only/STOP states carry
  no `{{MODEL}}`.
- `building`/`agentic-review` render the selected (first) package's task files
  (reuse a `renderPackage` that inlines each task `.md`, fenced) — **without**
  any `COMMIT_MSG.md` reference. `agentic-review` also shows the package diff
  (from `context`).
- Grilling renders its `stop`/`iterate` tail from `context.grillingCase`.
- Drop `PromptOverride`, the `fix-tests`/`review-process` override branches, and
  the `cleanup`/`close-review`/`code-changes`/`commit-pending` action-leaf
  throw set (those states no longer exist). Throw only if asked to render an
  edge-only state.

## Files

- Rewrite: `src/Prompt.ts`
- Rewrite: `src/Prompt.test.ts` (assert each section renders, `{{MODEL}}`
  substitution for the six model states, grilling stop/iterate tails, package
  rendering without COMMIT_MSG, and that edge-only states throw)
- Add: `src/prompts/grilling.md`, `decompose.md`, `building.md`, `fixing.md`,
  `agentic-review.md`, `clean.md`, `await-review.md`, `escalate.md`, `idle.md`
- Delete: all obsolete `src/prompts/*.md` (`new-todo`, `modified-todo`,
  `execute`, `fix-tests`, `spec-review`, `spec-fix`, `human-review`,
  `review-process`, `review-incomplete`, `await-answers`, `verified`)
- Keep: `src/prompts/header.md`, `src/prompts/partials/auto-advance.md`

## Constraints

- Import resolver types (`Result`/state union/`GtdPackageFact`/context) from
  `./Machine.js` as `import type`; import `stateTier`/`builtinTierDefault`/
  `ModelState` from `./Config.js`.
- The `.md` files are bundled as text (tsup `loader: { ".md": "text" }`, vitest
  `raw-md` plugin) — keep the `import x from "./prompts/x.md"` pattern.

## Acceptance criteria

- [ ] All nine new sections exist and render via `buildPrompt`.
- [ ] The six model states substitute `{{MODEL}}`; edge-only states never do.
- [ ] Grilling renders the correct stop vs iterate tail; converged path is
      handled by `grilled`→`decompose`.
- [ ] Package rendering contains no `COMMIT_MSG.md` reference.
- [ ] `src/Prompt.test.ts` passes; integrates green at package completion.
