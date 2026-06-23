---
status: grilling
---

## Open Questions

### Which config library: cosmiconfig (tree-walk) or c12 (workspace + home)?

**Recommendation: cosmiconfig.** The sketch explicitly wants merge across three
levels — project file, a _parent directory_, and the user directory. The two
serious candidates split exactly on this:

- **cosmiconfig** walks _up the directory tree_ from cwd to the OS root by
  default, looking for the first match at each level. This is the canonical
  "search parent directories" behavior the sketch describes. It does NOT merge
  multiple found files out of the box — it stops at the first hit — and it does
  NOT read the user home dir as a separate layer. We would add (a) an explicit
  user-home search and (b) a merge step ourselves.
- **c12** merges layers via `defu` automatically, but its multi-location search
  is the _rcFile_ mode: it reads `.gtdrc` from the **workspace root + home dir
  only** — it does not do an arbitrary cwd→root parent-directory walk for the
  main config file. So c12 gives merge-for-free but not the parent-dir-walk the
  sketch asked for.

Neither does _both_ the parent-walk AND the home-dir-merge out of the box, so we
write a thin resolver either way. I recommend cosmiconfig because the
parent-directory walk is the harder behavior to reproduce and cosmiconfig nails
it, the merge step is trivial (`defu` or a hand-rolled deep-merge over 2–3 plain
objects), and cosmiconfig is the most battle-tested option with the smallest
surface. Bundling concern: this repo inlines _everything_ into one
`scripts/gtd.js` via tsup `noExternal: [/.*/]` (see `tsup.config.ts`).
cosmiconfig is ESM-friendly and has been bundled into single files widely;
c12/unjs pulls a larger dependency cloud (confbox, defu, rc9, jiti, dotenv,
giget) which inflates the bundle. **Open for the user**: do you prefer
cosmiconfig (smaller, we own the merge+home layer) or c12 (heavier, merge for
free but rcFile-style location only)? My vote: cosmiconfig.

<!-- user answers here -->

### Exactly which directories form the search/merge chain, and precedence?

**Recommendation:** three layers, project/cwd wins:

