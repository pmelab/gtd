import header from "./prompts/header.md"
import grillingMd from "./prompts/grilling.md"
import decomposeMd from "./prompts/decompose.md"
import buildingMd from "./prompts/building.md"
import fixingMd from "./prompts/fixing.md"
import agenticReviewMd from "./prompts/agentic-review.md"
import cleanMd from "./prompts/clean.md"
import awaitReviewMd from "./prompts/await-review.md"
import escalateMd from "./prompts/escalate.md"
import idleMd from "./prompts/idle.md"
import autoAdvance from "./prompts/partials/auto-advance.md"
import stopPartial from "./prompts/partials/stop.md"
import { builtinTierDefault, stateTier, type ModelState } from "./Config.js"
import type { GtdPackageFact, GtdState, ResolveContext, Result } from "./Machine.js"

/**
 * The six edge-only states: the driver performs their `edgeAction`, re-gathers,
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
])

/** The agent/human-facing states `buildPrompt` renders a section for. */
type PromptState = Exclude<
  GtdState,
  "transport" | "new-feature" | "testing" | "accept-review" | "close-package" | "done"
>

/**
 * Which `ModelState` a prompt-bearing state resolves `{{MODEL}}` against. The two
 * decompose states (`grilled`, `planning`) share the `decompose` tier; the STOP
 * states (`await-review`, `escalate`, `idle`) spawn no subagent and carry none.
 */
const MODEL_STATE: Partial<Record<PromptState, ModelState>> = {
  grilling: "grilling",
  grilled: "decompose",
  planning: "decompose",
  building: "building",
  fixing: "fixing",
  "agentic-review": "agentic-review",
  clean: "clean",
}

/** The static section for each non-grilling prompt state (grilling renders specially). */
const SECTIONS: Record<Exclude<PromptState, "grilling">, string> = {
  grilled: decomposeMd,
  planning: decomposeMd,
  building: buildingMd,
  fixing: fixingMd,
  "agentic-review": agenticReviewMd,
  clean: cleanMd,
  "await-review": awaitReviewMd,
  escalate: escalateMd,
  idle: idleMd,
}

// Grilling carries both tails in one file, delimited by HTML comments:
//   <base> <!-- gtd:iterate --> <iterate tail> <!-- gtd:stop --> <stop tail>
// `{{MODEL}}` lives only in the iterate tail, so the STOP variant spawns no agent.
const [GRILL_BASE = "", GRILL_AFTER_ITERATE = ""] = grillingMd.split("<!-- gtd:iterate -->")
const [GRILL_ITERATE_TAIL = "", GRILL_STOP_TAIL = ""] =
  GRILL_AFTER_ITERATE.split("<!-- gtd:stop -->")

/**
 * Built-in model resolver, reusing the single source of truth in `Config.ts`
 * (state→tier map + built-in tier defaults) so it can never drift from
 * `ConfigService`'s defaults.
 */
const builtinResolveModel = (state: ModelState): string => builtinTierDefault[stateTier[state]]

/**
 * Picks a code fence long enough to safely wrap `content`, even when the content
 * itself contains runs of backticks (mirrors GitHub-flavored Markdown fencing).
 */
