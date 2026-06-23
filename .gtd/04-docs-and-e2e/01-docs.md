# Task: Document the config system; drop AGENTS.md model-preferences prose

Update the human-facing docs to describe the new `.gtdrc` config system and
remove the now-obsolete AGENTS.md model-preferences sections. This task owns the
pure-prose doc files ONLY (README.md, SKILL.md, AGENTS.md). It is file-disjoint
from the sibling e2e/prompt task in this package.

Per the repo's global instruction, every significant change must be reflected in
the README — this task discharges that.

## What to update

### `README.md`

- [ ] Remove the model-tier section (lines ~123-129) and the inline
      "(planning model)" / "via AGENTS.md" notes (lines ~66, ~69, ~89,
      ~123-129). Verify exact locations against the current file before editing.
- [ ] Add a "Configuration" section documenting the `.gtdrc` file:
  - Supported filenames (searchPlaces): `.gtdrc`, `.gtdrc.json`, `.gtdrc.yaml`,
    `.gtdrc.yml`, `gtd.config.json`, `gtd.config.yaml`.
  - The schema: `testCommand` (string) and `models` with `planning`,
    `execution`, and `states.*` overrides for the 5 subagent-spawning states
    (`new-todo`, `modified-todo`, `decompose`, `execute`, `execute-simple`).
    Note unknown `models.states` keys (e.g. `fix-tests`) are rejected.
  - The cwd→home cascade and the worktree-parent use case (a `.gtdrc` in a
    shared parent dir cascades to all checkouts under it).
  - Precedence: all found levels merged, innermost (cwd) wins.
  - That `testCommand` is now OVERRIDABLE (previously hardcoded `npm run test`;
    the per-edge test cap stays fixed and non-overridable).
  - Built-in defaults when no config: `testCommand: "npm run test"`, planning →
    `claude-opus-4-8`, execution → `claude-sonnet-4-8`.
- [ ] Update any remaining "via AGENTS.md" model wording to point at `.gtdrc`.

### `SKILL.md`

- [ ] Remove the "Model configuration" section (lines ~45-63) and the
      model-preferences bullet under "Configuration via AGENTS.md"
      (lines ~109-114). Verify exact locations against the current file.
- [ ] Replace with a pointer to the `.gtdrc` config file and the schema summary
      (same content as README, condensed). Keep it consistent with README.

### `AGENTS.md` (this repo's own conventions file)

- [ ] If `AGENTS.md` contains a "Model preferences" section, remove it (the plan
      states structured config REPLACES the AGENTS.md model prose entirely).
      Note: the current repo `AGENTS.md` shown to the orchestrator may not have
      one — if no model-preferences section exists, this is a no-op; do not
      invent content. Do NOT remove unrelated architecture/testing sections.

## Constraints

- Do NOT edit any prompt `.md` under `src/prompts/`, any `src/` code, the
  cucumber features/steps, or `scripts/gtd.js` — those belong to the sibling
  task `02-e2e-and-bundle.md`.
- Keep wording consistent between README.md and SKILL.md (same schema, same
  precedence description).
- Verify all cited line numbers against the actual files before editing — they
  are approximate.

## Acceptance criteria

- [ ] README.md documents `.gtdrc`: filenames, schema, cwd→home cascade,
      worktree-parent use case, innermost-wins precedence, overridable
      testCommand, built-in defaults; no stale "via AGENTS.md" model wording.
- [ ] SKILL.md model-preferences sections removed and replaced with a config
      pointer + schema summary.
- [ ] AGENTS.md model-preferences section removed if present (else no-op).
- [ ] `npm run test` (vitest) stays green (docs-only changes do not affect it).

## Files

- Edit: `README.md`, `SKILL.md`, `AGENTS.md`
- Reference: `TODO.md` ("Replacing the AGENTS.md model prose", "Docs" sections)
