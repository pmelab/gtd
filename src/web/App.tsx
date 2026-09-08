import { useState } from "react"
import { Fleet } from "./screens/Fleet.js"
import type { OpenSteeringTarget } from "./screens/Fleet.js"
import { Plan } from "./screens/Plan.js"
import { Review } from "./screens/Review.js"

/**
 * The whole phone's navigation: the fleet screen (package 02's own
 * requirement: it's the first thing the phone loads) plus, on tapping an
 * openable row, whichever steering screen its `mode` picks — `"review"`
 * always means `Review` (that screen's own `readSteeringFile` call is
 * hardcoded to `mode: "review"`, matching `.gtd/REVIEW.md`'s one format);
 * anything else means `Plan`, the same client-side dispatch `Plan.tsx`'s own
 * doc comment already describes ("never switches on a mode name" is a
 * SERVER-side rule — `View.ts#steeringViewFor` — not a client-side one, and
 * this is the one place picking a SCREEN, never a format, needs to read
 * `mode` at all). `onDone`/`onExit` both return here by clearing `selected` —
 * the done action's own "the phone returns to the fleet list immediately".
 */
export const App = () => {
  const [selected, setSelected] = useState<OpenSteeringTarget | undefined>(undefined)

  if (selected === undefined) {
    return <Fleet onOpen={setSelected} />
  }

  const onDone = () => setSelected(undefined)

  return (
    <div style={{ maxWidth: 390, margin: "0 auto" }}>
      {/* A plain, always-available way back that ISN'T "hand back the turn"
       * — done is the only thing that spawns the loop, so leaving without
       * one must stay possible (the human just wants to look, or changed
       * their mind about editing). */}
      <button
        type="button"
        data-testid="back-to-fleet"
        onClick={onDone}
        style={{
          display: "block",
          padding: "8px 12px",
          border: "none",
          background: "none",
          color: "inherit",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        ← Fleet
      </button>
      {selected.mode === "review" ? (
        <Review worktreePath={selected.worktreePath} filePath={selected.filePath} onDone={onDone} />
      ) : (
        <Plan
          worktreePath={selected.worktreePath}
          filePath={selected.filePath}
          mode={selected.mode}
          onDone={onDone}
        />
      )}
    </div>
  )
}
