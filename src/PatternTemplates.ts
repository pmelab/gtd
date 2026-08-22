import { Eta } from "eta"

/**
 * One resolved `on` edge as a `message:`/`prompt:` template sees it in
 * `it.edges`. All fields are literal strings, never Eta-rendered, so a
 * template renders `describe`/`action` verbatim (typically with `<%~ %>`).
 */
export interface TemplateEdge {
  readonly pattern: string
  readonly target: string
  readonly describe?: string
  readonly action?: string
}

/** The full variable set a `script`/`prompt`/`message`/`commit` template may reference as `it.<name>`. All fields are caller-supplied. */
export interface TemplateContext {
  readonly startCommit: string
  readonly currentCommit: string
  /** HEAD's parent, in-process — the hash before the last transition. */
  readonly previousCommit: string
  readonly state: string
  readonly actor: string
  /**
   * The most-recent in-process commit that entered a `reviewBase: true`
   * state, else `startCommit`. A template names this hash in prose so the
   * agent can `git diff` the range itself, rather than being shown the diff.
   */
  readonly reviewBase: string
  /**
   * The base a squash would KEEP from: the process's own trace/retry
   * boundary, which a `Gtd-Review-Base:` trailer never overrides. For a `gtd
   * review` process this narrows to just the review's own feedback commits,
   * not the whole reviewed changeset.
   */
  readonly retainedBase: string
  /**
   * Total token cost accumulated over the process (every `Gtd-Cost:` trailer,
   * plus the in-flight step's own cost) — `0` when nothing recorded.
   */
  readonly processCost: number
  /** `processCost` broken down per model, highest-cost first (`"unspecified"` when no `--model` was recorded). */
  readonly processCostByModel: readonly { readonly model: string; readonly cost: number }[]
  /** Read a working-tree file (pending contents, not HEAD's) by repo-relative path. Throws for a missing/unreadable path — that throw is the render failure the plan's `commit:` refusal rule depends on. */
  readonly read: (path: string) => string
  /**
   * The merged variable map every template sees as `it.vars.<name>` —
   * assembled by `src/Edge.ts`'s `resolveVars` from four layers (later wins):
   * the workflow's declared `vars:` defaults, the top-level `.gtdrc` `vars:`
   * key, the process's entry commit's `Gtd-Var:` trailers, and
   * `GTD_<UPPERCASE-name>` env vars. An env var can only override a name an
   * earlier layer already declares, never introduce one; the entry-var layer
   * is exempt from that filter. No name is blessed by the engine.
   */
  readonly vars: Record<string, string>
  /** The resting state's own `on` edges, in declaration order — lets a `message:` template surface which change routes where. Empty for a commit state. */
  readonly edges: readonly TemplateEdge[]
}

/**
 * The stub `TemplateContext` an `on` pattern key renders against (`Edge.ts`'s
 * `renderOnEdges`): only `vars`/`state` are real, since a pattern names a
 * path and never legitimately needs git history or a working tree. Shared
 * with `Lsp.ts`'s `buildFileModeMap`.
 */
export const varsOnlyContext = (vars: Record<string, string>, state = ""): TemplateContext => ({
  startCommit: "",
  currentCommit: "",
  previousCommit: "",
  state,
  actor: "",
  reviewBase: "",
  retainedBase: "",
  processCost: 0,
  processCostByModel: [],
  read: (path: string) => {
    throw new Error(
      `no working tree to read from while rendering against a vars-only context (path: ${path})`,
    )
  },
  vars,
  edges: [],
})

// Filesystem template resolution is nulled out: a template may only see what
// `TemplateContext` hands it, never reach out to disk itself via `include()`.
const eta = new Eta()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(eta as any).readFile = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(eta as any).resolvePath = null

/** Render one state's content template. Throws (deliberately) on a malformed template or a `read()` path that doesn't resolve, so the caller can refuse the step rather than write a broken commit or prompt. */
export const renderStateTemplate = (template: string, context: TemplateContext): string =>
  eta.renderString(template, context)

/**
 * `TemplateContext` plus `it.file` (the rendered steering-file path) for a
 * mode's `format:`/`validate:` command. `file` is deliberately absent from
 * `TemplateContext` itself — only a mode command is guaranteed to have one.
 */
export interface ModeCommandContext extends TemplateContext {
  readonly file: string
}

/** Render one mode command template — same throw-on-failure discipline as `renderStateTemplate`. `SteeringMode.ts` turns a render failure into a refusal rather than running a half-rendered command. */
export const renderModeCommand = (template: string, context: ModeCommandContext): string =>
  eta.renderString(template, context)
