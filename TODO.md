# gtd should coordinate, not dictate strategy

Today every phase prompt in `src/prompts/*.md` embeds detailed strategy — the
`build` prompt enforces a `- [ ]` checklist format, the header pins
Conventional Commits and a "run the test suite after every commit" rule, the
commit prompt prescribes `git add -p` and semantic grouping, and so on. That
makes gtd opinionated about *how* to do each phase, not just *which* phase to
run.

Pivot: gtd should do **coordination only** — detect the git state, pick the
phase, and hand off. The "how" of each phase is delegated to other skills
that the agent can pick up if installed (or fall back to its own judgement
if not). Specifically the following concerns leave gtd entirely:

- **Grilling.** Already organically delegated to `grill-with-docs` via
  vocabulary in the planning prompts; verify nothing else leaks.
- **Commit message content and formatting.** Drop the Conventional Commits
  rule from the header entirely — no replacement, no "follow your
  commit-skill of choice" wording (which would just be another form of
  dictation). Drop the specific commit subjects baked into each phase
  prompt (`docs: seed plan`, `docs: refine plan`, `docs: capture TODO
  markers in TODO.md`, `chore: remove completed plan`). Silence is the
  right default for a coordination layer; if a commit skill is installed
  the agent will use it.
- **Build process.** Drop the `- [ ]` / `- [x]` checklist contract, the
  "plan mode + sub-agents" instructions, the per-item commit rule. Leave
  a single sentence: "execute the finalized plan in TODO.md, then remove
  TODO.md when done." How the plan is structured (checkboxes, prose,
  custom skill format) is opaque to gtd.
- **Test process.** Drop "run the project's test suite" instructions from
  every phase. The clean-tree-non-todo phase becomes "verify the working
  tree is healthy" without saying how (tests, type-check, lint,
  smoke-run, etc. — agent's call).

What gtd keeps:

- **State detection.** The state machine in `src/State.ts` is the core
  value — it reads the working tree and picks the right phase. Filename-
  based detection (`lastCommitIsTodoOnly`), not commit-prefix-based, so
  dropping Conventional Commits doesn't break anything.
- **Phase routing.** The set of phases (seed plan / refine plan / build /
  commit / extract TODO markers / verify) and their composition rules
  remain.
- **TODO.md plumbing contracts.** The protocol-level pieces that allow
  gtd to detect state across runs: existence of `TODO.md`, the
  `## Open Questions` section with `<!-- user answers here -->`
  placeholders, the "last commit touched only TODO.md" signal, the
  "delete `TODO.md` when build is done" signal. These are coordination
  glue between phases, not strategy.
- **The "don't ask clarifying questions" rule in the header.** That's
  what makes the workflow asynchronous — questions go into `TODO.md`
  rather than chat. Coordination, not strategy.

## High-level changes

- Rewrite `src/prompts/header.md`:
  - Keep: "you are an autonomous coding agent", "context below describes
    the current state, follow the task sections", "do not ask clarifying
    questions — record uncertainty in `TODO.md` under `## Open Questions`".
  - Drop: Conventional Commits rule, "run tests after every commit" rule,
    the "stay focused" admonition (per-phase prompts can keep that
    locally if needed).
- Rewrite each phase prompt to **describe intent, not procedure**, and
  pick intent-driven task headings (no strategy shorthand like "Build
  every unchecked item"):
  - `build.md`: "The plan in TODO.md is finalized. Execute it. When done,
    delete TODO.md." Heading: `## Task: Execute the plan in TODO.md`.
  - `code-changes.md`: "Commit the uncommitted changes in the working
    tree." Heading: `## Task: Commit the uncommitted changes`.
  - `run-tests.md`: "Verify the working tree is healthy." Heading:
    `## Task: Verify the working tree is healthy` (already close;
    refine).
  - `todo-markers.md`: "Move every new `TODO:` comment from the diff
    into TODO.md and remove it from source." Drop the specific list-item
    shape. Heading: `## Task: Move TODO: markers into TODO.md`.
  - `new-todo.md`: "TODO.md is a fresh sketch. Develop the plan." Keep
    the grilling vocabulary that organically triggers grill-with-docs
    and the `## Open Questions` contract.
  - `modified-todo.md`: same — keep the Open Questions / answer-merge
    contract; drop everything else about how to grill.
- Rename the `run-tests` branch in `src/State.ts` to `verify` for
  consistency with the new framing. Rename `src/prompts/run-tests.md` to
  `src/prompts/verify.md`. Update the imports in `Prompt.ts` accordingly.
- Sweep `tests/integration/features/branches.feature` and
  `src/Prompt.test.ts`:
  - Drop any text-assertion that depends on removed strategy language
    (Conventional Commits, "run the project's test suite").
  - Update task-heading assertions to match the new intent-driven
    headings.
  - Keep structural assertions (diff embedded, header present,
    composition order).
- Update `README.md`:
  - Remove the Conventional Commits bullet from "Every prompt also
    includes:".
  - Update the workflow table to use the new phase headings.
