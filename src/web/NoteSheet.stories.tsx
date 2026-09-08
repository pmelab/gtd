import type { Meta, StoryObj } from "@storybook/react-vite"
import { page } from "@vitest/browser/context"
import { useState } from "react"
import { expect, fireEvent, fn, waitFor, within } from "storybook/test"
import type { SteeringAnchor } from "../SteeringFormat.js"
import { NoteSheet } from "./NoteSheet.js"

const meta: Meta<typeof NoteSheet> = {
  component: NoteSheet,
}

export default meta

type Story = StoryObj<typeof NoteSheet>

const chunkAnchor: SteeringAnchor = { kind: "chunk", index: 0 }
const hunkAnchor: SteeringAnchor = { kind: "hunk", chunkIndex: 0, index: 1 }
const paragraphAnchor: SteeringAnchor = { kind: "paragraph", line: 12 }

/** Opening the sheet is identical across all three anchor kinds bar the anchor itself and the resulting title — one assertion helper, three thin stories, rather than three near-identical `play` bodies. */
const expectOpensWithTitle =
  (title: string) =>
  async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("note-sheet")).toBeInTheDocument()
    await expect(canvas.getByText(title)).toBeInTheDocument()
  }

export const OpensFromAChunkAnchor: Story = {
  args: { anchor: chunkAnchor, onSave: fn(), onDismiss: fn() },
  play: expectOpensWithTitle("Note on this chunk"),
}

export const OpensFromAHunkAnchor: Story = {
  args: { anchor: hunkAnchor, onSave: fn(), onDismiss: fn() },
  play: expectOpensWithTitle("Note on this hunk"),
}

export const OpensFromAParagraphAnchor: Story = {
  args: { anchor: paragraphAnchor, onSave: fn(), onDismiss: fn() },
  play: expectOpensWithTitle("Note on this paragraph"),
}

export const ExistingNotePrefillsForEditingNotADuplicate: Story = {
  args: {
    anchor: paragraphAnchor,
    note: "already said this looks fine",
    onSave: fn(),
    onDismiss: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByTestId("note-sheet-textarea") as HTMLTextAreaElement
    expect(textarea.value).toBe("already said this looks fine")
  },
}

export const NoOnDonePropRendersNoDoneButton: Story = {
  args: { anchor: chunkAnchor, onSave: fn(), onDismiss: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByTestId("note-sheet-done")).not.toBeInTheDocument()
  },
}

