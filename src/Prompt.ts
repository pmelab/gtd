import { Eta } from "eta"
import headerMd from "./prompts/header.md"
import contextMd from "./prompts/partials/context.md"
import diffMd from "./prompts/partials/diff.md"
import feedbackMd from "./prompts/partials/feedback.md"
import packageMd from "./prompts/partials/package.md"
import autoAdvanceMd from "./prompts/partials/auto-advance.md"
import neutralMd from "./prompts/partials/neutral.md"
import stopMd from "./prompts/partials/stop.md"
import grillingIterateMd from "./prompts/grilling-iterate.md"
import grillingStopMd from "./prompts/grilling-stop.md"
import decomposeMd from "./prompts/decompose.md"
import buildingMd from "./prompts/building.md"
import fixingMd from "./prompts/fixing.md"
import agenticReviewMd from "./prompts/agentic-review.md"
import reviewMd from "./prompts/review.md"
import squashingMd from "./prompts/squashing.md"
import escalateMd from "./prompts/escalate.md"
import idleMd from "./prompts/idle.md"
import { builtinTierDefault, stateTier, type ModelState } from "./Config.js"
import type { GtdState, Result } from "./Machine.js"

/**
 * The eight edge-only states: the driver performs their `edgeAction`, re-gathers,
 * and re-resolves without ever rendering a prompt. Asking `buildPrompt` to render
 * one is a driver bug, so it throws.
 */
const EDGE_ONLY_STATES: ReadonlySet<GtdState> = new Set<GtdState>([
  "transport",
  "new-feature",
  "testing",
  "accept-review",
  "close-package",
  "done",
  "await-review",
  "health-check",
])

/** The agent/human-facing states `buildPrompt` renders a section for. */
type PromptState = Exclude<
  GtdState,
  | "transport"
  | "new-feature"
  | "testing"
  | "accept-review"
  | "close-package"
  | "done"
  | "await-review"
  | "health-check"
>

/**
 * Which `ModelState` a prompt-bearing state resolves `{{MODEL}}` against. The two
 * decompose states (`grilled`, `planning`) share the `decompose` tier; the STOP
 * states (`escalate`, `idle`) spawn no subagent and carry none.
 */
const MODEL_STATE: Partial<Record<PromptState, ModelState>> = {
  grilling: "grilling",
  grilled: "decompose",
  planning: "decompose",
  building: "building",
  fixing: "fixing",
  "health-fixing": "fixing",
  "agentic-review": "agentic-review",
  clean: "clean",
  squashing: "clean",
}

/**
 * Built-in model resolver, reusing the single source of truth in `Config.ts`
 * (state→tier map + built-in tier defaults) so it can never drift from
 * `ConfigService`'s defaults.
 */
const builtinResolveModel = (state: ModelState): string => builtinTierDefault[stateTier[state]]

/**
 * Picks a code fence long enough to safely wrap `content`, even when the content
 * itself contains runs of backticks (mirrors GitHub-flavored Markdown fencing).
 * Exported for the TODO.md capture builders in Events.ts: a CommonMark closing
 * fence must be at least as long as its opener, so sizing the outer fence past
 * any backtick run in a captured diff keeps formatters (gtd format / prettier)
 * from closing the block early on an indented ``` context line.
 */
export const fenceFor = (content: string): string => {
  let longest = 0
  for (const match of content.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return "`".repeat(Math.max(3, longest + 1))
}

// ---------------------------------------------------------------------------
// Eta setup — one instance, all templates loaded in-memory at module load.
// ---------------------------------------------------------------------------

const eta = new Eta()

// Register partials
eta.loadTemplate("@header", headerMd)
eta.loadTemplate("@context", contextMd)
eta.loadTemplate("@diff", diffMd)
eta.loadTemplate("@feedback", feedbackMd)
eta.loadTemplate("@package", packageMd)

// Register tail partials
eta.loadTemplate("@auto-advance", autoAdvanceMd)
eta.loadTemplate("@neutral", neutralMd)
eta.loadTemplate("@stop", stopMd)

// Register state templates
eta.loadTemplate("@grilling-iterate", grillingIterateMd)
eta.loadTemplate("@grilling-stop", grillingStopMd)
eta.loadTemplate("@decompose", decomposeMd)
eta.loadTemplate("@building", buildingMd)
eta.loadTemplate("@fixing", fixingMd)
eta.loadTemplate("@agentic-review", agenticReviewMd)
eta.loadTemplate("@review", reviewMd)
eta.loadTemplate("@squashing", squashingMd)
eta.loadTemplate("@escalate", escalateMd)
eta.loadTemplate("@idle", idleMd)

// Null out filesystem resolution — all templates must come from in-memory cache.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(eta as any).readFile = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(eta as any).resolvePath = null

/** Maps each non-grilling PromptState to its registered template name. */
const STATE_TEMPLATE: Record<Exclude<PromptState, "grilling">, string> = {
  grilled: "@decompose",
  planning: "@decompose",
  building: "@building",
  fixing: "@fixing",
  "agentic-review": "@agentic-review",
  clean: "@review",
  squashing: "@squashing",
  escalate: "@escalate",
  idle: "@idle",
  "health-fixing": "@fixing",
}

/**
 * Assemble the full prompt for a resolved, prompt-bearing state via Eta
 * templates. Each state template is a complete, self-contained Eta template
 * that pulls in shared partials (`@header`, `@context`, tail) and the
 * state-specific dynamic values (`model`, `tail`) as view-model variables.
 *
 * Throws for the seven edge-only states — they are performed by the driver and
 * must never reach here.
 */
export const buildPrompt = (
  result: Result,
  resolveModel: (state: ModelState) => string = builtinResolveModel,
  output: "plain" | "json" = "plain",
): string => {
  const { state, context } = result
  if (EDGE_ONLY_STATES.has(state)) {
    throw new Error(`State "${state}" is performed by the edge and must never reach buildPrompt`)
  }
  const promptState = state as PromptState

  // Resolve the model string for states that spawn a subagent.
  const modelState = MODEL_STATE[promptState]
  const model = modelState !== undefined ? resolveModel(modelState) : ""

  // Select the tail partial name.
  const tail = output === "json" ? "@neutral" : result.autoAdvance ? "@auto-advance" : "@stop"

  // Select the state template.
  let templateName: string
  if (promptState === "grilling") {
    templateName = context.grillingCase === "stop" ? "@grilling-stop" : "@grilling-iterate"
  } else {
    templateName = STATE_TEMPLATE[promptState]
  }

  const raw = eta.renderString(`<%~ include(it.tmpl, it) %>`, {
    tmpl: templateName,
    context,
    model,
    tail,
    fenceFor,
  })

  return raw.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n"
}
