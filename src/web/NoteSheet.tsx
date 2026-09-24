import { useEffect, useRef, useState } from "react"
import type { SteeringAnchor } from "../steering/index.js"
import { Button } from "./Button.js"

const ANCHOR_TITLE: Record<SteeringAnchor["kind"], string> = {
  chunk: "Note on this chunk",
  hunk: "Note on this hunk",
  question: "Note",
  option: "Note",
  paragraph: "Note on this block",
}

export interface NoteSheetProps {
  /** Which node the note attaches to — only `chunk`/`hunk`/`paragraph` open this sheet; a title label is all this component derives from the kind. */
  readonly anchor: SteeringAnchor
  /** The anchor's existing note text, when it already carries one — pre-fills the textarea for editing rather than starting a second note. */
  readonly note?: string
  readonly onSave: (anchor: SteeringAnchor, text: string) => void
  readonly onDismiss: () => void
  /**
   * The done action's own trigger point: saves this note AND hands the turn
   * back (writes the steering file, then spawns the configured loop
   * command) — the server's `done` procedure always writes a note at a
   * specific anchor, same as `writeNote`, so THIS sheet (the one place an
   * anchor/text pair is already in hand right before a save) is where a
   * screen wires it up. Absent in a pure-data story/screen that has no
   * loop-lifecycle wiring; the "Save & Done" button then doesn't render at
   * all, never a disabled one.
   */
  readonly onDone?: (anchor: SteeringAnchor, text: string) => void
  /** Overrides the heading `anchor.kind` would pick — the free-text ANSWER slot reuses this sheet, and "Note" is the wrong word for an answer. */
  readonly title?: string
  /** Overrides the field's own label, for the same reason as `title`. */
  readonly label?: string
}

/**
 * One reusable note sheet for all three note-carrying anchors (chunk, hunk,
 * paragraph — never `question`/`option`, those are answered by radio tick
 * elsewhere). Takes the anchor as a prop rather than reading a text
 * selection, so there is deliberately no `window.getSelection()` or
 * selection-range code anywhere in this file — no selection gesture is ever
 * required to place a note.
 */
/** How long the closing animation runs — shared by the stylesheet's own `sheet-out`/`scrim-out` duration and by the timer that unmounts after it. */
const CLOSE_MS = 160

/**
 * Dismissal is ANIMATED, so the sheet has to outlive the gesture that
 * dismissed it: the screens above own the "is a sheet open" state, and
 * calling `onDismiss` straight away unmounts the sheet on the same frame,
 * with nothing left on screen to animate. So `dismiss` plays the exit and
 * hands the dismissal up when it finishes. A save is deliberately NOT routed
 * through here: after a save the reader wants the note visible in the
 * document, not the sheet lingering on its way out.
 */
const useAnimatedDismissal = (onDismiss: () => void) => {
  const [closing, setClosing] = useState(false)
  const dismiss = () => {
    if (closing) return
    setClosing(true)
    setTimeout(onDismiss, CLOSE_MS)
  }
  return {
    phase: closing ? ("out" as const) : ("in" as const),
    dismiss,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") dismiss()
    },
  }
}

