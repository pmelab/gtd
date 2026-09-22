import { Eta } from "eta"
// `TemplateEdge` lives in `src/wire/` (`gtd next --json`'s `edges` entries
// use this exact shape) and is re-exported here — see `src/wire/types.ts`.
import type { TemplateEdge } from "./wire/index.js"
export type { TemplateEdge }

/** The full variable set a `script`/`prompt`/`message` template may reference as `it.<name>`. All fields are caller-supplied. */
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
   * The process's own trace/retry boundary — the parent of its first turn
   * commit — which a `Gtd-Review-Base:` trailer never overrides. For a `gtd
   * review` process this narrows to just the review's own feedback commits,
   * not the whole reviewed changeset. `gtd summary` uses this to name the
   * range it asks the agent to inspect.
   */
  readonly processBase: string
  /**
   * Total token cost accumulated over the process (every `Gtd-Cost:` trailer,
   * plus the in-flight step's own cost) — `0` when nothing recorded.
   */
  readonly processCost: number
  /** `processCost` broken down per model, highest-cost first (`"unspecified"` when no `--model` was recorded). */
  readonly processCostByModel: readonly { readonly model: string; readonly cost: number }[]
  /** Read a working-tree file (pending contents, not HEAD's) by repo-relative path. Throws for a missing/unreadable path — that throw is the render failure that refuses the step (`renderDecision`'s caller catches it into an empty script). */
  readonly read: (path: string) => string
  /**
   * `git diff <base>` against the working tree — tracked and untracked
   * (non-ignored) content alike, as real git-formatted hunks. Bound the same
   * way regardless of which `read` a caller wired this context with: a
   * judgment ruling on "is this hunk mechanical" needs the actual hunks, not
   * a base name the judge has no repository to `git diff` itself. The one
   * deliberate WORKING-TREE exception to `judge:`'s otherwise committed-only
   * evidence rule (`it.read`'s doc comment) — see `Workspace.ts#diffSync`
   * for why that's safe (a throwaway index copy, never the real one).
   */
  readonly diff: (base: string) => string
  /**
   * `path`'s own top-level `## ` heading texts, in document order — a
   * dynamic-count `judge:` template's one hook into a real markdown parse
   * (`src/steering/MarkdownTree.ts`'s `headingSections`), since Eta templating
   * is plain string substitution and cannot otherwise reach that parser.
   * Shares whichever `read` binding the caller wired this context with, so a
   * `judge:` field's `it.sections(...)` inherits the SAME evidence rule as its
   * own `it.read(...)` — committed-only for a `judge:` render, never a fresh
   * working-tree write. (`it.diff`, above, is a separate, deliberately
   * working-tree-reading field; that exception is its own, not this one's.)
   */
  readonly sections: (path: string) => readonly string[]
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
  /** The resting state's own `on` edges, in declaration order — lets a `message:` template surface which change routes where. */
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
  processBase: "",
  processCost: 0,
  processCostByModel: [],
  read: (path: string) => {
    throw new Error(
      `no working tree to read from while rendering against a vars-only context (path: ${path})`,
    )
  },
  diff: (base: string) => {
    throw new Error(
      `no working tree to diff from while rendering against a vars-only context (base: ${base})`,
    )
  },
  sections: (path: string) => {
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

/**
 * Renders `ui.format`'s own command template: the same Eta instance every
 * other template here renders through (no filesystem `include()`), with only
 * `it.file` bound — the UI write path has no git `TemplateContext` to offer
 * (it isn't mid-transition), so it gets this narrower sibling instead of
 * `renderModeCommand`'s full `ModeCommandContext`.
 */
export const renderFileCommand = (template: string, file: string): string =>
  eta.renderString(template, { file })
