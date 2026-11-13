import { changedRanges } from "./LineDiff.js"
import { formatFinding } from "./SteeringFormat.js"
import { agentFindings, type ChangedRange } from "./WidgetRules.js"
import { parseWidgets, type WidgetKind } from "./Widgets.js"

export interface ReviewChange {
  readonly path: string
  readonly before: string | undefined
  readonly after: string | undefined
}

export interface SteeringStepOptions {
  readonly widgets?: readonly WidgetKind[] | undefined
  readonly coverage?: boolean | undefined
}

const isProcessPath = (path: string): boolean => path === ".gtd" || path.startsWith(".gtd/")

/** The review base diff as changed ranges, `.gtd/` left out. */
export const reviewRanges = (changes: readonly ReviewChange[]): readonly ChangedRange[] =>
  changes
    .filter((c) => !isProcessPath(c.path) && c.after !== undefined)
    .flatMap((c) =>
      changedRanges(c.before ?? "", c.after ?? "").map((range) => ({ path: c.path, ...range })),
    )

/**
 * Everything a steering step's turn must fix, as `file:line: message` lines:
 * the file is missing, a widget is broken, an annotation is left, a widget
 * kind is not allowed, a hunk pointer misses the review base diff.
 */
export const steeringStepFindings = (
  file: string,
  content: string | undefined,
  review: readonly ReviewChange[],
  options: SteeringStepOptions = {},
): readonly string[] => {
  if (content === undefined)
    return [
      `${file} does not exist: write it — this step answers only through that file, with widgets`,
    ]
  const doc = parseWidgets(content)
  return [
    ...doc.findings,
    ...agentFindings(doc, {
      allow: options.widgets,
      diff: reviewRanges(review),
      coverage: options.coverage,
    }),
  ].map((finding) => formatFinding(file, finding))
}
