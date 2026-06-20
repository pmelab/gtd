# Automatic Markdown Formatting for TODO.md and REVIEW.md

Formatting must work in **any** project that uses the gtd skill, not just this
repo. The previous attempt installed a `.git/hooks/pre-commit` in this repo
only, which (a) does not propagate to consumer repos, (b) depends on the
consumer having `prettier` installed and discoverable via `npx`, and (c) is not
even tracked in git. The fix is to ship a `format` subcommand of the bundled
`gtd` script that carries prettier and its config, and to instruct the agent
(via the gtd prompt) to invoke it after editing `TODO.md` / `REVIEW.md`.

## Plan

### Goal

`scripts/gtd.js format <file>` formats a markdown file in place using a bundled
prettier with a fixed gtd-owned config, with zero dependency on the host repo.
The main `gtd` prompt instructs the agent to run this subcommand after writing
`TODO.md` (and `REVIEW.md`) so the committed file is normalised before the next
gtd cycle ever sees it.

### Changes

1.  **`package.json`** — move `prettier` from `devDependencies` to
    `dependencies` so tsup bundles it into `scripts/gtd.js`. Existing dev-time
    `format` / `format:check` npm scripts keep working unchanged.

2.  **`src/main.ts`** — add subcommand dispatch at the top of `program`:
    - Current behaviour (no subcommand) stays: `process.argv[2]` is the optional
      ref.
    - If `process.argv[2] === "format"`, treat `process.argv[3]` as the file
      path, run the formatter, exit. Do **not** call `detect` / `buildPrompt` in
      that mode.

    Concretely, replace the body of `program` with a small switch on
    `process.argv[2]`. Keep the existing `Effect.provide(GitService.Live)` /
    `NodeContext.layer` plumbing — both paths benefit from `FileSystem`.

3.  **`src/Format.ts` (new)** — exports a `formatFile(path: string)` Effect:
    - Uses `FileSystem` from `@effect/platform` (same import path as
      `State.ts`).
    - Reads the file; if it does not exist, logs
      `gtd: skipped formatting <path>: not found` to stderr and exits 0.
    - Runs
      `prettier.format(content, { parser: "markdown", printWidth: 80, proseWrap: "always" })`
      — config is a hard-coded object literal in this module; we never call
      `prettier.resolveConfig`, so host `.prettierrc` is ignored by design.
    - Writes back only if the output differs (avoid mtime churn).
    - Wraps the whole thing in `Effect.catchAll` that writes
      `gtd: skipped formatting <path>: <message>` to stderr and succeeds.
      Formatting is best-effort; the process exits 0 even on failure.

4.  **`tsup.config.ts`** — no change. `noExternal: [/.*/]` already inlines
    prettier. Verify the build still produces a working `scripts/gtd.js`.

5.  **Prompt updates** — every prompt template that tells the agent to write or
    edit `TODO.md` / `REVIEW.md` must end with a "now run the formatter"
    instruction. Touch points in `src/prompts/`:
    - `new-todo.md` — after step 6 (or before the "After the subagent completes"
      section), add: "After editing `TODO.md`, run
      `node scripts/gtd.js format TODO.md` to normalise it."
    - `modified-todo.md` — same instruction at the end of the editing steps.
    - `decompose.md` — when `.gtd/<package>/TODO.md` files are written, run the
      formatter on each.
    - `review-create.md` — after step 4 (writing REVIEW.md) and before step 5
      (commit), add: "Run `node scripts/gtd.js format REVIEW.md`."
    - `review-process.md` — after edits to `REVIEW.md`, run the formatter.
    - `execute-simple.md`, `code-changes.md`, `todo-markers.md`, `cleanup.md`,
      `verify.md` — audit each for paths where the agent edits `TODO.md` /
      `REVIEW.md`; add the instruction wherever it does.

    The instruction must give the **exact** command string the agent should run.
    The agent already has the cwd set to the host repo and the bundled
    `scripts/gtd.js` is the same one that produced the prompt, so
    `node scripts/gtd.js format <file>` works in this repo. For consumer repos,
    the path is the same skill-relative location the agent already used to
    invoke gtd in the first place — the prompt should phrase the instruction as
    "the same `scripts/gtd.js` you ran to get this prompt, with `format <file>`
    appended" so the agent reuses whatever absolute path the wrapper script
    knew.

6.  **Remove the now-redundant local hook artefact:**
    - Delete `.git/hooks/pre-commit` from this clone (untracked — cleanup note
      only, no committed change).
    - Verify `.prettierignore` does not list `TODO.md` / `REVIEW.md` (currently
      empty, so nothing to do).

7.  **Tests** — add a cucumber.js scenario under `tests/integration/`:
    - Given a fresh repo with an intentionally unformatted `TODO.md` (e.g. a
      single very long line of prose).
    - When the test runs `node scripts/gtd.js format TODO.md`.
    - Then `TODO.md` on disk is wrapped to 80 columns, the exit code is 0, and
      stdout is empty.
    - Add a second scenario: `gtd format does-not-exist.md` exits 0 and writes a
      single warning to stderr.

    Follow `AGENTS.md`: compose existing Given steps where possible; new steps
    should be generic (e.g. `Given the file <path> contains:` followed by a
    fenced code block) and expose raw content in scenario text.

