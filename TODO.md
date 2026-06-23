---
status: complete
---

## Plan: configuration system for gtd

A hierarchical config system letting users set values across the directory tree,
merged with innermost (cwd) winning. Two configurable concerns to start:

1. **`testCommand`** — replaces the hardcoded `npm run test`.
2. **`models`** — two base tiers (`planning`, `execution`) plus optional
   per-state overrides; today these live only as advisory prose in AGENTS.md and
   are being moved into structured config entirely.

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
- **Models are pure prompt prose**, and gtd never invokes a model — it only
  writes prompt text to stdout (`src/main.ts:40,45`), which a human or outer
  agent reads and acts on. So model config is realized purely by substituting a
  concrete model name into the emitted prompt text (see "Model injection
  mechanism" below). Two tiers — planning vs execution/work — appear in
  `src/prompts/header.md:5-10`, `decompose.md:8-11`, `new-todo.md:19-22`,
  `modified-todo.md:22-25`, `execute.md:11-23`, `execute-simple.md:8-18`. All
  instruct the agent to read AGENTS.md and fall back to Opus (planning) / Sonnet
  (execution). Documented in `SKILL.md:45-63` and `SKILL.md:109-114`, and
  `README.md:123-129`. No structured model value exists anywhere.
- **Which prompts actually SPAWN a subagent** (verified by reading the prompt
  files — this is the set that gets a per-state override key, per the user's
  answer 1b "only the prompts that actually invoke subagents"):
  - `new-todo.md:19` — "Spawn a **planning-model subagent**" → SPAWNS (planning)
  - `modified-todo.md:22` — "Spawn a **planning-model subagent**" → SPAWNS
    (planning)
  - `decompose.md:8` — "Spawn a **planning-model subagent**" → SPAWNS (planning)
  - `execute.md:18-21` — "Spawn **one subagent per task** … launch a **parallel
    subagent**" → SPAWNS (execution, parallel workers)
  - `execute-simple.md:16,34` — "Spawn ONE **execution-model subagent**"
    (Step 1)
    - a testing subagent (Step 2) → SPAWNS (execution). NOTE: the README phrase
      "implements directly without decomposition" means it skips the
      **work-package decomposition**, not that it skips subagents — it still
      spawns an implementation worker and a testing subagent, so it is
      **INCLUDED**.
  - `fix-tests.md` — NO subagent spawn anywhere; the fix loop runs **inline in
    the work model** ("Make exactly ONE fix, then re-run the tests"). Therefore
    `fix-tests` is **EXCLUDED** from the per-state override set per answer 1b.
  - `header.md` — shared boilerplate, not a per-state spawn site. So the
    per-state override set is exactly **5** states: `new-todo`, `modified-todo`,
    `decompose`, `execute`, `execute-simple`.
- **LeafStates** (`src/Machine.ts:91-105`, 14 total): `close-review`,
  `review-process`, `await-review`, `code-changes`, `execute`, `cleanup`,
  `decompose`, `execute-simple`, `escalate`, `new-todo`, `modified-todo`,
  `await-answers`, `human-review`, `verified`. Only the **5** subagent-spawning
  states above carry a model directive that the config injects; the `fix-tests`
  override prompt names the test command but spawns no subagent, and the other 9
  states are model-agnostic.
- **Effect/service pattern** to mirror: `GitService` (`src/Git.ts:42-43`) and
  `TestRunner` (`src/TestRunner.ts:15-16`) — `Context.Tag` + `static Live`
  layer, wired with `Effect.provide` in `main.ts`. The repo's own AGENTS.md
  mandates the "Context tag + static layer" pattern, which this config service
  should follow.
- **Build**: `tsup.config.ts` inlines all deps into one `scripts/gtd.js`
  (`noExternal: [/.*/]`, ESM, node20, `.md` files loaded as text). cosmiconfig
  MUST bundle cleanly into that single file. `yaml@^2.8.2` is already a devDep
  (free YAML support). Skip cosmiconfig's `.js`/`.cjs` loaders so we don't pull
  a runtime evaluator into the bundle.
- **No config library is currently installed** (checked `package.json` deps).

### Config library: cosmiconfig (decided)

cosmiconfig nails the cwd→ancestors parent-directory walk, is the most
battle-tested option with the smallest surface, and bundles cleanly into the
single `scripts/gtd.js`. It does not merge multiple found files or read a
separate home layer out of the box — but with the unified continuous-walk design
below (home dir is just the top of the same walk), we drive cosmiconfig's
`search()` ourselves and deep-merge every level we find.

### Search / merge chain (decided)

The walk must NOT stop at the git root. The driving use case: **multiple
worktrees of the same project living in one shared parent directory that is not
itself a git root.** A `.gtdrc` placed in that shared parent must cascade to
every checkout under it automatically. Therefore:

- Walk from **cwd up the directory tree, continuing past the git root**, up to
  and including a `stopDir`.
- **stopDir = the user's home dir** (cosmiconfig's default). This unifies what
  the earlier sketch called the "separate user layer" with the walk: a
  `~/.gtdrc` is simply the topmost level of the same continuous search. (Open
  question above flags the edge case where the worktree parent lives outside
  home; if confirmed, stopDir becomes `/`.)