1. **User layer** — `~/.config/gtd/config.{json,yaml}` (XDG) or `~/.gtdrc`.
2. **Parent-dir layer(s)** — first config found walking from cwd up to the repo
   root / filesystem root (cosmiconfig's default search).
3. **Project layer** — config found in cwd (the innermost match in the walk).

Precedence: **project > parent > user** (deep-merge, innermost overrides).
**Open for the user — two sub-questions:** (a) Should the parent-dir walk stop
at the git repo root, or continue all the way to `/`? I lean _stop at repo root_
to avoid surprising leakage from unrelated ancestor dirs. (b) When the walk
finds configs at multiple levels (e.g. cwd _and_ a parent), do we merge ALL of
them or just the innermost? I lean **merge all levels found** (matches "in the
current project file" _and_ "in a parent directory" being listed separately).

<!-- user answers here -->

### Should per-state model overrides be supported, or just the two tiers?

**Recommendation: two tiers only (`models.planning`, `models.execution`).** The
codebase has exactly two model tiers today — "planning model" and
"execution/work model" — referenced verbatim across `src/prompts/header.md`,
`decompose.md`, `new-todo.md`, `modified-todo.md`, `execute.md`,
`execute-simple.md`. There is no per-leaf model concept anywhere. Adding
per-state keys (e.g. one model per `LeafState`) would be speculative
gold-plating. **Open for the user:** confirm two tiers is enough, or do you want
a per-phase escape hatch (e.g. `models.decompose`) for later?

<!-- user answers here -->

### Does structured config replace, supplement, or override the AGENTS.md model prose?

**Recommendation: structured config takes precedence; AGENTS.md prose remains
the advisory fallback.** Today every model decision is prompt text telling the
agent to "check your user/project AGENTS.md for model preferences" (e.g.
`src/prompts/decompose.md:9-11`). The cleanest contract: when a `models.*` value
is set in config, gtd injects the concrete model name into the emitted prompt
(structured, deterministic); when unset, the prompt keeps the current "check
AGENTS.md, else default to Opus/Sonnet" prose. This avoids a hard breaking
change to existing AGENTS.md-only setups while making config authoritative when
present. **Open for the user:** OK to keep AGENTS.md prose as the documented
fallback, or do you want config to fully replace it (and update SKILL.md to drop
the AGENTS.md model-preferences section)?

<!-- user answers here -->

---

## Plan: configuration system for gtd

A hierarchical config system letting users set values at user and project level,
merged across the directory tree. Two configurable concerns to start:

1. **`testCommand`** — replaces the hardcoded `npm run test`.
2. **`models.planning` / `models.execution`** — concrete model names that today
   live only as advisory prose in AGENTS.md.

### Current state (grounded in the code)

- **Test command** is hardcoded at `src/TestRunner.ts:27`:
  `Command.make("npm", "run", "test")`. `TestRunner` is an Effect `Context.Tag`
  service with a `static Live = Layer.effect(...)`; its `run()` returns
  `{ exitCode, output }` and is provided in `src/main.ts:50`. The two test-gated
  leaves (`human-review`, `execute`) call it in `src/main.ts:34-37`. Tests in
  `src/TestRunner.test.ts` assert the command is literally `npm run test`.
  AGENTS.md/README note the cap and test command are _deliberately
  non-overridable today_ — this plan intentionally makes `testCommand`
  overridable (the cap stays fixed).
- **Models** are pure prompt prose. Two tiers — planning vs execution/work —
  appear in `src/prompts/header.md:5-10`, `decompose.md:8-11`,
  `new-todo.md:19-22`, `modified-todo.md:22-25`, `execute.md:11-23`,
  `execute-simple.md:8-18`. All instruct the agent to read AGENTS.md and fall
  back to Opus (planning) / Sonnet (execution). Documented in `SKILL.md:45-63`
  and `SKILL.md:109-114`. No structured model value exists anywhere.
- **Effect/service pattern** to mirror: `GitService` (`src/Git.ts:42-43`) and
  `TestRunner` (`src/TestRunner.ts:15-16`) — `Context.Tag` + `static Live`
  layer, wired with `Effect.provide` in `main.ts`. The repo's own AGENTS.md
  mandates the "Context tag + static layer" pattern for mode flags
  (`QuietMode`), which this config service should follow.
- **Build**: `tsup.config.ts` inlines all deps into one `scripts/gtd.js`
  (`noExternal: [/.*/]`, ESM, node20, `.md` files loaded as text). Whatever
  library we pick MUST bundle cleanly into that single file. `yaml@^2.8.2` is
  already a devDep (free YAML support if we want it).
- **No config library is currently installed** (checked `package.json` deps).

### Proposed config schema

```yaml
# gtd config (project, parent, or user level)
testCommand: "npm run test" # string; tokenized into argv for Command.make
models:
  planning: "claude-opus-4" # injected where prompts say "planning model"
  execution: "claude-sonnet-4"
```

- `testCommand`: a single string. Needs tokenizing into `[cmd, ...args]` for
  `Command.make` (current code splits manually as `"npm","run","test"`). Use a
  minimal shell-style split, or document that it is run via the user's shell —
  **decide during implementation** (a naive `.split(" ")` breaks on quoted args;
  prefer a tiny tokenizer or `sh -c <string>`).
- `models`: optional object; either tier may be omitted (falls back to current
  prompt defaults / AGENTS.md prose).
- All keys optional. Missing config file ⇒ all defaults.

### Defaults / backward compatibility

- No config file anywhere ⇒ `testCommand` defaults to `"npm run test"`
  (preserves today's behavior and keeps `src/TestRunner.test.ts` green).
- `models.*` unset ⇒ prompts keep the existing "check AGENTS.md, else
  Opus/Sonnet" prose. Existing AGENTS.md-only repos keep working unchanged.

### Validation

**Recommend `effect/Schema`** — this is an Effect codebase and Schema gives
typed decode + clear errors that flow through the Effect graph. Decode the
merged plain object into a `Config` type, defaulting missing fields. Invalid
config fails the program with a readable message via the existing
`Effect.catchAll` in `main.ts:52`.

### Integration points

1. **New `ConfigService`** (`src/Config.ts`): `Context.Tag` + `static Live`
   layer that (a) loads + merges config across levels via the chosen library,
   (b) decodes via `effect/Schema`, (c) exposes
   `{ testCommand: string; models: { planning?: string; execution?: string } }`.
   Follow the `GitService` shape.
2. **`TestRunner`** (`src/TestRunner.ts`): depend on `ConfigService`, read
   `testCommand`, tokenize, and pass to `Command.make` instead of the hardcoded
   literal. Update `src/TestRunner.test.ts` to cover the configured-command path
   and keep the default-path assertion. Update the `npm run test` comment.
3. **`main.ts`**: add `Effect.provide(ConfigService.Live)` to the layer stack
   (`src/main.ts:48-58`).
4. **Prompts**: thread resolved `models.planning` / `models.execution` into the
   emitted prompt. Since prompts are static `.md` imported as text
   (`src/Prompt.ts:1-16`), the cleanest path is for `buildPrompt`
   (`src/Prompt.ts:131`) to take the config and substitute/append concrete model
   names where the tier is set, leaving the AGENTS.md-fallback prose when unset.
   Touch `header.md` + the planning/execution prompts.
5. **Docs**: update `README.md` and `SKILL.md` (model config + test command
   sections) to document the config file, schema, precedence, and that
   `testCommand` is now overridable. (Per global instructions: reflect the
   change in the README.)
6. **Cucumber scenarios** (`tests/integration/`): add composable Given steps —
   e.g. "Given a gtd config file with content `...`" at user/parent/project
   level — and scenarios proving precedence/merge, a custom `testCommand`
   reaching the runner, and model names appearing in prompts. Follow AGENTS.md
   testing conventions (small reusable Given steps, real file content in
   scenario text, one step per commit).

### Rough implementation outline

1. Add chosen library to `dependencies`; verify it bundles into `scripts/gtd.js`
   (`npm run build`, then run the bundled CLI).
2. Define `effect/Schema` `Config` schema + defaults.
3. Implement `ConfigService` (load → merge → decode).
4. Wire into `main.ts`; make `TestRunner` consume `testCommand`.
5. Thread `models.*` into `buildPrompt` / prompt text.
6. Update docs (README, SKILL.md) and AGENTS.md if conventions change.
7. Add cucumber scenarios + unit tests.

## Resolved
