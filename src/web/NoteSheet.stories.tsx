import type { Meta, StoryObj } from "@storybook/react-vite"
import { page } from "@vitest/browser/context"
import { useState } from "react"
import { expect, fireEvent, fn, waitFor, within } from "storybook/test"
import type { SteeringAnchor } from "../SteeringFormat.js"
import { NoteSheet } from "./NoteSheet.js"
import { withRealMousePress } from "./testing/realMousePress.js"

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
    // The footer stays within the sheet's own `maxWidth: 390` box — never a
    // `left/right: 0` span across the full (wider, in a real deployment)
    // device viewport.
    expect(footerRect.width).toBeLessThanOrEqual(sheet.getBoundingClientRect().width)
    expect(sheet.getBoundingClientRect().width).toBeLessThanOrEqual(390)
  },
}

/**
 * A hand-built `onAutoSave` recorded into the DOM (mirroring
 * `Question.stories.tsx#CommitCallRecordingHarness`'s identical reasoning —
 * a closure-captured array goes stale across `NoteSheet`'s own re-renders).
 * `shouldReject` lets ONE story drive both the happy debounce and its
 * refused-then-retried counterpart from the same harness.
 */
const AutoSaveCallRecordingHarness = ({
  anchor,
  shouldReject,
}: {
  readonly anchor: SteeringAnchor
  readonly shouldReject: (callIndex: number) => boolean
}) => {
  const [calls, setCalls] = useState<ReadonlyArray<{ readonly text: string }>>([])
  const onAutoSave = (writtenAnchor: SteeringAnchor, text: string): Promise<unknown> => {
    void writtenAnchor
    const callIndex = calls.length
    setCalls((prev) => [...prev, { text }])
    return shouldReject(callIndex)
      ? Promise.reject(new Error("stale token"))
      : Promise.resolve({ ok: true })
  }
  return (
    <>
      <div data-testid="autosave-calls">{JSON.stringify(calls)}</div>
      <NoteSheet anchor={anchor} onSave={() => {}} onDismiss={() => {}} onAutoSave={onAutoSave} />
    </>
  )
}

/** Package 03's Task 5: 800ms after the last keystroke with no blur/dismiss at all, the note body commits on its own — the SAME debounced write-through `Question.tsx`'s free-text slot gets, extended here to `NoteSheet`'s note body. */
export const NoteBodyCommitsOnItsOwnAfterTheDebounceWithNoBlur: Story = {
  render: (args) => (
    <AutoSaveCallRecordingHarness anchor={args.anchor} shouldReject={() => false} />
  ),
  args: { anchor: paragraphAnchor },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "typed but never blurred" },
    })
    expect(canvas.getByTestId("autosave-calls")).toHaveTextContent("[]")
    await waitFor(
      () => {
        const calls = JSON.parse(
          canvas.getByTestId("autosave-calls").textContent ?? "[]",
        ) as unknown[]
        expect(calls).toHaveLength(1)
      },
      { timeout: 2_000 },
    )
    expect(canvas.getByTestId("autosave-calls")).toHaveTextContent("typed but never blurred")
  },
}

/**
 * A refused autosave must not poison its own retry (spec feedback on
 * package 03): the FIRST debounced write rejects; without rolling
 * `lastAutoSavedRef` back to its pre-write value, the unchanged-since-last-
 * commit guard would then compare the SAME text against itself and silently
 * skip every later debounce/blur/unmount commit — exactly the "nothing
 * typed is silently lost" failure this package exists to close. Blurring
 * after the refusal must fire a SECOND write with the same text.
 *
 * A genuine focus transition (`.focus()` on a DIFFERENT element), not a bare
 * `fireEvent.blur` — this runs against a REAL browser (vitest-browser), and
 * an element that was never actually focused never emits a real blur event
 * no matter what's dispatched at it; `Question.stories.tsx`'s own blur
 * stories get away with the bare form only because their textarea already
 * has synthetic focus tracking from an earlier `fireEvent.focus`-triggering
 * interaction in the same flow.
 */
export const ARefusedAutosaveRetriesOnTheNextBlurRatherThanSilentlySkipping: Story = {
  render: (args) => (
    <AutoSaveCallRecordingHarness anchor={args.anchor} shouldReject={(i) => i === 0} />
  ),
  args: { anchor: paragraphAnchor },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByTestId("note-sheet-textarea") as HTMLTextAreaElement
    textarea.focus()
    await fireEvent.change(textarea, { target: { value: "needs work" } })
    await waitFor(
      () => {
        const calls = JSON.parse(
          canvas.getByTestId("autosave-calls").textContent ?? "[]",
        ) as unknown[]
        expect(calls).toHaveLength(1)
      },
      { timeout: 2_000 },
    )
    // The debounced write above rejected — moving focus away with the SAME,
    // unchanged text must still fire a retry, not silently no-op.
    ;(canvas.getByTestId("note-sheet-dismiss") as HTMLButtonElement).focus()
    await waitFor(() => {
      const calls = JSON.parse(
        canvas.getByTestId("autosave-calls").textContent ?? "[]",
      ) as unknown[]
      expect(calls).toHaveLength(2)
    })
  },
}

/** package 02 Task 6: dismiss/save were bare, unsized buttons — this pins each at the 44px thumb floor. */
export const FooterControlsMeetThe44pxFloor: Story = {
  args: { anchor: chunkAnchor, onSave: fn(), onDismiss: fn(), onDone: fn() },
  play: async ({ canvasElement }) => {
    await page.viewport(390, 844)
    const canvas = within(canvasElement)
    for (const testId of ["note-sheet-dismiss", "note-sheet-save", "note-sheet-done"]) {
      const rect = canvas.getByTestId(testId).getBoundingClientRect()
      expect(rect.height).toBeGreaterThanOrEqual(44)
      expect(rect.width).toBeGreaterThanOrEqual(44)
    }
  },
}

/** package 02 Task 6: no pressed story existed for any of the footer's controls — pinned here against each one's real, trusted-press `active:` colour (save is `secondary`, dismiss is `ghost`, done is `primary`). */
export const FooterControlsPressedStatesDifferFromRest: Story = {
  args: { anchor: chunkAnchor, onSave: fn(), onDismiss: fn(), onDone: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    const dismiss = canvas.getByTestId("note-sheet-dismiss")
    const dismissRest = getComputedStyle(dismiss).backgroundColor
    await withRealMousePress(dismiss, () => {
      expect(getComputedStyle(dismiss).backgroundColor).not.toBe(dismissRest)
      expect(getComputedStyle(dismiss).backgroundColor).toBe("rgb(28, 28, 30)")
    })

    const save = canvas.getByTestId("note-sheet-save")
    const saveRest = getComputedStyle(save).backgroundColor
    await withRealMousePress(save, () => {
      expect(getComputedStyle(save).backgroundColor).not.toBe(saveRest)
      expect(getComputedStyle(save).backgroundColor).toBe("rgb(107, 107, 112)")
    })

    const done = canvas.getByTestId("note-sheet-done")
    const doneRest = getComputedStyle(done).backgroundColor
    await withRealMousePress(done, () => {
      expect(getComputedStyle(done).backgroundColor).not.toBe(doneRest)
      expect(getComputedStyle(done).backgroundColor).toBe("rgb(63, 127, 224)")
    })
  },
}
