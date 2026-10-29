// The text reads `@pmelab/gtd/flows` offers inside a replay, here as plain
// functions: the replay context answers with these, so both read alike.
import { parseThreadsWithFindings } from "./Footnotes.js"
import { headingSectionBodies, headingSections } from "./MarkdownTree.js"
import { qaDescriptor } from "./qa.js"
import { unansweredQuestions } from "./registry.js"

/** The top-level `## ` heading texts of markdown `text`. */
export const sections = (text: string): readonly string[] => headingSections(text)

/** The top-level `## ` sections of markdown `text`, each with its own markdown, its heading line included. */
export const sectionBodies = (
  text: string,
): readonly { readonly title: string; readonly body: string }[] => headingSectionBodies(text)

/** The `qa`-format questions in `text` still unanswered, each with its heading's 1-based line. */
export const openQuestions = (
  text: string,
): readonly { readonly question: string; readonly line: number }[] =>
  unansweredQuestions(qaDescriptor, text).map((q) => ({
    question: q.question,
    line: q.headingLine + 1,
  }))

/** Every `H:`/`A:` footnote thread in `text`: its 1-based definition line, who it waits on (`"human"` means open) and its syntax faults. */
export const threads = (
  text: string,
): readonly {
  readonly name: string
  readonly line: number
  readonly waitingOn: "human" | "agent"
  readonly faults: readonly string[]
}[] => {
  const { threads, findings } = parseThreadsWithFindings(text)
  return threads.map((t) => ({
    name: t.name,
    line: t.line + 1,
    waitingOn: t.waitingOn,
    faults: findings
      .filter((f) => f.message.startsWith(`Footnote thread "[^${t.name}]": `))
      .map((f) => f.message),
  }))
}
