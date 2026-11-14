// The text reads `@pmelab/gtd/flows` offers inside a replay, here as plain
// functions: the replay context answers with these, so both read alike.
import { headingSectionBodies, headingSections } from "./MarkdownTree.js"

/** The top-level `## ` heading texts of markdown `text`. */
export const sections = (text: string): readonly string[] => headingSections(text)

/** The top-level `## ` sections of markdown `text`, each with its own markdown, its heading line included. */
export const sectionBodies = (
  text: string,
): readonly { readonly title: string; readonly body: string }[] => headingSectionBodies(text)