- **Merge ALL levels found**, not just the innermost. Deep-merge with
  **innermost (cwd) winning**. So precedence top→bottom is:
  `home (~/.gtdrc) < ...intermediate ancestors... < shared worktree parent < project repo root < cwd`.
- cosmiconfig's `search()` stops at the _first_ match per its own logic, so we
  do not use a single `search()` call. Instead we enumerate the directory chain
  from cwd up to stopDir and run cosmiconfig's `load`/`search` per directory (or
  use `cosmiconfigSync`/explicit `searchFrom` per level), collecting every hit,
  then deep-merge low→high. The merge step is trivial over plain objects
  (`defu`-style or a small hand-rolled deep-merge).

### Model injection mechanism

gtd emits prompt text only; it does not run models. A configured model name is
realized by **substituting the resolved name into the emitted prompt** as a
directive the outer agent/human is expected to honor (the same trust model the
current AGENTS.md prose already relies on, made deterministic — confirmed
acceptable by the user). `buildPrompt` (`src/Prompt.ts:131`) takes the resolved
`models` config and, for each of the **5 subagent-spawning** prompts, injects
the concrete name for that state. Prompts that spawn no subagent (`fix-tests`
and the other 9 states) carry no model directive and no injection.

### Model schema: two base tiers + per-state overrides (decided)

Two base tiers, `planning` and `execution`. Per-state override keys exist **only
for the 5 states whose prompts actually spawn a subagent** (per the user's
answer 1b). Each such state defaults to one of the two tiers and may be
overridden individually. There is **no** `fix-tests` override key (its prompt
runs inline, no subagent), and no keys for the other 9 model-agnostic states.

```yaml
testCommand: "npm run test"
models:
  planning: "claude-opus-4-8" # base tier: high-reasoning
  execution: "claude-sonnet-4-8" # base tier: everyday work
  states: # optional per-state overrides — ONLY the 5 subagent-spawning states
    new-todo: "claude-opus-4-8" # planning subagent; defaults to planning
    modified-todo: "claude-opus-4-8" # planning subagent; defaults to planning
    decompose: "claude-opus-4-8" # planning subagent; defaults to planning
    execute: "claude-sonnet-4-8" # parallel exec workers; defaults to execution
    execute-simple: "claude-sonnet-4-8" # exec + test subagents; defaults to execution
```

**Default tier mapping (the resolution table).** For each of the 5
subagent-spawning states, the resolved model is: `models.states.<state>` if set,
else its tier default below, else the built-in default for that tier.

| State            | Tier      | Spawns                            |
| ---------------- | --------- | --------------------------------- |
| `new-todo`       | planning  | planning-model subagent           |
| `modified-todo`  | planning  | planning-model subagent           |
| `decompose`      | planning  | planning-model subagent           |
| `execute`        | execution | one parallel worker per task      |
| `execute-simple` | execution | implementation + testing subagent |

`fix-tests` is intentionally absent: its prompt makes the fix **inline in the
work model** and spawns no subagent, so there is nothing to direct a model at.
The remaining 9 LeafStates (`cleanup`, `code-changes`, `escalate`,
`human-review`, `verified`, `review-process`, `close-review`, `await-review`,
`await-answers`) reference no model and get no injection.

