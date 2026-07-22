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
  /** Read a working-tree file (pending contents, not HEAD's) by repo-relative path. Throws for a missing/unreadable path — that throw is the render failure the plan's `commit:` refusal rule depends on. */
  readonly read: (path: string) => string
  /** The `vars:` passthrough compiled by `./PatternConfig.js` (`CompiledWorkflowConfig.config`) — any shape, unvalidated. */
  readonly config: unknown
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
