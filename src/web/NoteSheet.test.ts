import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * T6: "no selection gesture is required to place a note" — the honest gate
 * is a source-grep, not a prose comment claiming there's nothing to assert
 * (`NoteSheet.stories.tsx` used to just say so). The sheet opens purely from
 * an `anchor` prop (`Plan.tsx`/`Review.tsx`/`Hunk.tsx` each call `openNoteSheet`
 * with a `SteeringAnchor` they already have), so `window.getSelection()` and
 * the `Range` API have no reason to appear anywhere in this file OR any of
 * its callers — their presence would mean a selection gesture crept back in.
 */
/** Strips `/** ... *&#47;`, `/* ... *&#47;`, and `// ...` comments — crude (no string-literal awareness), but enough to keep this test from tripping on its own doc comments' PROSE mentioning the very API name it asserts is absent from actual CODE. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

describe("NoteSheet.tsx and its callers use no selection gesture", () => {
  const FILES = [
    "./NoteSheet.tsx",
    "./screens/Plan.tsx",
    "./screens/Review.tsx",
    "./screens/Hunk.tsx",
  ]

  it("contains no window.getSelection()/Range usage anywhere a note sheet is opened", () => {
    for (const relativePath of FILES) {
      const source = stripComments(
        readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"),
      )
      expect(source, `${relativePath} must not call getSelection()`).not.toMatch(
        /getSelection\s*\(/,
      )
      expect(source, `${relativePath} must not reference the Range API`).not.toMatch(
        /\bnew Range\s*\(|\bcreateRange\s*\(/,
      )
    }
  })
})

/**
 * Package 03's own checklist item, enforced as a real grep rather than left
 * to review: the autosave/debounce machinery this package deletes must leave
 * no trace in source — not a renamed variant, not a stray reference in a
 * caller that forgot to update.
 */
describe("no autosave/debounce machinery remains anywhere textboxes save explicitly", () => {
  const FILES = [
    "./NoteSheet.tsx",
    "./screens/Plan.tsx",
    "./screens/Review.tsx",
    "./screens/Question.tsx",
  ]
  const FORBIDDEN = [
    "onAutoSave",
    "autoSaveNote",
    "NOTE_DEBOUNCE_MS",
    "lastAutoSavedRef",
    "FREE_TEXT_DEBOUNCE_MS",
    "runCommitFreeText",
    "commitFreeTextOnBlur",
    "lastCommittedFreeTextRef",
  ]

  it("references none of the removed identifiers", () => {
    for (const relativePath of FILES) {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      for (const identifier of FORBIDDEN) {
        expect(source, `${relativePath} must not reference ${identifier}`).not.toContain(identifier)
      }
    }
  })
})
