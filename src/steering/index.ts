// `@pmelab/gtd/steering`, listed name by name. gtd's own code imports
// `./internal.js`, which adds what only the engine, the LSP and `gtd ui` use.
import * as Footnotes from "./Footnotes.js"
import * as MarkdownTree from "./MarkdownTree.js"
import * as registry from "./registry.js"

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

export { openThreads, steeringFormatFor, unansweredQuestions } from "./registry.js"

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

export { headingSectionBodies, headingSections } from "./MarkdownTree.js"

// The pure counterparts of `@pmelab/gtd/flows`' text reads, usable outside a replay.
export { openQuestions, sectionBodies, sections, threads } from "./reads.js"

// Line-comment `H:`/`A:` threads in changed code files: a flow's `codeThreads()`
// and `gtd check --open-threads` are the callers outside this package.
export { parseCodeThreads, stripCodeThreads } from "./CodeThreads.js"

/** @deprecated Internal: the LSP's code-action title. Leaves this entrypoint in a later major. */
export const FOOTNOTE_ACTION_TITLE = Footnotes.FOOTNOTE_ACTION_TITLE
/** @deprecated Internal: the LSP's code-action title. Leaves this entrypoint in a later major. */
export const THREAD_REPLY_ACTION_TITLE = Footnotes.THREAD_REPLY_ACTION_TITLE
/** @deprecated Internal: a test-only parse counter. Leaves this entrypoint in a later major. */
export const getParseCount = MarkdownTree.getParseCount
/** @deprecated Internal: name the built-in modes yourself (`qa`, `review`, `findings`). Leaves this entrypoint in a later major. */
export const BUILT_IN_MODE_NAMES = registry.BUILT_IN_MODE_NAMES
/** @deprecated Internal: `gtd ui`'s fallback; use `steeringFormatFor`, then `freeFormFormat`. Leaves this entrypoint in a later major. */
export const steeringFormatOrFreeForm = registry.steeringFormatOrFreeForm
/** @deprecated Internal: the LSP's view of a document. Leaves this entrypoint in a later major. */
export const viewOf = registry.viewOf
/** @deprecated Internal: `viewOf`'s result. Leaves this entrypoint in a later major. */
export type SteeringEditorView = registry.SteeringEditorView
