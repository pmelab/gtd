import { useEffect, useRef, useState } from "react"
import type { SteeringAnchor } from "../SteeringFormat.js"
import { Mic } from "./Mic.js"

const ANCHOR_TITLE: Record<SteeringAnchor["kind"], string> = {
  chunk: "Note on this chunk",
  hunk: "Note on this hunk",
  question: "Note",
  option: "Note",
  paragraph: "Note on this paragraph",
}

/** Mirrors `Question.tsx`'s identical `FREE_TEXT_DEBOUNCE_MS` (package 03 Task 5) — one sheet edits exactly one anchor at a time, so there's no per-anchor map to key by, just this sheet's own single in-flight/pending pair. */
const NOTE_DEBOUNCE_MS = 800

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
  /**
   * Debounced write-through (package 03 Task 5) — the SAME raw write function
   * the real `Plan`/`Review` containers already pass as their own
   * `onSaveNote` prop, wired straight through here as well: this never
   * dismisses the sheet or touches `onSave`'s own optimistic-override state,
   * unlike `onSave` itself (a deliberate tap on Save, which also closes the
   * sheet). Without a SEPARATE write path, an unmount (tab close, screen
   * lock) with no Save tap discarded whatever was typed — Requirement B's
   * own failure mode. Absent in `NoteSheet.stories.tsx`'s pure-data stories.
   */
  readonly onAutoSave?: (anchor: SteeringAnchor, text: string) => Promise<unknown>
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
export const NoteSheet = ({
  anchor,
  note,
  onSave,
  onDismiss,
  onDone,
  onAutoSave,
}: NoteSheetProps) => {
  const [text, setText] = useState(note ?? "")

  /** What the debounce/unmount path last actually wrote — seeded from the note this sheet OPENED with, so an untouched note never fires a no-op autosave. Mirrors `Question.tsx`'s `lastCommittedFreeTextRef`. */
  const lastAutoSavedRef = useRef(note ?? "")
  const textRef = useRef(text)
  textRef.current = text
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)

  const runAutoSave = (): void => {
    if (onAutoSave === undefined) return
    if (inFlightRef.current) {
      pendingRef.current = true
      return
    }
    const current = textRef.current
    if (current === lastAutoSavedRef.current) return
    inFlightRef.current = true
    lastAutoSavedRef.current = current
    Promise.resolve(onAutoSave(anchor, current)).finally(() => {
      inFlightRef.current = false
      if (pendingRef.current) {
        pendingRef.current = false
        runAutoSave()
      }
    })
  }

  const clearDebounceTimer = (): void => {
    if (debounceTimerRef.current !== undefined) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = undefined
    }
  }

  const scheduleAutoSave = (): void => {
    clearDebounceTimer()
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = undefined
      runAutoSave()
    }, NOTE_DEBOUNCE_MS)
  }

  /** Unmount commits (Task 5): a pending debounced write flushes immediately rather than being discarded — mirrors `Question.tsx`'s identical unmount-commit. */
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== undefined) {
        clearDebounceTimer()
        runAutoSave()
      }
    }
  }, [])

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
      <label
        htmlFor="note-sheet-textarea"
        style={{ fontSize: 12, opacity: 0.7, padding: "0 12px", display: "block" }}
      >
        Note text
      </label>
      <textarea
        id="note-sheet-textarea"
        data-testid="note-sheet-textarea"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          scheduleAutoSave()
        }}
        onBlur={() => {
          clearDebounceTimer()
          runAutoSave()
        }}
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
          onAttach={(dictated) => {
            setText((prev) => (prev.length > 0 ? `${prev} ${dictated}` : dictated))
            scheduleAutoSave()
          }}
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
          <button
            type="button"
            data-testid="note-sheet-save"
            onClick={() => {
              clearDebounceTimer()
              lastAutoSavedRef.current = text
              onSave(anchor, text)
            }}
          >
            Save
          </button>
          {onDone !== undefined && (
            <button
              type="button"
              data-testid="note-sheet-done"
              onClick={() => {
                clearDebounceTimer()
                lastAutoSavedRef.current = text
                onDone(anchor, text)
              }}
            >
              Save &amp; Done
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
