# Automatic Markdown Formatting for TODO.md and REVIEW.md

Formatting must work in **any** project that uses the gtd skill, not just this
repo. The previous attempt installed a `.git/hooks/pre-commit` in this repo
only, which (a) does not propagate to consumer repos, (b) depends on the
consumer having `prettier` installed and discoverable via `npx`, and (c) is not
even tracked in git. The fix is to bundle formatting into the gtd script itself.

## Open Questions

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

<!-- user answers here -->

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

<!-- user answers here -->

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

<!-- user answers here -->

### What about formatting errors or malformed markdown?

**Recommendation:** Catch any prettier error, write a single-line warning to
`stderr` (e.g. `gtd: skipped formatting TODO.md: <message>`), and continue.
Never abort the gtd run because formatting failed — the prompt output is the
contract, formatting is best-effort.

<!-- user answers here -->

## Plan

### Goal

When `node scripts/gtd.js` runs in any repository, it normalises `TODO.md` and
`REVIEW.md` (if present) using a bundled prettier with a fixed markdown config,
before computing state and emitting the prompt.

### Changes

1. **`package.json`** — move `prettier` from `devDependencies` to `dependencies`
   so tsup bundles it into `scripts/gtd.js` and consumers using the published
   skill get a working formatter. (Dev-time prettier scripts `format` /
   `format:check` keep working unchanged.)

2. **`src/Format.ts` (new)** — small module exposing a `formatGtdFiles` Effect
   that:
   - Resolves `TODO.md` and `REVIEW.md` relative to cwd
   - For each that exists, reads the file, runs
     `prettier.format(content, { parser: "markdown", printWidth: 80, proseWrap: "always" })`,
     and writes back only if the result differs (avoids needless mtime churn)
   - Catches per-file errors, logs a single warning to stderr, continues
   - Uses `FileSystem` from `@effect/platform` (same as `State.ts`)

3. **`src/main.ts`** — invoke `formatGtdFiles` after `detect(refArg)` and before
   `buildPrompt(state)` so the State already reflects the formatted files when
   prompts (or the `git diff HEAD` they embed) are produced. Rationale for
   ordering: `detect()` reads `git status` and file contents; formatting before
   detect would dirty the working tree in a way that `state.diff` then shows
   reformatting noise inside the prompt. Placing it **after** detect means:
   detect sees the user's raw edits, then we format on disk so the _next_ gtd
   cycle (and the commit the agent makes) sees the formatted form. The prompt
   itself is unchanged for this cycle.

   Decision to confirm in the first Open Question: format pre-detect vs
   post-detect. Default chosen: **post-detect, pre-prompt** — agent's next
   commit ends up formatted, current diff stays readable.

4. **`tsup.config.ts`** — no change needed; `noExternal: [/.*/]` already inlines
   prettier. Verify bundle still builds and `scripts/gtd.js` runs.

5. **Remove the now-redundant local hook artefact:**
   - Delete `.git/hooks/pre-commit` from this clone (it is untracked, so this is
     purely a cleanup note — no committed change)
   - Remove `TODO.md` from `.prettierignore` if it is still listed (verify;
     current `.prettierignore` appears empty)

6. **Tests** — add a cucumber.js scenario under `tests/integration/` that:
   - Creates a temporary repo
   - Writes an intentionally unformatted `TODO.md` (e.g. single very long line)
   - Runs the bundled `scripts/gtd.js`
   - Asserts `TODO.md` on disk is now wrapped to 80 cols
   - Asserts the script exits 0 and stdout still contains a prompt

   Reuse existing Given/When/Then composable steps from `tests/integration/`;
   add a new generic Given like `Given TODO.md contains:` followed by a code
   block with the raw content.

7. **README.md** — short note that gtd auto-formats `TODO.md` and `REVIEW.md`
   with a fixed markdown style (80 col, prose wrap), no host config required.

### Non-goals

- Formatting other markdown files in the host repo (e.g. README.md). Out of
  scope; gtd should only touch files it owns.
- Honouring host-repo prettier config (rejected above for determinism).
- Installing git hooks in consumer repos.

### Risks / mitigations

- **Bundle bloat**: prettier inlined into `scripts/gtd.js` adds a few MB.
  Acceptable; gtd is a dev tool.
- **Prettier major version drift**: pinning prettier in `dependencies` means one
  shipped style per gtd release. Document in README that upgrading gtd may
  reflow existing TODO.md files.
- **Formatting clobbers in-flight agent edits**: mitigated by running only at
  gtd entry, never between detect and prompt-output.

## Answered Questions
