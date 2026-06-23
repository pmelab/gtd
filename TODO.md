---
status: grilling
---

## Open Questions

### Are per-state model overrides actually actionable, given gtd only emits prompt text?

**Critical mechanism question.** gtd does NOT spawn subagents or invoke any
model itself. `src/main.ts:40,45` just does `process.stdout.write(prompt)` — the
emitted text is read by a human or an outer orchestrating agent, which then
decides what to run. There is no out-of-band channel (no `--model` flag passed
to a runner, no SDK call). So a configured model name can only ever appear _as
instruction text inside the prompt_ ("Spawn a planning-model subagent using
`claude-opus-4-8`"). Whether that text actually changes which model runs depends
entirely on the outer agent honoring it.

Given that, two sub-decisions need user input:

1. **Is prompt-text injection good enough for you?** I.e. config resolves a
   model name and gtd writes it into the prompt as a directive the outer agent
   should obey. (This is the only mechanism available without a much larger
   change — gtd would have to grow an actual subagent-spawning runtime.) My
   read: yes, this matches how the existing AGENTS.md prose already works (it's
   all advisory text the agent is told to honor), so per-state config is just a
   more-specific, deterministic version of the same directive. Confirm.

2. **If prompt-text is the mechanism, are per-state overrides worth the schema
   surface?** Only 5 of the 14 LeafStates reference a model at all today
   (planning tier: `new-todo`, `modified-todo`, `decompose`; execution tier:
   `execute`, `execute-simple`; plus the `fix-tests` override which is execution
   tier). The other 9 states emit no model directive. So per-state config is
   only meaningful for those ~6 phases. Confirm you want per-state granularity
   for _those_ phases (and that the other 9 silently inherit nothing / are
   model-agnostic), versus the simpler two-tier-only injection.

### How far up does the walk go, and what is the stopDir?

The answer to the search-chain question (cascade across worktrees in a shared
non-git parent) means the walk must continue past the git root. cosmiconfig's
`search()` walks cwd → ancestors and stops at `stopDir` (default = OS home dir).
Proposed rule below is **stopDir = home dir** (so a `.gtdrc` in
`~/projects/myapp-worktrees/` cascades to every worktree under it, and a
`~/.gtdrc` is the topmost layer of the _same_ continuous walk). **Confirm**, or
do you want the walk to go all the way to `/` (filesystem root)? Going to `/`
risks picking up unrelated configs in shared-machine setups; home dir is the
natural ceiling and unifies the "user layer" with the walk. Remaining ambiguity:
if your worktree parent dir lives _outside_ your home dir (e.g. `/work/...` on a
build box), a home-dir stopDir would never see a `.gtdrc` placed above home —
flag if that's a real scenario for you, in which case stopDir = `/` is needed.

### `.gtdrc` format/name and model-name format

Two confirmations:

1. **searchPlaces / module name.** cosmiconfig module name `gtd`. Proposed
   `searchPlaces`: `.gtdrc`, `.gtdrc.json`, `.gtdrc.yaml`, `.gtdrc.yml`,
   `gtd.config.json`, `gtd.config.yaml` (skip `.js`/`.cjs` loaders to keep the
   single-file bundle lean and avoid `jiti`-style runtime eval). The user's
   answer literally said `.gtdrc`, so that must be a supported name. Confirm the
   set, especially whether you want YAML (a `yaml` dep is already present) and
   whether `package.json#gtd` should be honored.
2. **Model-name format.** Config can accept either concrete IDs
   (`claude-opus-4-8`, as this repo's environment uses) or short aliases
   (`opus`, `sonnet`). Proposed: accept any string verbatim and inject it as-is
   into the prompt (no validation against a model registry — gtd can't know the
   outer agent's available models). Confirm free-form string is acceptable, or
   whether you want gtd to validate against a fixed allowlist.

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
  (execution). The `fix-tests` override prompt is execution tier. Documented in
  `SKILL.md:45-63` and `SKILL.md:109-114`, and `README.md:123-129`. No
  structured model value exists anywhere.
- **LeafStates** (`src/Machine.ts:91-105`, 14 total): `close-review`,
  `review-process`, `await-review`, `code-changes`, `execute`, `cleanup`,
  `decompose`, `execute-simple`, `escalate`, `new-todo`, `modified-todo`,
  `await-answers`, `human-review`, `verified`. Only **5** reference a model
  today (planning: `new-todo`, `modified-todo`, `decompose`; execution:
  `execute`, `execute-simple`), plus the `fix-tests` override (execution). The
  other 9 are model-agnostic.
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
current AGENTS.md prose already relies on, made deterministic). `buildPrompt`
(`src/Prompt.ts:131`) takes the resolved `models` config and, for each
model-referencing section, injects the concrete name for that state. (See the
open question on whether prompt-text injection is the acceptable mechanism and
whether per-state granularity is worth it.)

### Model schema: two base tiers + per-state overrides (decided)

Two base tiers, `planning` and `execution`. Each model-referencing state
defaults to one of the two tiers, and may be overridden individually.

```yaml
testCommand: "npm run test"
models:
  planning: "claude-opus-4-8" # base tier: high-reasoning
  execution: "claude-sonnet-4-8" # base tier: everyday work
  states: # optional per-state overrides; each defaults to its tier
    new-todo: "claude-opus-4-8" # defaults to planning
    modified-todo: "claude-opus-4-8" # defaults to planning
    decompose: "claude-opus-4-8" # defaults to planning
    execute: "claude-sonnet-4-8" # defaults to execution
    execute-simple: "claude-sonnet-4-8" # defaults to execution
    fix-tests: "claude-sonnet-4-8" # defaults to execution (override prompt)
```

**Default tier mapping (the resolution table).** For each model-referencing
state, the resolved model is: `models.states.<state>` if set, else its tier
default below, else the built-in default for that tier.

| State            | Tier      |
| ---------------- | --------- |
| `new-todo`       | planning  |
| `modified-todo`  | planning  |
| `decompose`      | planning  |
| `execute`        | execution |
| `execute-simple` | execution |
| `fix-tests`      | execution |

The remaining 9 LeafStates (`cleanup`, `code-changes`, `escalate`,
`human-review`, `verified`, `review-process`, `close-review`, `await-review`,
`await-answers`) reference no model and get no injection.

- `models`, `models.planning`, `models.execution`, and every `models.states.*`
  key are all optional.
- Resolution per state: `states.<state>` → tier value (`planning`/`execution`) →
  built-in default.
- Model-name value is a free-form string (concrete ID like `claude-opus-4-8` or
  alias like `opus`), injected verbatim (see open question).

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

- **Edit every model-referencing prompt** to drop the AGENTS.md directive and
  instead carry a placeholder filled by `buildPrompt`:
  - `src/prompts/header.md` (the general two-tier explanation, lines 5-10)
  - `src/prompts/new-todo.md` (lines 19-22)
  - `src/prompts/modified-todo.md` (lines 22-25)
  - `src/prompts/decompose.md` (lines 8-11)
  - `src/prompts/execute.md` (lines 11-23)
  - `src/prompts/execute-simple.md` (lines 8-18)
  - `src/prompts/fix-tests.md` (execution-tier override prompt) — inject the
    `fix-tests` resolved model.
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
fields. `models.states` is an optional record keyed by the model-referencing
state names. Invalid config fails the program with a readable message via the
existing `Effect.catchAll` in `main.ts:52`.

### Integration points

1. **New `ConfigService`** (`src/Config.ts`): `Context.Tag` + `static Live`
   layer that (a) enumerates the directory chain cwd→home (or `/`), loads every
   `.gtdrc`-family file via cosmiconfig per level, deep-merges low→high, (b)
   decodes via `effect/Schema`, (c) exposes resolved
   `{ testCommand: string; resolveModel(state): string }` where `resolveModel`
   applies the per-state → tier → built-in-default resolution. Follow the
   `GitService` shape.
2. **`TestRunner`** (`src/TestRunner.ts`): depend on `ConfigService`, read
   `testCommand`, tokenize, pass to `Command.make` instead of the hardcoded
   literal. Update `src/TestRunner.test.ts` to cover the configured-command path
   and keep the default-path assertion. Update the `npm run test` comment.
3. **`main.ts`**: add `Effect.provide(ConfigService.Live)` to the layer stack
   (`src/main.ts:48-58`). Thread the resolved config into `buildPrompt`.
4. **Prompts / `buildPrompt`** (`src/Prompt.ts:131`): accept the config (or a
   `resolveModel` fn) and substitute the concrete per-state model name into the
   model-referencing sections, replacing the removed AGENTS.md prose. Touch
   `header.md`, `new-todo.md`, `modified-todo.md`, `decompose.md`, `execute.md`,
   `execute-simple.md`, `fix-tests.md`.
5. **Docs**: update `README.md` and `SKILL.md` — remove the AGENTS.md
   model-preferences sections, document the `.gtdrc` config file, schema
   (`testCommand`, `models.planning`/`execution`/`states.*`), the cwd→home
   cascade + worktree-parent use case, precedence (innermost wins), and that
   `testCommand` is now overridable. (Per global instructions: reflect the
   change in the README.)
6. **Cucumber scenarios** (`tests/integration/`): composable Given steps — e.g.
   "Given a gtd config file at `<dir>` with content `...`" placed at
   home/worktree-parent/repo-root/cwd levels — and scenarios proving the
   cwd→home cascade and innermost-wins merge, a `.gtdrc` in a shared parent
   cascading to two worktrees, a custom `testCommand` reaching the runner, and
   per-state + tier model names appearing in the right prompt sections (incl. a
   per-state override beating its tier). Follow AGENTS.md testing conventions
   (small reusable Given steps, real file content in scenario text, one step per
   commit).

### Rough implementation outline

1. Add `cosmiconfig` to `dependencies`; verify it bundles into `scripts/gtd.js`
   (`npm run build`, then run the bundled CLI). Confirm no `.js`-loader eval
   sneaks into the bundle.
2. Define `effect/Schema` `Config` schema + built-in tier defaults + per-state
   resolution table.
3. Implement `ConfigService` (enumerate chain → load per level → deep-merge →
   decode → expose `testCommand` + `resolveModel`).
4. Wire into `main.ts`; make `TestRunner` consume `testCommand`.
5. Thread `resolveModel` into `buildPrompt`; rewrite the 7 model-referencing
   prompt files to use injected names instead of AGENTS.md prose.
6. Update docs (README, SKILL.md); drop model-preferences sections.
7. Add cucumber scenarios + unit tests.

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
entirely. (Resolved into: rewrite the 7 model-referencing prompts to inject
concrete names with built-in tier defaults baked into `ConfigService`, and drop
the model-preferences sections from `SKILL.md` and `README.md`.)
