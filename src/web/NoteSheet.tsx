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
export const NoteSheet = ({ anchor, note, onSave, onDismiss }: NoteSheetProps) => {
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
       * Footer is a fixed-position element at the bottom of the sheet's own
       * viewport-height box, not just flow-order-last — so the save control
       * stays reachable even when a software keyboard covers the lower part
       * of the screen. jsdom/vitest-browser can't simulate an actual
       * on-screen keyboard, so the story only asserts the footer's
       * `position: fixed` placement and the textarea/footer DOM order, not a
       * real keyboard-avoidance measurement.
       */}
      <div
        data-testid="note-sheet-footer"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
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
          {(state) =>
            state.available ? (
              <button type="button" data-testid="note-sheet-mic" onClick={state.toggle}>
                {state.recording ? "Stop" : "Dictate"}
              </button>
            ) : (
              <span data-testid="note-sheet-mic-hint" style={{ fontSize: 12, opacity: 0.7 }}>
                Use your keyboard's mic key to dictate
              </span>
            )
          }
        </Mic>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" data-testid="note-sheet-dismiss" onClick={onDismiss}>
            Cancel
          </button>
          <button type="button" data-testid="note-sheet-save" onClick={() => onSave(anchor, text)}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
