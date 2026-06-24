---
status: grilling
---

# Remove committed scripts/gtd.js via GitHub Releases launcher shim

`scripts/gtd.js` is an 18.5 MB bundled binary committed directly to the repo.
The goal is to remove it from git tracking entirely, replacing it with a tiny
launcher shim that downloads the prebuilt binary from GitHub Releases on first
use.

## Open Questions

### What entrypoint name does the agent invoke — `scripts/gtd.js` (shim replaces it) or a new `scripts/run.mjs`?

The bundled prompts (`src/prompts/new-todo.md`, `modified-todo.md`,
`review-process.md`, `human-review.md`) instruct the agent to run
`node scripts/gtd.js format <file>` and explicitly say "use the **same**
`scripts/gtd.js` path you invoked to get this prompt." SKILL.md also tells the
agent to run `node scripts/gtd.js`. If the skill is invoked via a differently
named shim (`scripts/run.mjs`) but the binary downloads to `scripts/gtd.js`,
then the entrypoint the user invokes and the `format` path the prompts reference
diverge — and the `format` subcommand would re-trigger the shim's download check
on a path that is now the real binary (harmless but confusing), OR break if the
prompts keep pointing at a path that no longer is the entrypoint.

**Recommendation:** Make the **shim itself live at the invoked path the
ecosystem already knows**, and have it download the real binary to a _different_
filename so the two never collide. Concretely:

- Keep the user/agent-facing entrypoint as **`scripts/gtd.js`** = the shim
  (small, committed, no deps). It downloads the real bundle to a sibling like
  **`scripts/gtd.bundle.mjs`** (gitignored) and execs that.
- Build output (tsup `outDir`) changes from `scripts/gtd.js` to
  `scripts/gtd.bundle.mjs` so `npm run build` produces the bundle, not the shim.
  This avoids tsup's `clean: true` wiping the committed shim.
- The release asset is the bundle file; the shim downloads it on first run.
- Net effect: **SKILL.md and all `src/prompts/*.md` need NO path changes** —
  `node scripts/gtd.js` and `node scripts/gtd.js format <file>` keep working
  verbatim. The original sketch's "rename to run.mjs + edit SKILL + edit
  prompts" is avoided entirely, and the "same path you invoked" guarantee in the
  prompts stays true.

This is the single most consequential decision — it determines whether step 3
(edit SKILL.md) and an unlisted step (edit 4 prompt files) are needed at all.
Please confirm the shim-at-`scripts/gtd.js` approach, or say if you specifically
want the new `scripts/run.mjs` filename (in which case prompts + SKILL + README
line 65 all need rewrites and the "same path" wording must change).

<!-- user answers here -->

### Should the shim resolve/download relative to its own dir, given tsup `clean: true`?

tsup builds with `clean: true` into `scripts/`, which wipes the whole directory
on every local `npm run build`. If the shim lives in `scripts/`, a local build
deletes it.

**Recommendation:** Change tsup `outDir` to a path that is NOT `scripts/` for
the bundle to avoid the wipe risk, OR (simpler) keep `outDir: "scripts"` but set
the entry filename to `gtd.bundle` and accept that `clean` only removes prior
build output — note `clean: true` removes the _entire_ outDir, so the committed
shim WOULD be deleted. Therefore: set tsup `outDir` to `dist/` (already
gitignored) producing `dist/gtd.bundle.mjs`, and have the release workflow
upload `dist/gtd.bundle.mjs`. The shim downloads into `scripts/` (or a cache
dir) at runtime. This keeps `clean: true` safe and keeps the committed shim
untouched by builds.

Confirm whether the runtime download target should be inside `scripts/`
(co-located, simple) or an OS cache dir like `~/.cache/gtd/` (cleaner, survives
reinstall, but the shim must compute version). Recommend **`scripts/`
co-located** for v1 simplicity since the skill dir is per-install.

<!-- user answers here -->

### How does the shim pin a version, given no releases/tags exist yet?

`gh release list -R pmelab/gtd` is empty and there are no git tags. The sketch
uses `releases/latest/download/gtd.js`. With `latest`, a freshly installed shim
from skill commit X may download a bundle built from a newer/older commit Y —
prompt/CLI drift between shim expectations and bundle behavior.

**Recommendation:** For v1, accept `latest` (the shim is a thin exec wrapper
with no contract beyond "run node on the bundle", so drift is low risk) BUT
embed the package version into the shim at build/commit time is overkill.
Simplest correct approach: the shim hardcodes the **pinned tag** matching the
repo version (e.g. read `version` is not available without the bundle).
Recommend the shim fetch `releases/latest/download/<asset>` for now and revisit
pinning once the release cadence exists. The first release tag must be created
manually (`git tag v0.1.0 && git push --tags`) to bootstrap, since the workflow
triggers on `v*` tags. Confirm `latest` is acceptable for v1.

