import type { Meta, StoryObj } from "@storybook/react-vite"
import { viewport } from "./testing/browserContext.js"
import { useState } from "react"
import { expect, fireEvent, fn, waitFor, within } from "storybook/test"
import { token } from "./testing/palette.js"
import { settled } from "./testing/settled.js"
import type { SteeringAnchor } from "../steering/index.js"
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
    await settled(canvasElement)
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
  play: expectOpensWithTitle("Note on this block"),
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
    await settled(canvasElement)
    const textarea = canvas.getByTestId("note-sheet-textarea") as HTMLTextAreaElement
    expect(textarea.value).toBe("already said this looks fine")
  },
}

export const NoOnDonePropRendersNoDoneButton: Story = {
  args: { anchor: chunkAnchor, onSave: fn(), onDismiss: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await settled(canvasElement)
    await expect(canvas.queryByTestId("note-sheet-done")).not.toBeInTheDocument()
  },
}

/** The done action's own trigger: "Save & Done" fires `onDone` with the SAME anchor/text `onSave` would get — never a second, disjoint save. */
export const SaveAndDoneFiresOnDoneWithTheCurrentText: Story = {
  args: { anchor: paragraphAnchor, onSave: fn(), onDismiss: fn(), onDone: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await settled(canvasElement)
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
    await settled(canvasElement)
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
    await viewport(390, 500) // short viewport stands in for the space left after a keyboard opens
    const canvas = within(canvasElement)
    await settled(canvasElement)
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
 * Package 03's own requirement, verbatim: "Text left unsaved is discarded."
 * Typing into the note body must never write through on its own — not after
 * any elapsed time (there is no debounce left to fire) and not on blur
 * (there is no blur handler left either) — ONLY an explicit tap on Save (or
 * Save & Done) ever calls `onSave`.
 */
export const TypingIntoTheNoteBodyFiresNoWriteEverNotAfterAnyElapsedTimeNorOnBlur: Story = {
  args: { anchor: paragraphAnchor, onSave: fn(), onDismiss: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await settled(canvasElement)
    const textarea = canvas.getByTestId("note-sheet-textarea") as HTMLTextAreaElement
    textarea.focus()
    await fireEvent.change(textarea, { target: { value: "typed but never saved" } })
    // A real wait past the OLD 800ms debounce window — proves no timer fires
    // a write, not just that none has fired yet.
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(args.onSave).not.toHaveBeenCalled()
    // A genuine focus transition, not a bare `fireEvent.blur` — this runs
    // against a real browser (vitest-browser), so only an element that was
    // actually focused first emits a real blur when focus moves away.
    ;(canvas.getByTestId("note-sheet-dismiss") as HTMLButtonElement).focus()
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

/**
 * Same requirement, the unmount half: typing then tearing the sheet down
 * (tab close, screen lock, navigating away) with no Save tap must discard
 * the text — never flush it on the way out. The note sheet no longer has an
 * unmount-commit effect at all.
 */
const UnmountDiscardsHarness = (args: {
  readonly anchor: SteeringAnchor
  readonly onSave: (anchor: SteeringAnchor, text: string) => void
}) => {
  const [mounted, setMounted] = useState(true)
  if (!mounted) return <div data-testid="unmounted" />
  return (
    <>
      <button type="button" data-testid="unmount" onClick={() => setMounted(false)}>
        unmount
      </button>
      <NoteSheet anchor={args.anchor} onSave={args.onSave} onDismiss={() => {}} />
    </>
  )
}

export const UnmountingWithoutSavingDiscardsTheText: Story = {
  render: (args) => <UnmountDiscardsHarness anchor={args.anchor} onSave={args.onSave} />,
  args: { anchor: paragraphAnchor, onSave: fn(), onDismiss: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await settled(canvasElement)
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "typed then torn down" },
    })
    await fireEvent.click(canvas.getByTestId("unmount"))
    await waitFor(() => expect(canvas.getByTestId("unmounted")).toBeInTheDocument())
    expect(args.onSave).not.toHaveBeenCalled()
  },
}

/**
 * A harness mirroring the real callers (`Plan.tsx`/`Review.tsx`): `onSave`
 * dismisses the sheet, exactly like their own `saveNote`/`onSave` wrappers do
 * — needed to prove "the sheet dismissed" half of the acceptance, not just
 * the write count.
 */
const SaveDismissesHarness = (args: {
  readonly anchor: SteeringAnchor
  readonly onSave: (anchor: SteeringAnchor, text: string) => void
}) => {
  const [open, setOpen] = useState(true)
  if (!open) return <div data-testid="dismissed" />
  return (
    <NoteSheet
      anchor={args.anchor}
      onSave={(anchor, text) => {
        setOpen(false)
        args.onSave(anchor, text)
      }}
      onDismiss={() => setOpen(false)}
    />
  )
}

/** The only write path left: a deliberate tap on Save fires exactly one call carrying the typed text, and dismisses the sheet. */
export const TappingSaveFiresExactlyOneWriteWithTheTypedText: Story = {
  render: (args) => <SaveDismissesHarness anchor={args.anchor} onSave={args.onSave} />,
  args: { anchor: paragraphAnchor, onSave: fn(), onDismiss: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await settled(canvasElement)
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "final text on save" },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    expect(args.onSave).toHaveBeenCalledTimes(1)
    expect(args.onSave).toHaveBeenCalledWith(paragraphAnchor, "final text on save")
    await waitFor(() => expect(canvas.getByTestId("dismissed")).toBeInTheDocument())
  },
}

