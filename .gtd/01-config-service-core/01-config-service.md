# Task: ConfigService core (schema, walk, merge, resolve) + unit tests

Create the new `ConfigService` Effect service in `src/Config.ts` plus its unit
test `src/Config.test.ts`. This task owns BOTH files — they are tightly coupled
(TDD impl + test) so they live in one task.

This is the foundation. Nothing consumes it yet; the package is green because
its own unit tests pass and no existing test is touched. Later packages wire it
into `TestRunner` (package 02) and `buildPrompt` (package 03).

## What to build

A `Context.Tag` + `static Live = Layer.effect(...)` service that mirrors the
shape of `GitService` (`src/Git.ts:42-43`) and `TestRunner`
(`src/TestRunner.ts:15-16`) exactly: a `Context.Tag("ConfigService")` class with
a `static Live` Layer, validated with `effect/Schema`.

### Schema (`effect/Schema`)

Decode the merged plain object into a `Config`. Spec (from `TODO.md`):

```yaml
testCommand: "npm run test"
models:
  planning: "claude-opus-4-8"
  execution: "claude-sonnet-4-8"
  states:
    new-todo: "claude-opus-4-8"
    modified-todo: "claude-opus-4-8"
    decompose: "claude-opus-4-8"
    execute: "claude-sonnet-4-8"
    execute-simple: "claude-sonnet-4-8"
```

- `testCommand`: optional string. When absent after merge, the service resolves
  it to the built-in default `"npm run test"`.
- `models`: optional struct.
  - `models.planning`: optional string.
  - `models.execution`: optional string.
  - `models.states`: optional struct accepting EXACTLY these 5 keys, each an
    optional string: `new-todo`, `modified-todo`, `decompose`, `execute`,
    `execute-simple`. Unknown keys (e.g. `fix-tests`) MUST be rejected with a
    readable error (do NOT silently strip — use a closed/strict struct so decode
    fails on extra keys).
- Model-name values are free-form strings, injected verbatim — NO allowlist.

### Walk + merge

The service must:

1. Enumerate the directory chain from `process.cwd()` walking UP the tree.
   - stopDir is the user's home dir (`os.homedir()`), INCLUSIVE — i.e. include
     home in the chain when it is an ancestor of cwd.
   - **Critical edge case (must handle):** when cwd is NOT under home (e.g. a
     temp dir like `/var/folders/...` on macOS, which is where the e2e/unit
     tests create repos), home is never reached. The walk must therefore also
     terminate at the filesystem root. Implement the stop condition as: stop
     after including home OR after reaching the filesystem root, whichever comes
     first. This keeps the service testable from temp dirs and matches the
     worktree-parent use case.
2. Build a cosmiconfig explorer with module name `gtd` and `searchPlaces`:
   `.gtdrc`, `.gtdrc.json`, `.gtdrc.yaml`, `.gtdrc.yml`, `gtd.config.json`,
   `gtd.config.yaml`. Do NOT register `.js`/`.cjs` loaders (keeps the bundle
   free of a runtime evaluator). Back the YAML loader with the already-present
   `yaml` dep (`import { parse } from "yaml"`) via a custom loader for the
   `.yaml`/`.yml`/no-extension (`.gtdrc`) places. JSON places use a JSON loader.
3. Run the explorer's per-directory load/search at each level of the chain (do
   NOT use a single `search()` call — cosmiconfig's `search()` stops at the
   first match; we need every hit). Collect every found config object.
4. Deep-merge all found levels low→high so the INNERMOST (cwd) wins. Precedence
   top→bottom: `home < ...ancestors... < worktree parent < repo root < cwd`. A
   small hand-rolled recursive deep-merge over plain objects is fine (objects
   merge recursively; scalars/arrays from the inner level overwrite).
5. Decode the merged object via `effect/Schema`. On decode failure, fail the
   Effect with a readable error message (so `main.ts`'s existing
   `Effect.catchAll` surfaces it).