/** The done action's own trigger: "Save & Done" fires `onDone` with the SAME anchor/text `onSave` would get — never a second, disjoint save. */
export const SaveAndDoneFiresOnDoneWithTheCurrentText: Story = {
  args: { anchor: paragraphAnchor, onSave: fn(), onDismiss: fn(), onDone: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByTestId("note-sheet-textarea") as HTMLTextAreaElement
    await fireEvent.change(textarea, { target: { value: "final note before handing back" } })
    await fireEvent.click(canvas.getByTestId("note-sheet-done"))
    await expect(args.onDone).toHaveBeenCalledWith(
      paragraphAnchor,
      "final note before handing back",
    )
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

// T6's "no selection gesture is required to place a note" is pinned as a
// real, enforced source-grep test in `NoteSheet.test.ts` (the sibling `.ts`
// unit test), not left as a claim in a comment here.

const DismissDiscardsHarness = (args: {
  readonly anchor: SteeringAnchor
  readonly note?: string
  readonly onSave: (anchor: SteeringAnchor, text: string) => void
  readonly onDismiss: () => void
}) => {
  const [note, setNote] = useState(args.note ?? "")
  const [open, setOpen] = useState(true)
  if (!open) {
    return (
      <button type="button" data-testid="reopen" onClick={() => setOpen(true)}>
        reopen
      </button>
    )
  }
  return (
    <NoteSheet
      anchor={args.anchor}
      note={note}
      onSave={(anchor, text) => {
        setNote(text)
        args.onSave(anchor, text)
      }}
      onDismiss={() => {
        setOpen(false)
        args.onDismiss()
      }}
    />
  )
}

export const DismissingWithoutSavingDiscardsTheText: Story = {
  render: DismissDiscardsHarness,
  args: {
    anchor: paragraphAnchor,
    note: "original note",
    onSave: fn(),
    onDismiss: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByTestId("note-sheet-textarea") as HTMLTextAreaElement
    await fireEvent.change(textarea, { target: { value: "discard me" } })
    await fireEvent.click(canvas.getByTestId("note-sheet-dismiss"))
    expect(args.onSave).not.toHaveBeenCalled()
    await waitFor(() => expect(canvas.getByTestId("reopen")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("reopen"))
    const reopened = canvas.getByTestId("note-sheet-textarea") as HTMLTextAreaElement
    expect(reopened.value).toBe("original note")
  },
}

export const UsableOneHandedAt390pxWithKeyboardUp: Story = {
  args: { anchor: chunkAnchor, onSave: fn(), onDismiss: fn() },
  play: async ({ canvasElement }) => {
    await page.viewport(390, 500) // short viewport stands in for the space left after a keyboard opens
    const canvas = within(canvasElement)
    const footer = canvas.getByTestId("note-sheet-footer")
    const sheet = canvas.getByTestId("note-sheet")
    // Realistically assertable in jsdom/browser-mode storybook without a real
    // virtual keyboard: the footer is a NORMAL FLOW last child (never
    // `position: fixed`, which resolves against the layout viewport and — on
    // iOS Safari / default Android Chrome — ends up BEHIND an open keyboard
    // rather than above it), so it always lands inside whatever height the
    // sheet's own `100dvh` box actually gets. At this reduced 500px viewport
    // (standing in for keyboard-open space), the footer must still be fully
    // within the visible area, not pushed off past it.
    expect(getComputedStyle(footer).position).not.toBe("fixed")
    const footerRect = footer.getBoundingClientRect()
    expect(footerRect.bottom).toBeLessThanOrEqual(500)
    // The footer is the LAST child in DOM flow, after the textarea — the
    // exact ordering flow placement (rather than an absolute/fixed overlay)
    // depends on.
    const textarea = canvas.getByTestId("note-sheet-textarea")
    expect(textarea.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await expect(canvas.getByTestId("note-sheet-save")).toBeInTheDocument()
    await expect(canvas.getByTestId("note-sheet-mic")).toBeInTheDocument()
    // The footer stays within the sheet's own `maxWidth: 390` box — never a
    // `left/right: 0` span across the full (wider, in a real deployment)
    // device viewport.
    expect(footerRect.width).toBeLessThanOrEqual(sheet.getBoundingClientRect().width)
    expect(sheet.getBoundingClientRect().width).toBeLessThanOrEqual(390)
  },
}

/** Mirrors `Mic.stories.tsx`'s fake — this file exercises the mic wired through `NoteSheet`, not `Mic` standalone. */
interface FakeResult {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}
const fakeResult = (transcript: string, isFinal: boolean): FakeResult => ({
  isFinal,
  0: { transcript },
})

class FakeSpeechRecognition extends EventTarget {
  static instances: FakeSpeechRecognition[] = []
  continuous = false
  interimResults = false
  onresult: ((event: { resultIndex: number; results: FakeResult[] }) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false

  constructor() {
    super()
    FakeSpeechRecognition.instances.push(this)
  }

  start() {
    this.started = true
  }

  stop() {
    this.onend?.()
  }

  emitResult(results: FakeResult[], resultIndex = 0) {
    this.onresult?.({ resultIndex, results })
  }
}

const withApi = () => {
  FakeSpeechRecognition.instances = []
  window.SpeechRecognition = FakeSpeechRecognition as unknown as NonNullable<
    typeof window.SpeechRecognition
  >
}
const withoutApi = () => {
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
}

export const DictationWritesToTheTextareaOnAttachNotToOnSave: Story = {
  args: { anchor: hunkAnchor, onSave: fn(), onDismiss: fn() },
  beforeEach: () => {
    withApi()
    return withoutApi
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("note-sheet-mic"))
    const recognition = FakeSpeechRecognition.instances.at(-1)
    recognition?.emitResult([fakeResult("looks good to me", true)])
    await fireEvent.click(canvas.getByTestId("note-sheet-mic")) // stop -> onend -> write-through on attach
    const textarea = canvas.getByTestId("note-sheet-textarea") as HTMLTextAreaElement
    await waitFor(() => expect(textarea.value).toBe("looks good to me"))
    // Dictation only ever lands in local textarea state; the sheet's own
    // save action is still required before `onSave` fires.
    expect(args.onSave).not.toHaveBeenCalled()
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await expect(args.onSave).toHaveBeenCalledWith(hunkAnchor, "looks good to me")
  },
}

/** T7's OTHER mandated mic mount point — its own fallback branch (no speech API → hidden mic, one-line hint, textarea kept) was untested; only the happy-path mic worked. */
export const NoSpeechApiShowsAHintAndKeepsTheTextarea: Story = {
  args: { anchor: hunkAnchor, onSave: fn(), onDismiss: fn() },
  beforeEach: () => {
    withoutApi()
    return () => {}
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByTestId("note-sheet-mic")).not.toBeInTheDocument()
    await expect(canvas.getByTestId("note-sheet-mic-hint")).toBeInTheDocument()
    const textarea = canvas.getByTestId("note-sheet-textarea") as HTMLTextAreaElement
    await fireEvent.change(textarea, { target: { value: "typed by hand instead" } })
    expect(textarea.value).toBe("typed by hand instead")
  },
}

/** The note sheet's own interim display — displayed but never written through, mirroring `Question.stories.tsx`'s identical proof at the free-text-option layer. */
export const InterimResultsDisplayInTheNoteSheetButNeverWriteThrough: Story = {
  args: { anchor: hunkAnchor, onSave: fn(), onDismiss: fn() },
  beforeEach: () => {
    withApi()
    return withoutApi
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("note-sheet-mic"))
    const recognition = FakeSpeechRecognition.instances.at(-1)
    recognition?.emitResult([fakeResult("still speaking", false)])
    await waitFor(() =>
      expect(canvas.getByTestId("note-sheet-mic-interim")).toHaveTextContent("still speaking"),
    )
    const textarea = canvas.getByTestId("note-sheet-textarea") as HTMLTextAreaElement
    expect(textarea.value).toBe("")
  },
}
