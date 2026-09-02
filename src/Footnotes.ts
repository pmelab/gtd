import type { SteeringFinding } from "./SteeringFormat.js"

/** One `[^name]` marker's anchor: line AND column of its opening `[` — never the word or sentence it follows, which the reader reads itself. */
export interface FootnoteMarker {
  readonly name: string
  readonly line: number
  readonly character: number
}

/** One `[^name]:` definition — matched to its marker(s) by NAME alone, never by position. */
export interface FootnoteDefinition {
  readonly name: string
  readonly line: number
  readonly endLine: number
  readonly body: string
}

export interface Footnotes {
  readonly markers: readonly FootnoteMarker[]
  readonly definitions: readonly FootnoteDefinition[]
  readonly findings: readonly SteeringFinding[]
}

/** The seeded placeholder a hand-authored definition starts as — still present means the human never filled it in. */
const PLACEHOLDER_BODY = "your comment"

/** A definition's start line: `[^name]:` at COLUMN 0, nothing before it. */
const DEFINITION_START_RE = /^\[\^([^\s\]]+)\]:\s?(.*)$/
/** A marker anywhere on a line: `[^name]`, name has no whitespace and no `]`. */
const MARKER_RE = /\[\^([^\s\]]+)\]/g
/** A fenced-code-block delimiter line (any indent, ``` or more backticks). */
const FENCE_RE = /^\s*```/

/** Blanks out inline-code spans (\`...\`) while preserving line length, so marker column offsets stay accurate. */
const maskInlineCode = (line: string): string =>
  line.replace(/`[^`]*`/g, (m) => " ".repeat(m.length))

/** A non-blank line that starts with leading whitespace — the shape of a definition's continuation line. */
const isContinuationLine = (line: string): boolean => line.trim().length > 0 && /^\s+\S/.test(line)

/**
 * True when `lines[index]` is part of a footnote definition — either the
 * `[^name]:` start line itself, or one of its indented continuation lines.
 * Walks backward through the contiguous run of indented non-blank lines
 * above `index` to find the start; a blank or unindented line (or the top of
 * `lines`) ends the search with `false`. Exported so `OpenQuestions.ts` and
 * `ReviewDoc.ts` can break their own item/pointer spans on a definition
 * without re-parsing the whole document.
 */
export const isFootnoteDefinitionLine = (lines: readonly string[], index: number): boolean => {
  const line = lines[index]
  if (line === undefined) return false
  if (DEFINITION_START_RE.test(line)) return true
  if (!isContinuationLine(line)) return false

  let i = index - 1
  while (i >= 0) {
    const prev = lines[i]!
    if (DEFINITION_START_RE.test(prev)) return true
    if (!isContinuationLine(prev)) return false
    i -= 1
  }
  return false
}

/** Strips every `[^name]` marker out of `text` — applied to every extracted text field so a marker never leaks into an option's or note's text. */
export const stripFootnoteMarkers = (text: string): string => text.replace(MARKER_RE, "")

const computeFindings = (
  markers: readonly FootnoteMarker[],
  definitions: readonly FootnoteDefinition[],
): readonly SteeringFinding[] => {
  const findings: SteeringFinding[] = []
  const definedNames = new Set(definitions.map((d) => d.name))
  const referencedNames = new Set(markers.map((m) => m.name))
  const seenDefinitionNames = new Set<string>()

  for (const marker of markers) {
    if (!definedNames.has(marker.name)) {
      findings.push({
        message: `Footnote marker "[^${marker.name}]" has no matching definition`,
        line: marker.line,
      })
    }
  }

  for (const def of definitions) {
    if (seenDefinitionNames.has(def.name)) {
      findings.push({
        message: `Duplicate footnote definition "[^${def.name}]"`,
        line: def.line,
      })
    } else {
      seenDefinitionNames.add(def.name)
    }
    if (!referencedNames.has(def.name)) {
      findings.push({
        message: `Footnote definition "[^${def.name}]" has no marker referencing it`,
        line: def.line,
      })
    }
    if (def.body.trim().toLowerCase() === PLACEHOLDER_BODY) {
      findings.push({
        message: `Footnote definition "[^${def.name}]" still has its seeded placeholder body`,
        line: def.line,
      })
    }
  }

  return findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
}

/** Parses the `[^name]:` definition starting at `lines[index]`, plus its indented continuation run. Returns the parsed definition and the index of the first line past it. */
const parseDefinitionAt = (
  lines: readonly string[],
  index: number,
  defMatch: RegExpExecArray,
): { readonly definition: FootnoteDefinition; readonly nextIndex: number } => {
  const name = defMatch[1]!
  const sameLineBody = (defMatch[2] ?? "").trim()
  const bodyParts: string[] = sameLineBody.length > 0 ? [sameLineBody] : []
  let endLine = index
  let j = index + 1
  while (j < lines.length && isContinuationLine(lines[j]!)) {
    bodyParts.push(lines[j]!.trim())
    endLine = j
    j += 1
  }
  return { definition: { name, line: index, endLine, body: bodyParts.join(" ") }, nextIndex: j }
}

/** Every marker on `line` (after masking inline-code spans), anchored at `lineIndex`. */
const scanMarkers = (line: string, lineIndex: number): FootnoteMarker[] => {
  const masked = maskInlineCode(line)
  const re = new RegExp(MARKER_RE)
  const found: FootnoteMarker[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(masked)) !== null) {
    found.push({ name: match[1]!, line: lineIndex, character: match.index })
  }
  return found
}

/**
 * Parses every footnote marker and definition out of `content`. Total and
 * side-effect-free: always returns a result, never throws. Scanning skips
 * fenced code blocks entirely and blanks inline-code spans before looking for
 * markers, so `[^x]` inside either never counts. A definition's own body
 * (same-line plus indented continuation lines) is excluded from marker
 * scanning — a `[^y]` written there is ordinary text.
 */
export const parseFootnotes = (content: string): Footnotes => {
  const lines = content.split(/\r?\n/)
  const markers: FootnoteMarker[] = []
  const definitions: FootnoteDefinition[] = []

  let inFence = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!

    if (FENCE_RE.test(line)) {
      inFence = !inFence
      i += 1
      continue
    }
    if (inFence) {
      i += 1
      continue
    }

    const defMatch = DEFINITION_START_RE.exec(line)
    if (defMatch) {
      const { definition, nextIndex } = parseDefinitionAt(lines, i, defMatch)
      definitions.push(definition)
      i = nextIndex
      continue
    }

    markers.push(...scanMarkers(line, i))
    i += 1
  }

  return { markers, definitions, findings: computeFindings(markers, definitions) }
}
