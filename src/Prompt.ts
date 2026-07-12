import { Eta } from "eta"
import headerMd from "./prompts/header.md"
import diffMd from "./prompts/partials/diff.md"
import feedbackMd from "./prompts/partials/feedback.md"
import packageMd from "./prompts/partials/package.md"
import agentTurnMd from "./prompts/partials/agent-turn.md"
import grillingAgentMd from "./prompts/grilling-agent.md"
import grillingAnswersMd from "./prompts/grilling-answers.md"
import decomposeMd from "./prompts/decompose.md"
import buildingMd from "./prompts/building.md"
import fixingMd from "./prompts/fixing.md"
import healthFixingMd from "./prompts/health-fixing.md"
import agenticReviewMd from "./prompts/agentic-review.md"
import reviewMd from "./prompts/review.md"
import awaitReviewMd from "./prompts/await-review.md"
import squashingMd from "./prompts/squashing.md"
import learningMd from "./prompts/learning.md"
import awaitLearningReviewMd from "./prompts/await-learning-review.md"
import learningApplyMd from "./prompts/learning-apply.md"
import escalateMd from "./prompts/escalate.md"
import idleMd from "./prompts/idle.md"
import { builtinTierDefault, stateTier, type ModelState } from "./Config.js"
import type { GtdState, Result } from "./Machine.js"

/**
 * The 14 prompt-bearing states (frozen contract) — `src/State.ts` consumes
 * this single classification instead of duplicating an edge-only set.
 * `buildPrompt` throws for the other six (testing, planning, close-package,
 * done, health-check, learning-applied), which are performed by the driver
 * and must never render a prompt.
 */
const PROMPT_STATES: ReadonlySet<GtdState> = new Set<GtdState>([
  "grilling",
  "grilled",
  "building",
  "fixing",
  "agentic-review",
  "review",
  "await-review",
  "squashing",
  "learning",
  "await-learning-review",
  "learning-apply",
  "escalate",
  "idle",
  "health-fixing",
])

export const isPromptState = (state: GtdState): boolean => PROMPT_STATES.has(state)

/** The prompt-bearing states `buildPrompt` renders a section for. */
type PromptState =
  | "grilling"
  | "grilled"
  | "building"
  | "fixing"
  | "agentic-review"
  | "review"
  | "await-review"
  | "squashing"
  | "learning"
  | "await-learning-review"
  | "learning-apply"
  | "escalate"
  | "idle"
  | "health-fixing"

/**
 * Which `ModelState` a prompt-bearing state resolves `{{MODEL}}` against.
 * `grilled` shares the `decompose` tier; `review`, `squashing`, `learning`,
 * and `learning-apply` share the `clean` tier (renamed states, same model
 * tier); the human-gated states (`await-review`, `await-learning-review`,
 * `escalate`, `idle`) spawn no subagent and carry none.
 */
const MODEL_STATE: Partial<Record<PromptState, ModelState>> = {
  grilling: "grilling",
  grilled: "decompose",
  building: "building",
  fixing: "fixing",
  "health-fixing": "fixing",
  "agentic-review": "agentic-review",
  review: "clean",
  squashing: "clean",
  learning: "clean",
  "learning-apply": "clean",
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
 * Used by the Eta templates below: a CommonMark closing fence must be at least
 * as long as its opener, so sizing the outer fence past any backtick run in a
 * captured diff keeps formatters (gtd format / prettier) from closing the
 * block early on an indented ``` context line.
 */
const fenceFor = (content: string): string => {
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
eta.loadTemplate("@diff", diffMd)
eta.loadTemplate("@feedback", feedbackMd)
eta.loadTemplate("@package", packageMd)

// Register the single agent-turn tail partial.
eta.loadTemplate("@agent-turn", agentTurnMd)

// Register state templates
eta.loadTemplate("@grilling-agent", grillingAgentMd)
eta.loadTemplate("@grilling-answers", grillingAnswersMd)
eta.loadTemplate("@decompose", decomposeMd)
eta.loadTemplate("@building", buildingMd)
eta.loadTemplate("@fixing", fixingMd)
eta.loadTemplate("@health-fixing", healthFixingMd)
eta.loadTemplate("@agentic-review", agenticReviewMd)
eta.loadTemplate("@review", reviewMd)
eta.loadTemplate("@await-review", awaitReviewMd)
eta.loadTemplate("@squashing", squashingMd)
eta.loadTemplate("@learning", learningMd)
eta.loadTemplate("@await-learning-review", awaitLearningReviewMd)
eta.loadTemplate("@learning-apply", learningApplyMd)
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
  building: "@building",
  fixing: "@fixing",
  "agentic-review": "@agentic-review",
  review: "@review",
  "await-review": "@await-review",
  squashing: "@squashing",
  learning: "@learning",
  "await-learning-review": "@await-learning-review",
  "learning-apply": "@learning-apply",
  escalate: "@escalate",
  idle: "@idle",
  "health-fixing": "@health-fixing",
}

/**
 * Assemble the full prompt for a resolved, prompt-bearing state via Eta
 * templates. Each state template is a complete, self-contained Eta template
 * that pulls in shared partials (`@header`, tail) and the
 * state-specific dynamic values (`model`, `tail`) as view-model variables.
 *
 * Throws for the five edge-only states — they are performed by the driver and
 * must never reach here.
 */
export const buildPrompt = (
  result: Result,
  resolveModel: (state: ModelState) => string = builtinResolveModel,
  output: "plain" | "json" = "plain",
): string => {
  const { state, context } = result
  if (!isPromptState(state)) {
    throw new Error(`State "${state}" is performed by the edge and must never reach buildPrompt`)
  }
  const promptState = state as PromptState

  // Resolve the model string for states that spawn a subagent.
  const modelState = MODEL_STATE[promptState]
  const model = modelState !== undefined ? resolveModel(modelState) : ""

  // Select the tail: agent turns get the pinned tail sentence in plain mode;
  // human turns and any --json output carry no tail at all.
  const tail = output === "plain" && result.actor === "agent" ? "@agent-turn" : undefined

  // Select the state template. For `grilling`, which prompt renders depends
  // on which actor the resolver is awaiting at this rest.
  let templateName: string
  if (promptState === "grilling") {
    templateName = result.actor === "human" ? "@grilling-answers" : "@grilling-agent"
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