### Exposed operations

Expose a resolved interface:

```ts
interface ConfigOperations {
  readonly testCommand: string
  readonly resolveModel: (state: ModelState) => string
}
```

where `ModelState` is the union of the 5 subagent-spawning states
(`"new-todo" | "modified-todo" | "decompose" | "execute" | "execute-simple"`).

- `testCommand`: the merged value, or `"npm run test"` if unset.
- `resolveModel(state)`: resolution order per state:
  1. `models.states[state]` if set;
  2. else the tier default for that state — planning for `new-todo`,
     `modified-todo`, `decompose`; execution for `execute`, `execute-simple`;
     reading `models.planning` / `models.execution` if set;
  3. else the built-in tier default: planning → `claude-opus-4-8`, execution →
     `claude-sonnet-4-8`.

Export the tier mapping (state→tier) so package 03 can reuse it if helpful, but
keep `resolveModel` the single source of truth for resolution.

## Constraints / edge cases

- Mirror the `GitService`/`TestRunner` Context.Tag + `static Live` pattern
  precisely (per repo AGENTS.md "Context tag + static layer" rule).
- The walk must be deterministic and not throw when a level has no config.
- Must bundle cleanly into the single `scripts/gtd.js` later — no dynamic
  `require` of user files, no `.js`/`.cjs` cosmiconfig loaders.
- Do NOT touch `package.json` here — the cosmiconfig dependency is added by the
  sibling task `02-add-cosmiconfig-dep.md` in this same package. You may import
  from `cosmiconfig` assuming it is present.
- Do NOT wire this into `main.ts`, `TestRunner`, or `buildPrompt` in this
  package (those are later packages). Keep the surface self-contained.

## Unit tests (`src/Config.test.ts`)

Follow the `src/TestRunner.test.ts` pattern (mkdtemp under `tmpdir()`, chdir,
restore in afterEach). Cover:

- [ ] No config file anywhere ⇒ `testCommand === "npm run test"` and
      `resolveModel` returns the built-in tier defaults (Opus for planning
      states, Sonnet for execution states).
- [ ] A single `.gtdrc.yaml` in cwd sets `testCommand` and it is read back.
- [ ] Merge precedence: a config at an ancestor temp dir AND one in cwd both
      found; cwd value wins for overlapping keys; non-overlapping keys from the
      ancestor still appear (proves merge-all-levels, innermost-wins). Build the
      chain entirely under `tmpdir()` so home is never reached and the
      root-stop path is exercised.
- [ ] `resolveModel` precedence: `models.states.<state>` beats its tier; tier
      beats built-in default; built-in default applies when nothing set.
- [ ] An unknown key under `models.states` (e.g. `fix-tests`) makes decode fail
      with a readable error (the Effect fails).
- [ ] JSON (`gtd.config.json`) and YAML (`.gtdrc.yaml`) loaders both work.

## Acceptance criteria

- [ ] `src/Config.ts` exports a `ConfigService` Context.Tag class with
      `static Live` Layer, mirroring `GitService`/`TestRunner`.
- [ ] Schema rejects unknown `models.states` keys with a readable error.
- [ ] Walk goes cwd→up, stopping at home (inclusive) OR filesystem root.
- [ ] Merges all found levels, innermost (cwd) wins.
- [ ] `testCommand` defaults to `"npm run test"`; `resolveModel` resolves
      state→tier→built-in (Opus/Sonnet).
- [ ] `src/Config.test.ts` covers the cases above and passes under
      `npm run test`.
- [ ] `npm run test` (vitest) is fully green; no existing test changed.

## Files

- Create: `src/Config.ts`, `src/Config.test.ts`
- Mirror: `src/Git.ts`, `src/TestRunner.ts`, `src/TestRunner.test.ts`
- Spec: `TODO.md` (schema, walk, merge, resolution table, defaults sections)
