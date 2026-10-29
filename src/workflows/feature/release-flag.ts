import { read, refuse } from "../../flows/index.js"
import { HEADING, markFenced } from "../shared/fences.js"
import { REQUIREMENTS } from "../shared/steps.js"
import type { ReleaseFlag } from "../shared/text.js"

const NAME = /^existing:\s*`?([A-Za-z_][\w.-]*)`?$/i

const isFlagHeading = (h: RegExpExecArray | null): boolean =>
  h !== null && h[1]!.length === 2 && /^release flag$/i.test(h[2]!.trim())

/** The first line under `## Release Flag`, `undefined` without the section. */
const requestLine = (text: string): string | undefined => {
  const lines = markFenced(text)
  const at = lines.findIndex((l) => !l.fenced && isFlagHeading(HEADING.exec(l.line)))
  if (at === -1) return undefined
  const body = lines.slice(at + 1)
  const end = body.findIndex((l) => !l.fenced && HEADING.test(l.line))
  return (end === -1 ? body : body.slice(0, end)).find((l) => l.line.trim() !== "")?.line.trim()
}

/** What `text` asks for, or why it cannot be read. No section asks for no flag. */
export const releaseFlagOf = (text: string): ReleaseFlag | { readonly unreadable: string } => {
  const line = requestLine(text)
  if (line === undefined || /^none$/i.test(line)) return { kind: "none" }
  if (/^new$/i.test(line)) return { kind: "new" }
  const name = NAME.exec(line)?.[1]
  return name === undefined ? { unreadable: line } : { kind: "existing", name }
}

/** Refuse `file` when its `## Release Flag` section is neither `none`, `new` nor `existing: <NAME>`. */
export const requireReleaseFlag = (file: string): void => {
  const request = releaseFlagOf(read(file) ?? "")
  if (!("unreadable" in request)) return
  refuse(
    `gtd land: release-flag: ${file}'s "## Release Flag" reads ${JSON.stringify(request.unreadable)} — its first line must be \`new\`, \`existing: <NAME>\` or \`none\`, or leave the section out for no flag`,
  )
}

/** What `.gtd/REQUIREMENTS.md` asks for now; a person's unreadable edit is refused. */
export const requestedFlag = (): ReleaseFlag => {
  requireReleaseFlag(REQUIREMENTS)
  return releaseFlagOf(read(REQUIREMENTS) ?? "") as ReleaseFlag
}

/** Whether the change goes behind a release flag: only then does the seam judge rule. */
export const flagged = (): boolean => requestedFlag().kind !== "none"