- `models`, `models.planning`, `models.execution`, and every `models.states.*`
  key are all optional. `models.states` accepts only the 5 keys above; the
  schema rejects unknown keys (e.g. `fix-tests`) with a readable error.
- Resolution per state: `states.<state>` → tier value (`planning`/`execution`) →
  built-in default.
- Model-name value is a free-form string (concrete ID like `claude-opus-4-8` or
  alias like `opus`), injected verbatim — no allowlist validation (confirmed).

### Built-in defaults / backward compatibility

- No config file anywhere ⇒ `testCommand` defaults to `"npm run test"`
  (preserves today's behavior and keeps `src/TestRunner.test.ts` green).
- `models` entirely unset ⇒ built-in tier defaults still apply so behavior is
  fully defined with no config file: **planning tier → Opus**, **execution tier
  → Sonnet** (matching the model names the prompts currently name as fallbacks).
  These built-in defaults are baked into `ConfigService`, so the prompts no
  longer carry the "check AGENTS.md, else default to Opus/Sonnet" prose — gtd
  always injects a concrete tier model.

### Replacing the AGENTS.md model prose (decided: replace)

Structured config **replaces** the AGENTS.md model prose entirely. The prompts
must stop telling the agent to "check your user/project AGENTS.md for model
preferences." Instead `buildPrompt` injects the resolved concrete model name per
state. Concretely:

- **Edit the prompts to drop the AGENTS.md model directive.** The 5
  subagent-spawning prompts carry a placeholder filled by `buildPrompt` with the
  per-state resolved model; `header.md` drops its two-tier AGENTS.md prose
  (replaced by the concrete per-state injection downstream):
  - `src/prompts/header.md` (the general two-tier explanation, lines 5-10) —
    drop the "check AGENTS.md" prose; no per-state injection (shared
    boilerplate).
  - `src/prompts/new-todo.md` (lines 19-22) — inject `new-todo` model
    (planning).
  - `src/prompts/modified-todo.md` (lines 22-25) — inject `modified-todo` model
    (planning).
  - `src/prompts/decompose.md` (lines 8-11) — inject `decompose` model
    (planning).
  - `src/prompts/execute.md` (lines 11-23) — inject `execute` model (execution),
    used by the parallel task workers.
  - `src/prompts/execute-simple.md` (lines 8-18) — inject `execute-simple` model
    (execution), used by the implementation + testing subagents.
  - `src/prompts/fix-tests.md` — **NOT** edited for model injection: it spawns
    no subagent (inline fix loop), so it has no model directive to replace. It
    is only touched for the test-command note below.
- **Drop the model-preferences sections** from docs:
  - `SKILL.md` "Model configuration" (lines 45-63) and the model-preferences
    bullet under "Configuration via AGENTS.md" (lines 109-114) — replace with a
    pointer to the new config file.
  - `README.md` model-tier section (lines 123-129) and the inline "(planning
    model)" / "via AGENTS.md" notes (lines 66, 69, 89, 123-129) — update to
    reference the config file.
- Note: prompts still reference AGENTS.md / package.json scripts for the _test
  command_ in `close-review.md`, `verified.md`, `escalate.md`,
  `execute-simple.md:41`. Those are about test-command discovery, not models —
  out of scope for the model-prose removal, but the `testCommand` config now
  takes precedence over them; update those references to mention config first.

### Validation

**`effect/Schema`** — typed decode + clear errors flowing through the Effect
graph. Decode the merged plain object into a `Config` type, defaulting missing
fields. `models.states` is an optional struct with exactly the 5
subagent-spawning keys (`new-todo`, `modified-todo`, `decompose`, `execute`,
`execute-simple`), each an optional string; unknown keys (including `fix-tests`)
are rejected. Invalid config fails the program with a readable message via the
existing `Effect.catchAll` in `main.ts:52`.

### Integration points

