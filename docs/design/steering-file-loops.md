# Plan: steering-file validation loops in the default workflow

> Status: §2–§4 (the two validation loops in the default workflow) AND §5 (the
> LSP resurrection) both LANDED 2026-07-22. Goal: the bundled default workflow
> completely maps the functionality the deleted v2 LSP server (`src/Lsp.ts`,
> removed in the v3 rewrite) provided over the two steering files: the
> **open-questions format** in `.gtd/TODO.md` and the **checkbox review format**
> in `.gtd/REVIEW.md` — including a deterministic validation loop for each.
> Everything is pure workflow configuration; the engine is untouched.

## 1. The formats (authoritative spec = the deleted parsers)

Extract the exact rules from git history —
`git show 60c7490^:src/OpenQuestions.ts` and
`git show 60c7490^:src/ReviewDoc.ts` — and embed them BOTH in the agent prompts
(so drafts are born valid) and in the validator scripts (so malformed drafts
bounce):

**`.gtd/TODO.md` open questions** (`OpenQuestions.ts`):

- Free-form prose, plus an OPTIONAL `## Open Questions` section (absent = zero
  questions, valid).
- Every `###` sub-heading directly under that section is one question; its
  body's FIRST non-blank line must be `Suggested default: <text>` (agent's
  unanswered default) or `Answer: <text>` (human's answer / folded-in) —
  anything else is a format error.
- The section ends at the next level-1/2 heading or EOF.

**`.gtd/REVIEW.md`** (`ReviewDoc.ts`):

- First non-blank line: `# Review: <short-hash>`.
- A `<!-- base: <hash> -->` comment somewhere in the document.
- At least one `## <Chunk Title>` (non-empty title), each with at least one file
  pointer matching `- [ ] ./path/to/file.ts#42 — note` / `- [x] …` (checkbox,
  `./`-relative path, optional `#line`, optional `—`/`-` note) — the deleted
  `FILE_POINTER_RE` is the shape to port.

## 2. The new default workflow (12 states)

Current 7 states, plus the two loops. `smart` on `grilling` and `reviewing`.

| State               | Actor | Content | `on` (declaration order matters)                                                                                                                 |
| ------------------- | ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `idle` (initial)    | human | message | `* **` → `grilling`                                                                                                                              |
| `grilling`          | agent | prompt  | `* **` → `todo-validating`                                                                                                                       |
| `todo-validating`   | check | script  | `A/M .gtd/FORMAT.md` → `grilling`; `D .gtd/FORMAT.md` → `grilling-answer`; `C` → `grilling-answer`                                               |
| `grilling-answer`   | human | message | `C` → `building`; `* **` → `grilling`                                                                                                            |
| `building`          | agent | prompt  | `* **` → `checking`                                                                                                                              |
| `checking`          | check | script  | `A/M .gtd/FEEDBACK.md` → `fixing`; `D .gtd/FEEDBACK.md` → `reviewing`; `C` → `reviewing`                                                         |
| `fixing` (retry 3)  | agent | prompt  | `* **` → `checking`                                                                                                                              |
| `escalate`          | human | message | `* **` → `checking`                                                                                                                              |
| `reviewing`         | agent | prompt  | `* **` → `review-validating`                                                                                                                     |
| `review-validating` | check | script  | `A/M .gtd/FORMAT.md` → `reviewing`; `D .gtd/FORMAT.md` → `await-review`; `C` → `await-review`                                                    |
| `await-review`      | human | message | `D .gtd/REVIEW.md` → `idle`; `M .gtd/REVIEW.md` → `review-deciding`; `* **` → `grilling`; (no `C` row — a clean step is a no-op, still awaiting) |
| `review-deciding`   | check | script  | `A/M .gtd/TODO.md` → `grilling`; `D .gtd/REVIEW.md` → `idle`; `C` → `await-review` (defensive)                                                   |

**Loop 1 — TODO.md questions (maps the LSP's question symbols/format):**

- `grilling` develops `.gtd/TODO.md` with the exact Open Questions format; if
  `.gtd/FORMAT.md` exists, its prompt says to fix those findings first.
- `todo-validating` (deterministic script): parse-check TODO.md against §1's
  rules. Malformed → write findings to `.gtd/FORMAT.md` (one line each) → back
  to `grilling`. Valid → `rm -f .gtd/FORMAT.md` → `grilling-answer`.
- `grilling-answer` (human): answer by replacing `Suggested default:` with
  `Answer:` in place; accept all remaining defaults with a clean step (`C` →
  `building`); any edit loops back to `grilling` (the agent folds answers in,
  possibly asks follow-ups, and re-validates).

**Loop 2 — REVIEW.md checkboxes (maps the LSP's review chunks/check actions):**

- Green `checking` now goes to `reviewing` (not straight to `await-review`).
- `reviewing` (agent, `model: smart`) writes `.gtd/REVIEW.md` in §1's exact
  format — header hash from `<%= it.currentCommit %>` (short slice), base
  comment from `<%= it.startCommit %>`, chunks grouped semantically over the
  embedded `it.processDiff` (reuse the advanced example's reviewing prompt as
  the base, tightened to the format spec).
- `review-validating` (deterministic script): structure check (header, base
  comment, ≥1 chunk, every pointer matches the shape). Malformed →
  `.gtd/FORMAT.md` → `reviewing`; valid → `await-review`.
- `await-review` (human): tick a pointer's checkbox to approve that item; when
  EVERY box is ticked the cycle is approved. Add notes / untick / edit code for
  feedback. Deleting `.gtd/REVIEW.md` outright is the power-user approve
  shortcut. Any `M .gtd/REVIEW.md` step routes to the decider (declared before
  `* **`, so a step that also touches code still goes to the decider); code-only
  edits are feedback straight to `grilling`.
- `review-deciding` (deterministic script): if NO unticked `- [ ]` pointer
  remains → approve: `rm .gtd/REVIEW.md` (→ `idle`). Otherwise → extract the
  unticked pointers and their notes into a fresh `.gtd/TODO.md` (the next lap's
  input) AND `rm .gtd/REVIEW.md` — the diff then contains both `A .gtd/TODO.md`
  and `D .gtd/REVIEW.md`, and the `A/M .gtd/TODO.md` row is declared FIRST so
  feedback wins (first-match declaration order is load-bearing here; pin it with
  a test).

**Hygiene invariant (assert in e2e):** an approved cycle leaves `.gtd/` empty —
FEEDBACK.md is cleaned by green `checking`, FORMAT.md by a valid validation run,
REVIEW.md by the approval, TODO.md by `building`.

## 3. What the validators look like

Same discipline as `checking`/the old `picking`: mechanics-only bash, verdict =
file op, semantics = the `on` map. Grep/awk ports of the parser rules
(pragmatic, not a full markdown parser): e.g. a question block whose first
non-blank body line matches neither `^Answer:` nor `^Suggested default:` is a
finding; a pointer line failing the `- [(x| )] ./path(#N)?( — note)?` shape is a
finding; `- [ ]` presence is the review-deciding branch condition. Findings go
into `.gtd/FORMAT.md` verbatim (file + line + rule), so the fixing agent gets
actionable input.

## 4. Change chart

| Area                                                  | Change                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/workflows/default.yaml`                          | +5 states (`todo-validating`, `grilling-answer`, `reviewing`, `review-validating`, `review-deciding`); `checking`'s green rows retarget `reviewing`; `await-review` rewritten (checkbox semantics, decider routing); prompts gain the format specs; header comment updated.                                                                                |
| Engine / TypeScript                                   | **No changes.** Everything is workflow data.                                                                                                                                                                                                                                                                                                               |
| `STATES.md` §10                                       | New table + walkthrough (both loops, the declaration-order subtleties, the hygiene invariant).                                                                                                                                                                                                                                                             |
| `tests/integration/features/default-workflow.feature` | Rewritten: malformed-TODO lap (simulate `todo-validating` by writing `.gtd/FORMAT.md` + `gtd step check` — @inmem never executes scripts), valid draft → answer lap → accept; malformed-REVIEW lap; tick-all approve → `idle` with empty `.gtd/`; partial-tick feedback → TODO.md extraction → `grilling`; delete-shortcut approve; retry/escalation kept. |
| `smoke.feature`                                       | Hop updates (`grilling` now routes to `todo-validating`).                                                                                                                                                                                                                                                                                                  |
| Docs                                                  | `configuration.md` / `README.md` walkthrough mentions; `docs/examples/advanced-workflow.md` intro gains one line noting the default now carries the validation loops (the example itself is NOT reworked in this change — noted as a possible follow-up to rebase it on the new default).                                                                  |
| Live verification                                     | Real-script drive (`gtd run` at each validator) covering: agent writes malformed TODO → FORMAT.md → fixed lap; answers folded; malformed REVIEW lap; tick-all approve; partial-tick feedback extracting TODO.md; final tree `.gtd`-free at idle.                                                                                                           |

## 5. The LSP server comes back (v3-shaped)

The v2 LSP (`src/Lsp.ts`, deleted at the v3 rewrite) is resurrected, scoped to
what is workflow-agnostic — the FILE FORMATS, not any particular state machine:

- **Restore the pure parsers verbatim from history** —
  `git show 60c7490^:src/OpenQuestions.ts` / `:src/ReviewDoc.ts` (+ their unit
  tests) — they are pure (no git/fs/Effect) and restore cleanly. They are the
  executable spec of §1; the bash validators in §3 implement the SAME rules
  (note this dual-implementation contract in both places — the parsers' unit
  tests are the format's spec tests).
- **New `src/Lsp.ts`** (recover from history, then STRIP the v2-model
  dependencies — Events/Machine/ReviewWindow/STATE_FILE are gone): keyed on FILE
  NAME, not state. For `.gtd/TODO.md`: document symbols for open questions
  ([suggested]/[answered]). For `.gtd/REVIEW.md`: chunk/hunk symbols and the
  check/uncheck code actions (hunk and whole-chunk). BOTH files: publish the
  parsers' `errors` as diagnostics — the same findings the workflow's
  `.gtd/FORMAT.md` validators produce, live in the editor. The v2
  `gtd.openSteeringFile` command and its hardcoded state→file map are NOT
  restored (a v3 workflow is arbitrary data; a state names no file) — noted as a
  possible future addition driven by workflow config.
- **CLI**: re-add the `gtd lsp` subcommand (stdio transport, as before) to
  `program.ts` dispatch + help + `docs/cli.md`; re-add the
  `vscode-languageserver` / `vscode-languageserver-textdocument` dependencies;
  confirm the tsdown single-file bundle still builds and the subcommand starts
  from `dist/gtd.bundle.mjs`.
- **Tests**: parser unit tests restored; the LSP's pure helpers
  (symbol/edit/diagnostic builders) unit-tested as in v2 (recover `Lsp.test.ts`
  from history and adapt); restore/adapt the old protocol-level e2e
  (`lsp.steps.ts` + feature) if it adapts cleanly, otherwise a minimal @live
  smoke that `gtd lsp` starts and answers `initialize`.
- **Housekeeping**: add the restored pure modules to `stryker.config.json`'s
  mutate list; `docs/development.md` + `docs/upgrading.md` notes (the LSP is
  back, file-format-keyed); README one-liner on editor integration.

## 6. Explicitly out of scope

- `ARCHITECTURE.md` (the old second question phase) — the default keeps a single
  grilling step; the advanced example still shows the two-phase shape.
- Engine-level validation of steering files — validation stays a workflow
  concern, per the v3 charter; the LSP is editor tooling over the same formats,
  not an engine hook.
- The `gtd.openSteeringFile` command (needs a state→file mapping that v3
  workflows don't declare — future work, possibly a per-state `file:` hint).
