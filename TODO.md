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
  rule from the header. Drop the specific commit subjects baked into each
  phase prompt (`docs: seed plan`, `docs: refine plan`, `docs: capture TODO
  markers in TODO.md`, `chore: remove completed plan`). Let a commit skill
  decide.
- **Build process.** Drop the `- [ ]` / `- [x]` checklist contract, the
  "plan mode + sub-agents" instructions, the per-item commit rule. Leave a
  single sentence: "execute the finalized plan in TODO.md, then remove
  TODO.md when done."
- **Test process.** Drop "run the project's test suite" instructions from
  every phase. The clean-tree-non-todo phase becomes "ask the agent to
  verify the working tree is healthy" without saying how.

What gtd keeps:

- **State detection.** The state machine in `src/State.ts` is the core
  value — it reads the working tree and picks the right phase.
- **Phase routing.** The set of phases (seed plan / refine plan / build /
  commit / extract TODO markers / verify) and their composition rules
  remain.
- **TODO.md plumbing contracts.** The protocol-level pieces that allow gtd
  to detect state across runs: existence of `TODO.md`, the
  `## Open Questions` section with `<!-- user answers here -->`
  placeholders, the "last commit touched only TODO.md" signal. These are
  coordination glue between phases, not strategy.

## High-level changes

- Rewrite `src/prompts/header.md` to drop Conventional Commits, drop the
  "run tests after every commit" rule, drop the "stay focused" admonition
  about phase scope (the per-phase prompts can keep that locally if
  needed). Keep only what's universally true: "you are an autonomous
  coding agent, the context below describes the current state, follow the
  task sections."
- Rewrite each phase prompt to **describe intent, not procedure**:
  - `build.md`: "The plan in TODO.md is finalized. Execute it. When done,
    delete TODO.md."
  - `code-changes.md`: "Commit the uncommitted changes in the working
    tree."
  - `run-tests.md`: "Verify the working tree is healthy."
  - `todo-markers.md`: "Move every new `TODO:` comment from the diff into
    TODO.md and remove it from source."
  - `new-todo.md`: "TODO.md is a fresh sketch. Develop the plan." Keep the
    grilling-vocabulary that organically triggers grill-with-docs and the
    `## Open Questions` contract (that's coordination glue).
  - `modified-todo.md`: same — keep the Open Questions / answer-merge
    contract; drop everything else about how to grill.
- Verify `Prompt.test.ts` and the cucumber suite — the structural
  assertions ("contains the right task heading") should still pass; any
  assertion on Conventional Commits or test-suite wording should be
  dropped.
- Update README's "Every prompt also includes:" section to remove the
  Conventional Commits bullet.

## Open Questions

### Does dropping Conventional Commits from the header break the auto-detection of `docs:`-prefixed commits in `State.ts`?

**Recommendation:** No. `src/State.ts:53` checks `lastCommitIsTodoOnly`
purely by filename, not by commit prefix. The planning prompts currently
suggest `docs: seed plan` / `docs: refine plan` exactly so it's easy for a
human to scan, but the state machine doesn't read the subject. Safe to drop.

<!-- user answers here -->

### Should the build prompt still tell the agent to delete TODO.md, or is even that "strategy"?

**Recommendation:** Keep it. `TODO.md` deletion is a state-machine signal —
it's what lets gtd know the plan is fully consumed and the next run should
go to the "verify" phase rather than re-entering build. That's coordination,
not strategy. The wording stays as "remove TODO.md when done."

<!-- user answers here -->

### Does the `## Open Questions` / `<!-- user answers here -->` contract stay, or do we delegate that to a planning skill?

**Recommendation:** Stay. It's the only mechanism gtd has to bridge runs —
the user edits `TODO.md` between runs, gtd diffs the file to know what was
answered, and the phase prompts route accordingly. Keep this contract
gtd-owned; revisit only if a more general protocol emerges.

<!-- user answers here -->

### Should the header still tell the agent not to ask the user clarifying questions?

**Recommendation:** Keep it. That instruction is what makes the workflow
asynchronous — questions go into `TODO.md` rather than chat. Removing it
would break the planning loop in agents that default to asking. This is
coordination ("how to communicate uncertainty across runs"), not strategy
("how to grill").

<!-- user answers here -->

### What about the "Use [Conventional Commits]…" line in the header — drop entirely, or replace with "commit semantically" / "follow your commit-skill of choice"?

**Recommendation:** Drop entirely. Saying "follow your commit-skill of
choice" is just another form of dictation. If no commit skill is installed,
the agent uses its built-in conventions; if one is, the agent will naturally
use it. Silence is the right default for a coordination layer.

<!-- user answers here -->

### Should the `todo-markers` phase still hand a specific list-item shape ("- [ ] <desc> (was `TODO:` in `path`)"), or just say "move them into TODO.md"?

**Recommendation:** Drop the specific shape. Just say "move every new
`TODO:` from the diff into TODO.md and remove it from source." Let the
planning skill (or the agent's own taste) decide whether TODO.md uses
checkboxes, bullets, sections, etc. This aligns with also dropping the
`- [ ]` contract from the build phase.

<!-- user answers here -->

### If we drop the `- [ ]` contract, how does the build phase know what to execute — does it just trust "execute the plan in TODO.md"?

**Recommendation:** Yes. After refinement, `TODO.md` is a coherent document
(every question has been answered). The agent reads it and proceeds.
Whether the plan uses checkboxes, prose, or a custom skill's format is
opaque to gtd. The build prompt just hands off intent: "execute the plan,
then remove TODO.md."

<!-- user answers here -->

### Does the build phase still need to run inside `plan mode` and spawn sub-agents, or is that also strategy?

**Recommendation:** Strategy. Drop it. Whether to enter plan mode or fan
out to sub-agents is the agent's call based on the work; gtd shouldn't
prescribe.

<!-- user answers here -->

### Should the `verify` (run-tests) phase be renamed to something less verb-specific?

**Recommendation:** Yes. "Run tests" presumes a test-runner strategy. Better
framing: "verify the working tree is healthy" — leaves the *how* (tests,
type-check, lint, smoke-run) to whatever the agent considers a healthy
check. Also rename the branch name in `State.ts` from `run-tests` to
`verify` for symmetry; cosmetic but consistent.

<!-- user answers here -->

### Do any of the cucumber e2e scenarios assert on text that's about to be dropped (Conventional Commits, "run the project's test suite", etc.)?

**Recommendation:** Sweep the feature file before refactoring prompts; drop
any text-assertion that depends on now-removed strategy language. The
task-heading assertions ("contains `## Task: Build every unchecked item`")
will also need updating since those headings are themselves strategy
shorthand — pick more intent-driven headings like
`## Task: Execute the plan in TODO.md`.

<!-- user answers here -->