const fenceFor = (content: string): string => {
  let longest = 0
  for (const match of content.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return "`".repeat(Math.max(3, longest + 1))
}

/** A fenced `diff` block under a `### heading`, fence-sized to survive backticks. */
const renderDiff = (heading: string, diff: string): ReadonlyArray<string> => {
  const body = diff.replace(/\n$/, "")
  const fence = fenceFor(body)
  return ["", `### ${heading}`, "", `${fence}diff`, body, fence, ""]
}

/**
 * Inlines the FEEDBACK.md text into the Fixing prompt under a heading, fenced so
 * backtick-bearing test output / review findings survive. The edge has already
 * committed FEEDBACK.md's removal by the time the fixer runs, so the content must
 * travel in the prompt rather than be read from disk (STATES.md § Fixing).
 */
const renderFeedback = (content: string): ReadonlyArray<string> => {
  const body = content.replace(/\n$/, "")
  const fence = fenceFor(body)
  return ["", "### Feedback to address", "", fence, body, fence, ""]
}

/**
 * Inlines the selected package: names it and fences each task `.md`'s raw content
 * via `fenceFor` so backtick-bearing specs survive. No `COMMIT_MSG.md` — packages
 * no longer carry one; the edge commits them `gtd: building`.
 */
const renderPackage = (pkg: GtdPackageFact): string => {
  const lines: Array<string> = ["", `### Package: \`${pkg.name}/\``, ""]
  for (const task of pkg.taskContents) {
    lines.push(`#### \`${task.name}\``, "")
    const fence = fenceFor(task.content)
    lines.push(fence, task.content.replace(/\n$/, ""), fence, "")
  }
  return lines.join("\n")
}

/** The `## Context` block: last commit, working-tree status, packages, and diff. */
const buildContextBlock = (context: ResolveContext): string => {
  const lines: Array<string> = ["## Context", ""]
  lines.push(
    context.lastCommitSubject === ""
      ? "Last commit: _(repository has no commits yet)_"
      : `Last commit: \`${context.lastCommitSubject}\``,
  )
  lines.push(`Working tree: ${context.workingTreeClean ? "clean" : "dirty"}`)
  if (context.packages.length > 0) {
    lines.push("", "### Work packages in `.gtd/`", "")
    for (const pkg of context.packages) {
      lines.push(`- \`${pkg.name}/\``)
      for (const task of pkg.tasks) lines.push(`  - \`${task}\``)
    }
  }
  if (context.diff !== "") {
    lines.push(
      ...renderDiff("Working-tree diff (`git diff HEAD`, untracked included)", context.diff),
    )
  }
  return lines.join("\n")
}

/** Renders grilling's shared base plus the STOP or iterate tail per `grillingCase`. */
const renderGrilling = (
  context: ResolveContext,
  resolveModel: (state: ModelState) => string,
): string => {
  const tail = context.grillingCase === "stop" ? GRILL_STOP_TAIL : GRILL_ITERATE_TAIL
  return `${GRILL_BASE}${tail}`.replaceAll("{{MODEL}}", resolveModel("grilling"))
}

/**
 * Assemble the full prompt for a resolved, prompt-bearing state: the shared
 * `header`, a `## Context` block, the state's section (with `{{MODEL}}` resolved
 * for the six model states and the selected package / diffs inlined where the
 * state needs them), and the `auto-advance` partial when `result.autoAdvance`.
 *
 * Throws for the six edge-only states — they are performed by the driver and must
 * never reach here.
 */
export const buildPrompt = (
  result: Result,
  resolveModel: (state: ModelState) => string = builtinResolveModel,
): string => {
  const { state, context } = result
  if (EDGE_ONLY_STATES.has(state)) {
    throw new Error(`State "${state}" is performed by the edge and must never reach buildPrompt`)
  }
  const promptState = state as PromptState
  const parts: Array<string> = [header, ""]
  parts.push(buildContextBlock(context))

  if (promptState === "grilling") {
    parts.push(renderGrilling(context, resolveModel), "")
  } else {
    const modelState = MODEL_STATE[promptState]
    const raw = SECTIONS[promptState]
    parts.push(
      modelState !== undefined ? raw.replaceAll("{{MODEL}}", resolveModel(modelState)) : raw,
      "",
    )

    const pkg = context.packages[0]
    if (promptState === "building" && pkg !== undefined) {
      parts.push(renderPackage(pkg), "")
    }
    if (promptState === "fixing" && context.feedbackContent.trim() !== "") {
      parts.push(...renderFeedback(context.feedbackContent), "")
    }
    if (promptState === "agentic-review" && pkg !== undefined) {
      parts.push(renderPackage(pkg), "")
      if (context.refDiff !== undefined && context.refDiff.trim() !== "") {
        parts.push(...renderDiff("Package diff", context.refDiff))
      }
    }
    if (promptState === "clean" && context.refDiff !== undefined && context.refDiff.trim() !== "") {
      if (context.reviewBase !== undefined) {
        parts.push(`Review base: ${context.reviewBase}`, "")
      }
      const diffLabel =
        context.reviewBase !== undefined
          ? `Changes to review (\`git diff ${context.reviewBase} HEAD\`)`
          : "Changes to review (`git diff <base> HEAD`)"
      parts.push(...renderDiff(diffLabel, context.refDiff))
    }
  }

  // TODO: this should just be a ternary
  if (!result.autoAdvance) parts.push(stopPartial, "")
  if (result.autoAdvance) parts.push(autoAdvance, "")

  return (
    parts
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  )
}