1. **New `ConfigService`** (`src/Config.ts`, new file — does not exist yet):
   `Context.Tag` + `static Live` layer (mirroring `GitService`/`TestRunner`)
   that (a) builds a cosmiconfig explorer with module name `gtd` and
   `searchPlaces` = `.gtdrc`, `.gtdrc.json`, `.gtdrc.yaml`, `.gtdrc.yml`,
   `gtd.config.json`, `gtd.config.yaml` (no `.js`/`.cjs` loaders), with the YAML
   loader backed by the already-present `yaml` dep; (b) enumerates the directory
   chain from cwd up to and including **stopDir = the user's home dir**, runs
   the explorer's per-directory load at each level, collects every hit and
   deep-merges low→high (home < …ancestors… < worktree parent < repo root < cwd,
   innermost wins); (c) decodes the merged object via `effect/Schema`; (d)
   exposes resolved `{ testCommand: string; resolveModel(state): string }` where
   `testCommand` defaults to `"npm run test"` and `resolveModel` applies the
   per-state → tier → built-in-default resolution (built-in: planning → Opus,
   execution → Sonnet) for the 5 subagent-spawning states. New unit test
   `src/Config.test.ts` covering the merge precedence, defaults, and resolution.
2. **`TestRunner`** (`src/TestRunner.ts`): depend on `ConfigService`, read
   `testCommand`, tokenize, pass to `Command.make` instead of the hardcoded
   literal. Update `src/TestRunner.test.ts` to cover the configured-command path
   and keep the default-path assertion. Update the `npm run test` comment.
3. **`main.ts`**: add `Effect.provide(ConfigService.Live)` to the layer stack
   (`src/main.ts:48-58`). Thread the resolved config into `buildPrompt`.
4. **Prompts / `buildPrompt`** (`src/Prompt.ts:131`): accept the config (or a
   `resolveModel` fn) and substitute the concrete per-state model name into the
   5 subagent-spawning prompts, replacing the removed AGENTS.md prose: edit
   `new-todo.md`, `modified-todo.md`, `decompose.md`, `execute.md`,
   `execute-simple.md`, and drop the two-tier AGENTS.md prose from the shared
   `header.md`. `fix-tests.md` gets **no** model injection (inline fix, no
   subagent). Update `src/Prompt.test.ts` to assert the resolved per-state model
   name appears in each of the 5 prompts.
5. **Docs**: update `README.md` and `SKILL.md` — remove the AGENTS.md
   model-preferences sections, document the `.gtdrc` config file, schema
   (`testCommand`, `models.planning`/`execution`/`states.*`), the cwd→home
   cascade + worktree-parent use case, precedence (innermost wins), and that
   `testCommand` is now overridable. (Per global instructions: reflect the
   change in the README.)
6. **Cucumber scenarios** — new feature file under `tests/integration/features/`
   (e.g. `config.feature`) with step defs in `tests/integration/support/steps/`
   (alongside `common.steps.ts`, `review.steps.ts`, `formatting.steps.ts`) and
   any setup helper in `tests/integration/helpers/`. Composable Given steps —
   e.g. "Given a gtd config file at `<dir>` with content `...`" placed at
   home/worktree-parent/repo-root/cwd levels — and scenarios proving the
   cwd→home cascade and innermost-wins merge, a `.gtdrc` in a shared parent
   cascading to two worktrees, a custom `testCommand` reaching the runner, and
   per-state + tier model names appearing in the right prompt sections (incl. a
   per-state override beating its tier, and `fix-tests` carrying NO injected
   model). Follow AGENTS.md testing conventions (small reusable Given steps,
   real file content in scenario text, one step per commit).

### Rough implementation outline

1. Add `cosmiconfig` to `dependencies`; configure its YAML loader against the
   existing `yaml` dep and skip `.js`/`.cjs` loaders. Verify it bundles into
   `scripts/gtd.js` (`npm run build`, then run the bundled CLI). Confirm no
   `.js`-loader eval sneaks into the bundle.
2. Define `effect/Schema` `Config` schema (free-form model strings,
   `testCommand` default `"npm run test"`) + built-in tier defaults
   (Opus/Sonnet) + per-state resolution table for the 5 subagent-spawning
   states.
3. Implement `ConfigService` (enumerate cwd→home chain → load per level →
   deep-merge low→high → decode → expose `testCommand` + `resolveModel`) +
   `src/Config.test.ts`.
4. Wire `ConfigService.Live` into `main.ts`; make `TestRunner` consume
   `testCommand` and update `src/TestRunner.test.ts`.
