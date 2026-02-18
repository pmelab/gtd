# README Alignment with Current Implementation

## Action Items

### Commit Prefixes Table

- [ ] Add missing commit prefixes 🌱 SEED, 💬 FEEDBACK, and 👷 FIX to the table
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

- [ ] Update the main flowchart to reflect the actual decision tree from
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

- [ ] Document the 4-way diff classification and multi-commit behavior
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

- [ ] Add the missing `modelLearn` field to the sample `.gtdrc.json`

  - `ConfigSchema.ts` and `Config.ts` both define `modelLearn` but the README
    sample omits it
  - Add between `modelBuild` and `modelCommit` with a comment like
    `"modelLearn": "sonnet"`
  - Tests: `bun vitest run src/readme.test.ts` — the "example configs validate
    against the JSON schema" test ensures sample configs validate

- [ ] Fix the `sandboxBoundaries` example at the bottom of the config sample
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

- [ ] Update the workflow narrative to reflect multi-prefix commit behavior
  - Step 3 (Review and give feedback) should mention that `gtd` classifies
    changes into separate commits by type rather than a single 🤦 commit
  - Blockquote feedback in TODO.md → 💬 commit; code marker comments → 🤦
    commit; plain code fixes → 👷 commit
  - The re-dispatch still works the same — after committing, `gtd` checks the
    last prefix and routes accordingly
  - Tests: `bun vitest run src/readme.test.ts`

### Installation Section

- [ ] Verify and update the installation command
  - Currently says `npm install -g gtd` but `package.json` uses bun for building
    (`bun build ./src/main.ts --compile --outfile dist/gtd`)
  - If distributed via npm, `npm install -g gtd` may still be correct; if
    distributed as a compiled binary, update accordingly
  - Tests: manual verification of installation method

### Remove Stale TODO Comment

- [ ] Remove the HTML comment `<!-- TODO: re-align this whole file ... -->` at
      the top of README.md
  - This comment was the original trigger for this work and should be removed
    once alignment is complete
  - Tests: `grep -c 'TODO: re-align' README.md` should return 0

## Open Questions

- Is `npm install -g gtd` still the correct installation method, or should it
  reference `bun build` / compiled binary distribution?
- Should the README document the `init` subcommand (`gtd init` /
  `gtd init --global`) that exists in `cli.ts`?
- Should the Agents section mention the fallback behavior when the first
  auto-detected agent fails (tries next in order)?
