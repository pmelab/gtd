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

export const OpensFromAChunkAnchor: Story = {
  args: { anchor: chunkAnchor, onSave: fn(), onDismiss: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("note-sheet")).toBeInTheDocument()
    await expect(canvas.getByText("Note on this chunk")).toBeInTheDocument()
  },
}

export const OpensFromAHunkAnchor: Story = {
  args: { anchor: hunkAnchor, onSave: fn(), onDismiss: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("note-sheet")).toBeInTheDocument()
    await expect(canvas.getByText("Note on this hunk")).toBeInTheDocument()
  },
}

export const OpensFromAParagraphAnchor: Story = {
  args: { anchor: paragraphAnchor, onSave: fn(), onDismiss: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("note-sheet")).toBeInTheDocument()
    await expect(canvas.getByText("Note on this paragraph")).toBeInTheDocument()
  },
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

// This file contains no `window.getSelection()`/selection-range code anywhere
// — the sheet is opened purely from an `anchor` prop, so no selection
// gesture is ever required to place a note. (Nothing to assert at runtime;
// this is a structural fact about the source, confirmed by reading it.)

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
    // Realistically assertable in jsdom/browser-mode storybook without a real
    // virtual keyboard: the footer holding Save (and the mic) is pinned via
    // `position: fixed`, not merely last in DOM flow — so it stays on screen
    // regardless of textarea scroll height or keyboard overlap. We can't
    // simulate an actual on-screen keyboard shrinking the viewport, so this
    // stops at asserting the fixed placement itself.
    expect(getComputedStyle(footer).position).toBe("fixed")
    await expect(canvas.getByTestId("note-sheet-save")).toBeInTheDocument()
    await expect(canvas.getByTestId("note-sheet-mic")).toBeInTheDocument()
    const sheet = canvas.getByTestId("note-sheet")
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
