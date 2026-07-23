import { Eta } from "eta"

/**
 * The v3 template layer (see `docs/design/pattern-machine-plan.md`, decision
 * 8 and "Phase 2: Config + templates"). Renders a state's content string
 * (`script`/`prompt`/`message`/`commit`, already auto-inlined by
 * `./PatternConfig.js`) as an Eta template over the agreed variable set.
 *
 * PURE-ISH BY DESIGN: this module owns only the Eta wiring. Every impure
 * value — the commit hashes, the diffs, and the `read` filesystem callback —
 * is INJECTED by the caller via `TemplateContext`. A later edge phase (Phase
 * 3) is responsible for actually computing `processDiff`/`lastDiff`, walking
 * git for the hashes, and wiring a real `read` that hits the working tree;
 * this module never touches git or the filesystem itself.
 *
 * Render errors (a malformed template, `read()` throwing for a missing
 * path, etc) are NOT caught here — they propagate as thrown errors, exactly as
 * the plan requires ("a failed commit-template render refuses the step").
 */

/**
 * One resolved `on` edge, as a `message:`/`prompt:` template sees it in
 * `it.edges`: the raw pattern, its target state, and the optional
 * human-readable `describe` sentence the workflow author attached (see
 * `PatternMachine.OnEdge`). All three are LITERAL strings — none is
 * Eta-rendered (the pattern key never was; `describe` follows the same rule),
 * so a template renders `describe` verbatim, typically with `<%~ %>`.
 */
export interface TemplateEdge {
  readonly pattern: string
  readonly target: string
  readonly describe?: string
}

/**
 * The full variable set a `script`/`prompt`/`message`/`commit` template may
 * reference as `it.<name>` (Eta's default view-model name). All fields are
 * caller-supplied — see the module docstring.
 */
export interface TemplateContext {
  /** The hash the current process started from (before its first turn). */
  readonly startCommit: string
  /** HEAD's hash at render time. */
  readonly currentCommit: string
  /** The hash before the last transition (HEAD's parent, in-process). */
  readonly previousCommit: string
  /** The state whose content is being rendered. */
  readonly state: string
  /** The actor this render is for. */
  readonly actor: string
  /** `startCommit..HEAD` plus the pending working-tree diff. */
  readonly processDiff: string
  /** The diff of the last transition alone. */
  readonly lastDiff: string
  /**
   * The total token cost accumulated over the current process: the sum of
   * every `Gtd-Cost:` trailer on the process's turn commits (recorded by
   * `gtd step <actor> --cost=<n>`), plus the cost of the in-flight step when
   * one is being performed (so a `commit:` squash template rendered against
   * the PENDING tree sees the whole-process total, including the squashing
   * step itself). `0` when nothing has been recorded. Always a number —
   * assembled by `src/Edge.ts`, never config-derived like `it.vars`.
   */
  readonly processCost: number
  /**
   * The same accumulated cost broken down per model — one `{ model, cost }`
   * entry per distinct `--model` tag recorded this process (a cost recorded
   * with no `--model` is grouped under `"unspecified"`), highest-cost first.
   * A `commit:` squash template iterates it to list the tokens each model
   * spent across the whole feature. Empty when nothing has been recorded.
   */
  readonly processCostByModel: readonly { readonly model: string; readonly cost: number }[]
  /** Read a working-tree file (pending contents, not HEAD's) by repo-relative path. Throws for a missing/unreadable path — that throw is the render failure the plan's `commit:` refusal rule depends on. */
  readonly read: (path: string) => string
  /**
   * The merged variable map every template sees as `it.vars.<name>` —
   * assembled by `src/Edge.ts`'s `resolveVars` from three layers (later
   * wins): the workflow's own declared `vars:` defaults
   * (`CompiledWorkflowConfig.vars`), the top-level `.gtdrc` `vars:` key, and
   * `GTD_VAR_`-prefixed environment variables (exact-case match after the
   * prefix). Always a flat `Record<string, string>` — every source value is
   * coerced to a string at load time (env vars are naturally strings; YAML
   * scalars in the first two layers are coerced by `PatternConfig.ts`'s
   * `compileVarsMap`). No name is blessed by the engine: `it.vars` is empty
   * unless a workflow/config/env layer populates it.
   */
  readonly vars: Record<string, string>
  /**
   * The resting state's own `on` edges, in declaration order — each a
   * `{ pattern, target, describe? }` (see `TemplateEdge`). Lets a `message:`
   * template surface, at a human gate, which change routes to which next
   * state (e.g. iterating the edges that carry a `describe`). Empty for a
   * commit state (no `on`); populated but typically unused for `script`/
   * `prompt` states. Injected by the caller (`src/Edge.ts`) — like every
   * other field, this module never derives it.
   */
  readonly edges: readonly TemplateEdge[]
}

// One shared Eta instance, `renderString`-only (no named template registry —
// content strings are ad hoc, compiled fresh per state by the config loader).
// Filesystem template resolution is nulled out, same discipline as
// `Prompt.ts`: a template may only see what `TemplateContext` hands it, never
// reach out to disk on its own via `include()`.
const eta = new Eta()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(eta as any).readFile = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(eta as any).resolvePath = null

/**
 * Render one state's content template against `context`. Throws whatever
 * Eta throws on a malformed template, and whatever `context.read` throws when
 * a template calls `it.read(path)` for a path that doesn't resolve — both are
 * deliberate: the caller (the edge, at step time) must let a render failure
 * refuse the step rather than write a broken commit or prompt.
 */
export const renderStateTemplate = (template: string, context: TemplateContext): string =>
  eta.renderString(template, context)
