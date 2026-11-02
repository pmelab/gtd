// `@pmelab/gtd/steering`, listed name by name. gtd's own code imports
// `./internal.js`, which adds what only the engine, the LSP and `gtd ui` use.
export { formatFinding } from "./SteeringFormat.js"
export { findingEntries, FIX_BOX, NOISE_HEADING, type FindingEntry } from "./findings.js"
export {
  ANSWER_FIX,
  ANSWER_LEAD,
  ANSWER_WONT_FIX,
  reviewChunks,
  reviewDecisions,
  reviewNotes,
  reviewRisks,
  reviewSections,
  REVIEW_SECTIONS,
  unansweredNotes,
  type ReviewChoice,
  type ReviewDecision,
  type ReviewNote,
  type ReviewSection,
} from "./review.js"
export { applySteeringEdits } from "./Edits.js"

export type { InlineNode } from "./Inline.js"

export { freeFormFormat } from "./freeform.js"

export {
  listFormat,
  sectionFormat,
  type ListFormat,
  type ListFormatSpec,
  type ListItem,
  type ListMarker,
  type Section,
  type SectionFormat,
  type SectionFormatSpec,
} from "./Declared.js"

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
  SteeringViewThread,
} from "./SteeringFormat.js"

export { openThreads, steeringFormatFor } from "./registry.js"

// The two `qa` primitives the phone client itself needs: `src/web/screens/
// Question.tsx` renders the free-text slot and derives answeredness in the
// browser, against the SAME constant and predicate the server validates
// with — a second copy there would drift silently.
export { FREE_TEXT_PLACEHOLDER, isAnswered } from "./qa.js"

export {
  parseFootnotes,
  parseThreads,
  parseThreadsWithFindings,
  openThreadFindings,
} from "./Footnotes.js"

// The pure counterparts of `@pmelab/gtd/flows`' text reads, usable outside a replay.
export { openQuestions, sectionBodies, sections, threads } from "./reads.js"

// Line-comment `H:`/`A:` threads in changed code files: a flow's `codeThreads()`
// and `gtd check --open-threads` are the callers outside this package.
export { parseCodeThreads, stripCodeThreads } from "./CodeThreads.js"