8.  **README.md** — short note that gtd ships a `format` subcommand using a
    fixed markdown style (parser markdown, printWidth 80, proseWrap always),
    that the main prompt instructs the agent to invoke it after editing
    `TODO.md` / `REVIEW.md`, and that the host repo's `.prettierrc` is
    intentionally ignored.

### Non-goals

- Formatting other markdown files in the host repo (e.g. README.md). The
  `format` subcommand will format whatever path it is given, but the prompt only
  instructs the agent to format gtd-owned files.
- Honouring host-repo prettier config (rejected for determinism).
- Installing git hooks in consumer repos.
- Running prettier automatically inside `main.ts` before `buildPrompt` —
  explicitly rejected in favour of the subcommand approach (see Answered
  Questions).

### Risks / mitigations

- **Agent forgets to run the subcommand**: mitigated by putting the instruction
  at the end of every editing step in every relevant prompt, and by phrasing it
  as a single concrete command line. Worst case the next gtd cycle still sees an
  unformatted file — acceptable, formatting is best-effort.
- **Bundle bloat**: prettier inlined into `scripts/gtd.js` adds a few MB.
  Acceptable; gtd is a dev tool, and the user has confirmed bundle size is not a
  concern.
- **Prettier major version drift**: pinning prettier in `dependencies` means one
  shipped style per gtd release. Document in README that upgrading gtd may
  reflow existing `TODO.md` files.

## Answered Questions

### Where in the gtd lifecycle should formatting happen?

**Recommendation:** Run formatting from inside the gtd script every time it is
invoked, **before** building the prompt. That way any prior agent action that
edited `TODO.md`/`REVIEW.md` is normalised the next time gtd runs, and the
formatted version is what subsequently gets committed. Doing it inside the
script (not via the agent prompt) keeps it deterministic and reuse-free — no
prompt-engineering required.

Alternative considered: emit a "now run prettier on TODO.md" instruction inside
each prompt. Rejected — relies on the agent following instructions and on
prettier existing in the host repo.

**Answer:** The files should be specifically formatted before being handed off
to the user. The "now run prettier on TODO.md" instruction is right, but it has
to be a **subcommand of the `gtd` script** that bundles prettier and its
configuration, so there is no dependency on the host repo. Implement
`scripts/gtd.js format <file>` and update the prompts to invoke it after editing
`TODO.md` / `REVIEW.md`. Do **not** run prettier inline inside `main.ts` before
`buildPrompt`.

### How is the formatter bundled and what is the runtime dependency surface?

**Recommendation:** Add `prettier` as a regular `dependencies` entry in the gtd
`package.json` and import it programmatically
(`import prettier from "prettier"`) inside the script. tsup already inlines all
deps (`noExternal: [/.*/]`) into `scripts/gtd.js`, so prettier ships inside the
single bundled file and works regardless of the host repo's `node_modules`. The
host repo only needs Node 20+, which is already a stated requirement.

Alternative: shell out to `npx prettier` — rejected, depends on host repo.
Alternative: ship a hand-rolled markdown wrapper — rejected, won't match
`proseWrap: always` + `printWidth: 80` reliably.

Concern to watch: bundle size of prettier (~3MB unminified) inflates
`scripts/gtd.js`. Acceptable for a dev tool.

**Answer:** Bundle size is not a concern. Proceed with the recommendation.

### Which files get formatted, and with which prettier config?

**Recommendation:** Format only `TODO.md` and `REVIEW.md` at the repo root, and
only if they exist. Use a **hard-coded gtd-owned config**
(`{ parser: "markdown", printWidth: 80, proseWrap: "always" }`) rather than
resolving the host repo's `.prettierrc`. Reasoning:

- The host repo may not use prettier at all, or may have markdown rules that
  conflict with the structured `## Open Questions` /
  `<!-- user answers here -->` markers gtd relies on.
- gtd produces these files; gtd should own their style.
- Avoids surprising behaviour when the same TODO.md gets reflowed differently in
  two repos.

Alternative: respect host `.prettierrc` if present — rejected as
non-deterministic across consumer repos.

**Answer:** Agreed with the recommendation. Use the hard-coded config and ignore
host `.prettierrc`. The subcommand accepts any path, but the prompts will only
ever ask the agent to format `TODO.md` and `REVIEW.md` (including those inside
`.gtd/<package>/`).

### What about formatting errors or malformed markdown?

**Recommendation:** Catch any prettier error, write a single-line warning to
`stderr` (e.g. `gtd: skipped formatting TODO.md: <message>`), and continue.
Never abort the gtd run because formatting failed — the prompt output is the
contract, formatting is best-effort.

**Answer:** Agreed. The subcommand exits 0 even on formatter failure and logs a
single-line warning to stderr.