/** package 02 Task 6: dismiss/save were bare, unsized buttons — this pins each at the 44px thumb floor. */
export const FooterControlsMeetThe44pxFloor: Story = {
  args: { anchor: chunkAnchor, onSave: fn(), onDismiss: fn(), onDone: fn() },
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    await settled(canvasElement)
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
    await settled(canvasElement)

    // Dismiss is pressed LAST on purpose: releasing a real press over it
    // fires its click, which starts the sheet's exit animation and slides
    // the whole footer off-screen — every later press would then be aimed at
    // coordinates the buttons have already left.
    const save = canvas.getByTestId("note-sheet-save")
    const saveRest = getComputedStyle(save).backgroundColor
    await withRealMousePress(save, () => {
      expect(getComputedStyle(save).backgroundColor).not.toBe(saveRest)
      expect(getComputedStyle(save).backgroundColor).toBe(token("border"))
    })

    const done = canvas.getByTestId("note-sheet-done")
    const doneRest = getComputedStyle(done).backgroundColor
    await withRealMousePress(done, () => {
      expect(getComputedStyle(done).backgroundColor).not.toBe(doneRest)
      expect(getComputedStyle(done).backgroundColor).toBe(token("accent-pressed"))
    })

    const dismiss = canvas.getByTestId("note-sheet-dismiss")
    const dismissRest = getComputedStyle(dismiss).backgroundColor
    await withRealMousePress(dismiss, () => {
      expect(getComputedStyle(dismiss).backgroundColor).not.toBe(dismissRest)
      expect(getComputedStyle(dismiss).backgroundColor).toBe(token("surface"))
    })
  },
}

/**
 * The sheet is a MODAL over its document, not a screen instead of it: the
 * scrim blurs what is behind rather than replacing it, tapping the scrim
 * dismisses, Escape dismisses, and focus lands in the textarea so the
 * keyboard opens on the thing you came to type into.
 */
export const ModalOverTheDocumentNotATakeover: Story = {
  args: { anchor: chunkAnchor, onSave: fn(), onDismiss: fn() },
  render: (args) => (
    <div>
      <p data-testid="behind">A paragraph the note is about.</p>
      <NoteSheet {...args} />
    </div>
  ),
  play: async ({ canvasElement, args }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    await settled(canvasElement)

    // What the sheet covers is still mounted and still painted.
    await expect(canvas.getByTestId("behind")).toBeVisible()

    const scrim = canvas.getByTestId("note-sheet-scrim")
    expect(getComputedStyle(scrim).backdropFilter).toContain("blur")

    // Focus is in the field, not on the document behind it.
    expect(document.activeElement).toBe(canvas.getByTestId("note-sheet-textarea"))

    // The panel is anchored to the bottom of the dynamic viewport — where a
    // thumb is, and where the space left by an open keyboard ends.
    const panel = canvas.getByTestId("note-sheet").getBoundingClientRect()
    expect(panel.bottom).toBeGreaterThan(panel.top)
    expect(Math.abs(panel.bottom - window.innerHeight)).toBeLessThanOrEqual(1)

    // Nothing runs past the panel's own edges — the field is full-width by
    // default, so its gutter has to come from a wrapper, not its own margin.
    const panelElement = canvas.getByTestId("note-sheet")
    expect(panelElement.scrollWidth).toBeLessThanOrEqual(panelElement.clientWidth)
    const field = canvas.getByTestId("note-sheet-textarea").getBoundingClientRect()
    expect(field.right).toBeLessThanOrEqual(panel.right)
    expect(field.left).toBeGreaterThanOrEqual(panel.left)

    // Dismissal plays the exit first and hands up the dismissal when it
    // finishes — so it arrives a frame or two later, never on the gesture.
    await fireEvent.keyDown(canvas.getByTestId("note-sheet-overlay"), { key: "Escape" })
    await waitFor(() => expect(args.onDismiss).toHaveBeenCalled())
  },
}

/**
 * The sheet ARRIVES and LEAVES rather than appearing and vanishing: it
 * slides from below on open, and on dismiss it plays its exit first and only
 * then hands the dismissal up — the screens above own the "a sheet is open"
 * state, so calling back immediately would unmount it mid-animation with
 * nothing left to see. Asserted through the Web Animations API, not a
 * sampled pixel, which is the only way to say "there IS an animation" rather
 * than "the box happened to be somewhere" on a slow machine.
 */
export const TheSheetSlidesInAndPlaysItsExitBeforeDismissing: Story = {
  args: { anchor: chunkAnchor, onSave: fn(), onDismiss: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const panel = canvas.getByTestId("note-sheet")

    // On mount it is actually animating, and it starts below its resting
    // place rather than cross-fading in position.
    const entering = panel.getAnimations()
    expect(entering).toHaveLength(1)
    await settled(canvasElement)
    // Polled, not read once: `finished` resolving is a microtask, and the
    // style with the animation removed is only guaranteed by the next
    // rendering update — so the first rect after it can still carry the
    // entrance transform.
    await waitFor(() =>
      expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight + 1),
    )

    await fireEvent.click(canvas.getByTestId("note-sheet-dismiss"))
    // Still on screen, now playing its exit — the gesture has not yet
    // reached the screen above.
    expect(panel.getAnimations()).toHaveLength(1)
    expect(args.onDismiss).not.toHaveBeenCalled()
    await waitFor(() => expect(args.onDismiss).toHaveBeenCalled())
  },
}