<!-- user answers here -->

## Plan

### 1. Launcher shim (`scripts/gtd.js`)

Replace the committed 18.5 MB bundle at `scripts/gtd.js` with a tiny,
dependency-free Node shim (this is the entrypoint the skill + all bundled
prompts already invoke). The shim:

- Resolves paths relative to its own dir (`import.meta.dirname`), never cwd.
- Locates the real bundle at `scripts/gtd.bundle.mjs` (gitignored).
- If the bundle is absent, downloads it from
  `https://github.com/pmelab/gtd/releases/latest/download/gtd.bundle.mjs` using
  built-in `fetch` (Node 20+), writes it atomically (temp file + rename), and
  `chmod +x`.
- Imports/execs the bundle, forwarding `process.argv` (incl. the `format`
  subcommand), env, and cwd unchanged.
- Works offline once the bundle is present.
- On download failure: clear stderr message with the manual fallback URL and the
  `npm run build` instruction; exit non-zero.

> NOTE: The shim must transparently handle the `format <file>` subcommand the
> prompts emit — same entrypoint, just different argv.

### 2. Build config (`tsup.config.ts`)

- Change `entry` to produce the bundle under a non-`scripts/` outDir to avoid
  `clean: true` deleting the committed shim. Recommend `outDir: "dist"`,
  `entry: { "gtd.bundle": "src/main.ts" }` → `dist/gtd.bundle.mjs`.
- Keep the shebang banner on the bundle.
- For local dev convenience, optionally have a postbuild copy
  `dist/gtd.bundle.mjs` → `scripts/gtd.bundle.mjs` so a local `npm run build`
  makes the shim work immediately without a network round-trip.

### 3. CI release workflow (`.github/workflows/release.yml`)

Triggers on `v*` tags:

- Reuse the existing `Test` workflow via `workflow_call` (it already declares
  `workflow_call:`).
- `npm install` + `npm run build` → `dist/gtd.bundle.mjs`.
- `gh release create "$GITHUB_REF_NAME"` and upload `dist/gtd.bundle.mjs` as
  asset `gtd.bundle.mjs`.
- Needs `permissions: contents: write` for `gh release create`.

### 4. Untrack and ignore the bundle

- `git rm --cached scripts/gtd.js` is NOT needed if step 1 keeps a (small) shim
  at that path — instead `scripts/gtd.js` stays tracked but is now the shim.
- Add `scripts/gtd.bundle.mjs` (and `scripts/gtd.bundle.mjs.tmp`) to
  `.gitignore`.
- Update `.prettierignore` / `.gitattributes`: move the `scripts/gtd.js` entries
  to `scripts/gtd.bundle.mjs` (the generated artifact is now the bundle; the
  shim is hand-written and SHOULD be formatted/diffed).

### 5. Integration tests (`tests/integration/support/world.ts`)

`GTD_BIN` points at `scripts/gtd.js`. With the shim approach this still works,
but the shim would attempt a network download in CI/test if the bundle is
absent.

- Add a `pretest:e2e` (or CI step) running `npm run build` + copy so
  `scripts/gtd.bundle.mjs` exists before tests run — keeps tests offline and
  deterministic.
- The commented-out e2e step in `test.yml` (lines 33–34) must add the build step
  before being re-enabled (out of scope to re-enable unless desired).

### 6. SKILL.md / prompts

With the shim-at-`scripts/gtd.js` approach (pending Q1), **no changes needed** —
all references to `node scripts/gtd.js` remain correct. If Q1 chooses `run.mjs`,
then SKILL.md (lines 25, 28), README line 65, and four prompt files
(`new-todo.md`, `modified-todo.md`, `review-process.md`, `human-review.md`) all
need path + "same path you invoked" rewrites.

### 7. README

Update:

- Line 493:
  `npm run build  # tsup → dist/gtd.bundle.mjs (downloaded on first use)`
- Line 507–508: replace "committed to the repo so the skill installs zero-step"
  with the new flow — the bundle is downloaded automatically from GitHub
  Releases on first invocation, or built locally via `npm run build`.
- Add a short "Releasing" note: tag `vX.Y.Z`, push, CI builds + uploads the
  bundle.

### Affected files (count for status)

`scripts/gtd.js` (shim), `scripts/gtd.bundle.mjs` (new, ignored),
`tsup.config.ts`, `.github/workflows/release.yml` (new), `.gitignore`,
`.prettierignore`, `.gitattributes`, `tests/integration/support/world.ts`,
`package.json` (pretest:e2e), `README.md` — 10 files (more if Q1 picks
`run.mjs`). This is a `complete` (>5 files) plan, not `simple`.

## Resolved
