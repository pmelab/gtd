// `@pmelab/gtd/steering`, listed name by name. gtd's own code imports
// `./internal.js`, which adds what only the engine, the LSP and `gtd ui` use.
export { formatFinding } from "./SteeringFormat.js"
export { applySteeringEdits } from "./Edits.js"

export type { InlineNode } from "./Inline.js"

export type {
  BlockListItem,
  SteeringAction,
  SteeringAnchor,
  SteeringFinding,
  SteeringFormat,
  SteeringLink,
  SteeringOutlineNode,
  SteeringPointer,
  SteeringView,
  SteeringViewNode,
} from "./SteeringFormat.js"

export { parseFootnotes } from "./Footnotes.js"

// The pure counterparts of `@pmelab/gtd/flows`' text reads, usable outside a replay.
export { sectionBodies, sections } from "./reads.js"

export {
  CUSTOM_ANSWER_EMOJI,
  parseWidgets,
  WIDGET_EMOJI,
  type Annotation,
  type BooleanWidget,
  type CustomAnswer,
  type Hunk,
  type InputWidget,
  type InputWidgetKind,
  type MultiSelectWidget,
  type ReviewChecklistWidget,
  type SingleSelectWidget,
  type StaticWidget,
  type Widget,
  type WidgetDocument,
  type WidgetKind,
  type WidgetOption,
} from "./Widgets.js"
export { LINE_WIDTH, serialize } from "./Serialize.js"
export {
  agentFindings,
  answerFindings,
  isAnnotated,
  unansweredWidgets,
  type AgentRuleOptions,
  type ChangedRange,
} from "./WidgetRules.js"
export { widgetFormat } from "./widget.js"
