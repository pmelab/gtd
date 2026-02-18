# README Alignment with Current Implementation

## Action Items

### Commit Prefixes Table

- [x] Add missing commit prefixes 🌱 SEED, 💬 FEEDBACK, and 👷 FIX to the table
  - The table currently only documents 5 prefixes (🤦 🤖 🔨 🎓 🧹) but
    `CommitPrefix.ts` defines 8
  - 🌱 SEED: new TODO.md file committed (first plan seed)
  - 💬 FEEDBACK: changes to existing TODO.md (blockquotes, edits)
  - 👷 FIX: non-feedback code changes (regular fixes without marker prefixes)
  - 🤦 HUMAN: code changes containing feedback markers (TODO:, FIX:, FIXME:,
    HACK:, XXX:)
  - Update the 🤦 row description to reflect it now specifically means code
    hunks with feedback markers, not just "human edits"
  - Tests: `bun vitest run src/readme.test.ts` — the existing "includes
    emoji-prefixed commit convention" test should be extended to check for all 8
    prefixes

### Mermaid Flowchart

- [x] Update the main flowchart to reflect the actual decision tree from
      `InferStep.ts`
  - Current flowchart shows a simplified single-commit feedback path; actual
    implementation classifies diff into up to 4 separate commits (SEED, HUMAN,
    FIX, FEEDBACK) via `DiffClassifier.classifyDiff`
  - SEED and FEEDBACK route the same as HUMAN in `inferStep` (learn if only
    learnings modified, else plan)
  - FIX routes the same as BUILD (if todoFileIsNew → plan, else unchecked →
    build, else learn)
  - BUILD/FIX with `todoFileIsNew` → plan (not shown in current diagram)
  - Add the `todoFileIsNew` decision branch after BUILD/FIX
  - Tests: `bun vitest run src/readme.test.ts` — existing mermaid tests validate
    structure and lifecycle steps

### Feedback Classification Section

- [x] Document the 4-way diff classification and multi-commit behavior
  - `DiffClassifier.classifyDiff` splits the diff into 4 categories: `seed`,
    `feedback`, `humanTodos`, `fixes`
  - New TODO.md file → SEED commit; existing TODO.md changes → FEEDBACK commit;
    code hunks with markers → HUMAN commit; plain code hunks → FIX commit
  - Blockquote additions in TODO.md are detected via `BLOCKQUOTE_ADDITION` regex
    and included in feedback
  - When multiple categories are present, each gets its own commit (staged via
    `git.stageByPatch`)
  - Priority order for prefix classification: 🌱 > 💬 > 🤦 > 👷 (from
    `classifyPrefix`)
  - Tests: `bun vitest run src/readme.test.ts` — existing tests check marker
    documentation; may need new assertions for multi-commit docs

### Configuration Sample

- [x] Add the missing `modelLearn` field to the sample `.gtdrc.json`

  - `ConfigSchema.ts` and `Config.ts` both define `modelLearn` but the README
    sample omits it
  - Add between `modelBuild` and `modelCommit` with a comment like
    `"modelLearn": "sonnet"`
  - Tests: `bun vitest run src/readme.test.ts` — the "example configs validate
    against the JSON schema" test ensures sample configs validate

- [x] Fix the `sandboxBoundaries` example at the bottom of the config sample
  - Current README sample shows `"sandboxBoundaries": { "build": "elevated" }`
    which doesn't match the actual schema
  - The schema only supports
    `{ filesystem: { allowRead, allowWrite }, network: { allowedDomains } }` —
    there are no per-phase boundary level overrides
  - Remove the per-phase override example; the correct way to extend permissions
    is via filesystem/network overrides as shown in the "Extending Permissions"
    section
  - Tests: `bun vitest run src/readme.test.ts` — "example configs validate
    against the JSON schema" test will catch invalid config structures

### Example Workflow Section

- [x] Update the workflow narrative to reflect multi-prefix commit behavior
  - Step 3 (Review and give feedback) should mention that `gtd` classifies
    changes into separate commits by type rather than a single 🤦 commit
  - Blockquote feedback in TODO.md → 💬 commit; code marker comments → 🤦
    commit; plain code fixes → 👷 commit
  - The re-dispatch still works the same — after committing, `gtd` checks the
    last prefix and routes accordingly
  - Tests: `bun vitest run src/readme.test.ts`

### Installation Section

- [x] Verify and update the installation command
  - `npm install -g gtd` is confirmed correct as the distribution method
  - No changes needed to the install command itself
  - Tests: manual verification of installation method

### Init Subcommand Documentation

- [ ] Document the `gtd init` / `gtd init --global` subcommand in README
  - `cli.ts` defines an `init` subcommand that is not mentioned in the README
  - Add a section or subsection explaining `gtd init` for project-local config
    and `gtd init --global` for user-level config
  - Place near the Configuration section so users discover it alongside config
    file format
  - Tests: `bun vitest run src/readme.test.ts` — add assertion that README
    mentions the `init` subcommand

### Agent Fallback Behavior

- [ ] Document agent auto-detection fallback in the Agents section
  - When the first auto-detected agent fails, gtd tries the next agent in order
  - Describe the detection order and fallback logic so users understand which
    agent gets picked and what happens on failure
  - Tests: `bun vitest run src/readme.test.ts` — add assertion that README
    mentions fallback behavior

### Remove Stale TODO Comment

- [ ] Remove the HTML comment `<!-- TODO: re-align this whole file ... -->` at
      the top of README.md
  - This comment was the original trigger for this work and should be removed
    once alignment is complete
  - Tests: `grep -c 'TODO: re-align' README.md` should return 0

## Learnings

- When open questions are resolved, convert answers into concrete action items
  immediately rather than leaving them as annotations — answered questions that
  don't produce action items become stale noise
