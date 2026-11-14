import { changedRanges } from "./LineDiff.js"

const WIDGET_REFERENCE = `# Title and context: plain markdown is static content

## 🔘 A single select: the person ticks exactly one

What the choice is about.

- [ ] First option
- [ ] Second option
- [ ] ✏️ (optional last item: the person may write their own answer)

## ☑️ A multi select: the person ticks any

- [ ] One
- [ ] Two

## ❔ A boolean: exactly one checkbox

- [ ] Yes

## 🔍 A review checklist: hunk pointers into the change, all to be ticked

What these hunks change and why.

- [ ] ./src/file.ts#10-24
- [ ] ./src/other.ts#3 — a short note`

/** What gtd tells the agent at every steering step, ahead of the workflow's prompt (ADR 0010). */
export const steeringPreamble = (file: string): string =>
  [
    `This step writes ${file}, a steering file. It is your only way to reach the person: they read and answer it on their phone or in their editor.`,
    "",
    `- Write ${file} and nothing else. Do not change code or any other file in this step.`,
    `- Ask nothing in chat. Every question, proposal and finding goes into ${file}.`,
    "- The person may add footnote annotations ([^1]). Work what each says into the document, then remove its marker and its note.",
    "- Widgets start at a heading, of any level, that opens with their emoji. Text between the heading and the checkboxes describes the widget.",
    "",
    "```markdown",
    WIDGET_REFERENCE,
    "```",
  ].join("\n")

/** The person's edit of `file` as changed lines, for the next steering step; `undefined` when they changed nothing. */
export const personEditNote = (file: string, before: string, after: string): string | undefined => {
  if (before === after) return undefined
  const lines = after.split("\n")
  const blocks = changedRanges(before, after).map(({ start, end }) =>
    [`@@ line ${start}`, ...lines.slice(start - 1, end).map((line) => `+ ${line}`)].join("\n"),
  )
  return [
    `The person edited ${file} since you last wrote it. These lines are new or changed (the whole file is in ${file}):`,
    "",
    "```",
    ...blocks,
    "```",
  ].join("\n")
}