/** Focuses the field on open and stops the document behind the scrim scrolling under a touch. */
const useSheetMount = (textareaRef: React.RefObject<HTMLTextAreaElement | null>) => {
  useEffect(() => {
    textareaRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [textareaRef])
}

/** Enter and exit are one-shot keyframes (see `styles.css`), so the pair is picked here rather than inline — a ternary per animated element is what tips this component over its complexity budget. */
const SCRIM_ANIMATION = {
  in: "animate-[scrim-in_160ms_ease-out]",
  out: "animate-[scrim-out_160ms_ease-out_forwards]",
}
const PANEL_ANIMATION = {
  in: "animate-[sheet-in_220ms_cubic-bezier(0.2,0,0,1)]",
  out: "animate-[sheet-out_160ms_ease-out_forwards]",
}

/** The panel's content above the footer — the handle a bottom sheet is read by, the title, and the field. */
const SheetBody = ({
  title,
  label,
  text,
  onTextChange,
  textareaRef,
}: {
  readonly title: string
  readonly label: string
  readonly text: string
  readonly onTextChange: (text: string) => void
  readonly textareaRef: React.RefObject<HTMLTextAreaElement | null>
}) => (
  <>
    {/* The handle is what says "this slid up over the document and can go
        away again", rather than "the screen changed". */}
    <div aria-hidden="true" className="mx-auto mt-2 h-1 w-9 rounded-full bg-divider" />
    <h2 className="p-3 pb-0 text-body font-semibold">{title}</h2>
    <label htmlFor="note-sheet-textarea" className="block px-3 text-small text-muted">
      {label}
    </label>
    {/* The gutter is the WRAPPER's padding, never the field's own margin:
        `styles.css` gives every textarea `width: 100%`, so a margin on the
        field adds to a full-width box and pushes it past the panel's right
        edge. */}
    <div className="flex min-h-0 flex-1 flex-col px-3 pt-1 pb-3">
      <textarea
        id="note-sheet-textarea"
        ref={textareaRef}
        data-testid="note-sheet-textarea"
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        className="min-h-32 flex-1 resize-none"
      />
    </div>
  </>
)

/** The sheet's wording, resolved once: `anchor.kind` names a NOTE by default, and the free-text answer slot overrides both halves because "Note" is the wrong word for an answer. */
const sheetCopy = (
  anchor: SteeringAnchor,
  title: string | undefined,
  label: string | undefined,
): { readonly title: string; readonly label: string } => ({
  title: title ?? ANCHOR_TITLE[anchor.kind],
  label: label ?? "Note text",
})

const SheetFooter = ({
  anchor,
  text,
  onSave,
  onDone,
  onDismiss,
}: {
  readonly anchor: SteeringAnchor
  readonly text: string
  readonly onSave: (anchor: SteeringAnchor, text: string) => void
  readonly onDone?: ((anchor: SteeringAnchor, text: string) => void) | undefined
  readonly onDismiss: () => void
}) => (
  /*
   * Footer is a NORMAL FLOW last child of the panel, deliberately NOT
   * `position: fixed`: `fixed` resolves against the LAYOUT viewport, which on
   * iOS Safari and default Android Chrome does not shrink when a software
   * keyboard opens, so a fixed footer ends up BEHIND the keyboard. Flow
   * placement inside the overlay's own `h-dvh` box (plus `index.html`'s
   * `interactive-widget=resizes-content`) is what keeps it reachable without
   * ever knowing the keyboard's height.
   */
  <div
    data-testid="note-sheet-footer"
    className="flex items-center justify-end gap-2 border-t border-divider bg-page p-3"
  >
    <div className="flex gap-2">
      <Button variant="ghost" data-testid="note-sheet-dismiss" onClick={onDismiss}>
        Cancel
      </Button>
      <Button
        variant="secondary"
        data-testid="note-sheet-save"
        onClick={() => onSave(anchor, text)}
      >
        Save
      </Button>
      {onDone !== undefined && (
        <Button
          variant="primary"
          data-testid="note-sheet-done"
          onClick={() => onDone(anchor, text)}
        >
          Save &amp; Done
        </Button>
      )}
    </div>
  </div>
)

export const NoteSheet = ({
  anchor,
  note,
  onSave,
  onDismiss,
  onDone,
  title,
  label,
}: NoteSheetProps) => {
  const [text, setText] = useState(note ?? "")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const { phase, dismiss, onKeyDown } = useAnimatedDismissal(onDismiss)
  const copy = sheetCopy(anchor, title, label)
  useSheetMount(textareaRef)

  return (
    /*
     * `fixed inset-x-0 top-0 h-dvh`, NOT `inset-0`: `inset-0` resolves
     * against the LAYOUT viewport, which on iOS Safari and default Android
     * Chrome does not shrink when the software keyboard opens, so the
     * bottom-anchored panel would sit behind the keyboard. `h-dvh` plus
     * `index.html`'s `interactive-widget=resizes-content` makes this box
     * end where the keyboard begins, and the panel — a normal-flow child
     * of it — lands above the keyboard without ever knowing its height.
     */
    <div
      data-testid="note-sheet-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      onKeyDown={onKeyDown}
      className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col justify-end"
    >
      {/* A real button, not a click-handling div: dismissing by tapping
          outside is a control, so it is one thing to a screen reader and to
          the keyboard too. The blur is what keeps the document visible
          UNDER the note — the note is about that block, and losing sight of
          it was the cost of the old full-screen takeover. */}
      <button
        type="button"
        data-testid="note-sheet-scrim"
        aria-label="Dismiss the note"
        onClick={dismiss}
        className={`absolute inset-0 cursor-default bg-page/60 backdrop-blur-sm ${SCRIM_ANIMATION[phase]}`}
      />
      <div
        data-testid="note-sheet"
        className={`relative mx-auto flex max-h-full w-full max-w-[430px] flex-col rounded-t-xl border-t border-divider bg-page font-sans shadow-[0_-8px_32px_rgba(0,0,0,0.5)] ${PANEL_ANIMATION[phase]}`}
      >
        <SheetBody
          title={copy.title}
          label={copy.label}
          text={text}
          onTextChange={setText}
          textareaRef={textareaRef}
        />
        <SheetFooter
          anchor={anchor}
          text={text}
          onSave={onSave}
          onDismiss={dismiss}
          onDone={onDone}
        />
      </div>
    </div>
  )
}
