import { useState } from "react"
import type { SteeringAnchor } from "../SteeringFormat.js"
import { Mic } from "./Mic.js"

const ANCHOR_TITLE: Record<SteeringAnchor["kind"], string> = {
  chunk: "Note on this chunk",
  hunk: "Note on this hunk",
  question: "Note",
  option: "Note",
  paragraph: "Note on this paragraph",
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
}

/**
 * One reusable note sheet for all three note-carrying anchors (chunk, hunk,
 * paragraph — never `question`/`option`, those are answered by radio tick
 * elsewhere). Takes the anchor as a prop rather than reading a text
 * selection, so there is deliberately no `window.getSelection()` or
 * selection-range code anywhere in this file — no selection gesture is ever
 * required to place a note.
 *
 * Dictated text (via `Mic`) only ever writes into this component's own
 * `text` state; it never calls `onSave` itself — an explicit tap on Save is
 * still required, so dismissing after dictating discards it same as typed
 * text.
 */
export const NoteSheet = ({ anchor, note, onSave, onDismiss, onDone }: NoteSheetProps) => {
  const [text, setText] = useState(note ?? "")

  return (
    <div
      data-testid="note-sheet"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        maxWidth: 390,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h2 style={{ fontSize: 15, padding: "12px 12px 0" }}>{ANCHOR_TITLE[anchor.kind]}</h2>
      <textarea
        data-testid="note-sheet-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{
          flex: 1,
          margin: 12,
          padding: 8,
          fontSize: 16,
          resize: "none",
        }}
      />
      {/*
       * Footer is a NORMAL FLOW last child of the sheet's own `100dvh` flex
       * column — deliberately NOT `position: fixed`. `fixed` resolves
       * against the LAYOUT viewport, which on iOS Safari and default Android
       * Chrome does not shrink when a software keyboard opens — the exact
       * platforms this note sheet targets — so a fixed footer ends up
       * BEHIND the keyboard, not above it, and `left/right: 0` spans the
       * full viewport rather than this sheet's own `maxWidth: 390` box. Flow
       * placement plus `100dvh` PLUS `index.html`'s
       * `interactive-widget=resizes-content` viewport declaration is what
       * actually keeps this reachable: that meta value makes the dynamic
       * viewport (and so this container's own height) shrink to the
       * on-screen keyboard's own available space, and a normal flow child
       * naturally ends up inside whatever's left — never needing to know
       * the keyboard's height itself. jsdom/vitest-browser still can't
       * simulate a real on-screen keyboard, so the story only asserts flow
       * placement (DOM order, `position !== "fixed"`) and viewport width,
       * not an actual keyboard-avoidance measurement.
       */}
      <div
        data-testid="note-sheet-footer"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: 12,
          background: "#111",
          borderTop: "1px solid #333",
        }}
      >
        <Mic
          onAttach={(dictated) =>
            setText((prev) => (prev.length > 0 ? `${prev} ${dictated}` : dictated))
          }
        >
          {(state) => (
            <>
              {state.available ? (
                <button type="button" data-testid="note-sheet-mic" onClick={state.toggle}>
                  {state.recording ? "Stop" : "Dictate"}
                </button>
              ) : (
                <span data-testid="note-sheet-mic-hint" style={{ fontSize: 12, opacity: 0.7 }}>
                  Use your keyboard's mic key to dictate
                </span>
              )}
              {state.interim.length > 0 && (
                <span
                  data-testid="note-sheet-mic-interim"
                  style={{ fontSize: 12, opacity: 0.6, fontStyle: "italic" }}
                >
                  {state.interim}
                </span>
              )}
            </>
          )}
        </Mic>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" data-testid="note-sheet-dismiss" onClick={onDismiss}>
            Cancel
          </button>
          <button type="button" data-testid="note-sheet-save" onClick={() => onSave(anchor, text)}>
            Save
          </button>
          {onDone !== undefined && (
            <button
              type="button"
              data-testid="note-sheet-done"
              onClick={() => onDone(anchor, text)}
            >
              Save &amp; Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