5. Thread `resolveModel` into `buildPrompt`; rewrite the 5 subagent-spawning
   prompt files to use injected names instead of AGENTS.md prose, drop the
   header.md tier prose, and update `src/Prompt.test.ts`.
6. Update docs (README, SKILL.md); drop the AGENTS.md model-preferences sections
   and document the `.gtdrc` config file.
7. Add cucumber `config.feature` + step defs.

## Resolved

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

**Answer:** cosmiconfig is good.

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

**Answer:** Continue the walk outside the git root. The driving pattern is
multiple worktrees of the same project within one shared parent directory (not
itself a git root); a `.gtdrc` placed there should cascade to all checkouts
automatically. (Resolved into: walk cwd → home dir, merge all levels found,
innermost wins. The exact stopDir and edge case where the worktree parent lives
outside home are re-raised as open questions.)

### Should per-state model overrides be supported, or just the two tiers?

**Recommendation: two tiers only (`models.planning`, `models.execution`).** The
codebase has exactly two model tiers today — "planning model" and
"execution/work model" — referenced verbatim across `src/prompts/header.md`,
`decompose.md`, `new-todo.md`, `modified-todo.md`, `execute.md`,
`execute-simple.md`. There is no per-leaf model concept anywhere. Adding
per-state keys (e.g. one model per `LeafState`) would be speculative
gold-plating. **Open for the user:** confirm two tiers is enough, or do you want
a per-phase escape hatch (e.g. `models.decompose`) for later?

**Answer:** Make it two-tiered (planning, execution) plus per-state models that
each default to either of those two tiers. (Resolved into the
two-base-tiers-plus-`models.states.*`-overrides schema with the explicit default
tier mapping above.)

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

**Answer:** Replace. Structured config replaces the AGENTS.md model prose
entirely. (Resolved into: rewrite the 5 subagent-spawning prompts to inject
concrete names with built-in tier defaults baked into `ConfigService`, drop the
two-tier prose from `header.md`, and drop the model-preferences sections from
`SKILL.md` and `README.md`.)

### Are per-state model overrides actually actionable, given gtd only emits prompt text?

**Recommendation:** (1) prompt-text injection is the only available mechanism
(gtd just `process.stdout.write`s the prompt; no runner/SDK channel), and it
matches how the existing AGENTS.md prose already works — so it is acceptable;
(2) per-state granularity is only meaningful for the states whose prompts emit a
model directive.

**Answer:** (1) "yes that is good enough" — prompt-text injection is acceptable.
(2) "only the prompts that actually invoke subagents" — per-state override keys
exist ONLY for the states whose prompts actually spawn a subagent. Verified by
reading the prompts: `new-todo`, `modified-todo`, `decompose` (planning
subagent), `execute` (parallel task workers), and `execute-simple`
(implementation

- testing subagents) → 5 keys. `fix-tests` runs its fix loop **inline in the
  work model** with no subagent, so it is **excluded** (no override key, no
  injection), as are the other 9 model-agnostic states. (Resolved into the 5-key
  `models.states.*` schema and the resolution table above.)

### How far up does the walk go, and what is the stopDir?

**Recommendation:** stopDir = the user's home dir, so a `.gtdrc` in a shared
worktree parent under home cascades to every checkout and `~/.gtdrc` is the top
of the same continuous walk (rather than going all the way to `/`, which risks
picking up unrelated configs).

**Answer:** "yes, thats good" — stopDir = home dir. (Resolved into: walk cwd →
home dir inclusive, merge all levels found, innermost wins.)

### `.gtdrc` searchPlaces / module name and model-name format?

**Recommendation:** cosmiconfig module name `gtd`; `searchPlaces` = `.gtdrc`,
`.gtdrc.json`, `.gtdrc.yaml`, `.gtdrc.yml`, `gtd.config.json`, `gtd.config.yaml`
(skip `.js`/`.cjs` loaders to keep the bundle lean); model names accepted as
free-form strings injected verbatim (gtd can't know the outer agent's available
models, so no allowlist).

**Answer:** "both confirmed" — the proposed searchPlaces set is adopted (YAML
backed by the existing `yaml` dep; no js/cjs loaders) and model names are
free-form strings with no allowlist validation. (Resolved into the schema and
`ConfigService` cosmiconfig setup above.)
