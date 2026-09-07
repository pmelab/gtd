import type { DiffResult, FileDiff } from "../../serve/Diff.js"
import type { SteeringViewNode } from "../../SteeringFormat.js"
import { highlightDiffLine } from "../Highlight.js"

export interface HunkProps {
  /** The `review`-view hunk node this screen renders — `title`/`path`/`line` for the header, `checked` seeds nothing here (the caller passes the live `checked` prop below instead, since a chunk-level check-all can move it out from under this node). */
  readonly node: SteeringViewNode
  /**
   * The resolved diff for this hunk's own pointer, or `undefined` while it
   * hasn't been fetched — `src/serve/Diff.ts#resolveDiff` already computes
   * this exact shape, but `src/serve/Router.ts` has no `diff` procedure
   * wired to it yet (only `runCommand`/`fleet`/`writeNote`/`view` exist), so
   * there is nothing for a real container to call yet. A future package adds
   * that procedure and a container fetches into this prop — a one-line
   * change here, not a rewrite.
   */
  readonly diff: DiffResult | undefined
  /** This hunk's 0-based position in its chunk's deck, and the deck's total size — rendered as "hunk N of M" so progress is visible without leaving this screen. */
  readonly index: number
  readonly total: number
  readonly checked: boolean
  readonly hasNote: boolean
  readonly onToggle: (checked: boolean) => void
  /** Fires only when ticking (never un-ticking) — the tick IS the approval gesture here, so `Review.tsx` wires this to advance the deck, which exits back to the chunk list on the last hunk. */
  readonly onApprove: () => void
  readonly onOpenNote: () => void
}

const LINE_BACKGROUND: Readonly<Record<string, string>> = {
  add: "#0d2818",
  del: "#2b1113",
  context: "transparent",
  header: "#1a1a1a",
}

const DiffLines = ({ lines }: { readonly lines: readonly string[] }) => (
  <div style={{ fontFamily: "monospace", fontSize: 12, overflowX: "auto" }}>
    {lines.map((line, i) => {
      const { kind, tokens } = highlightDiffLine(line)
      return (
        <div
          key={i}
          data-testid={`diff-line-${i}`}
          data-kind={kind}
          style={{ background: LINE_BACKGROUND[kind], whiteSpace: "pre", padding: "0 8px" }}
        >
          {tokens.map((token, j) => (
            <span key={j} className={token.className}>
              {token.text}
            </span>
          ))}
        </div>
      )
    })}
  </div>
)

const flattenLines = (diff: FileDiff): readonly string[] => diff.hunks.flatMap((h) => h.lines)

/**
 * The deck-level single-hunk screen — `Review.tsx`'s `Deck` `renderItem`, one
 * hunk per screen. Controls sit in flow below the diff, never floating over
 * it, matching T1's shell rule. A `"whole-file"`/`"refused"` diff renders its
 * own banner above the (whole-file) diff rather than an empty screen, per
 * T3's "the pointer did not resolve" acceptance bullet.
 */
export const Hunk = ({
  node,
  diff,
  index,
  total,
  checked,
  hasNote,
  onToggle,
  onApprove,
  onOpenNote,
}: HunkProps) => (
  <div data-testid="hunk-screen">
    <div data-testid="hunk-progress" style={{ fontSize: 12, opacity: 0.7, padding: "8px 12px 0" }}>
      Hunk {index + 1} of {total}
    </div>
    <div style={{ padding: "4px 12px", fontWeight: 600 }}>{node.title}</div>

    {diff === undefined ? (
      <div data-testid="hunk-diff-loading" style={{ padding: 12 }}>
        Loading diff…
      </div>
    ) : diff.kind === "binary" ? (
      <div data-testid="hunk-diff-binary" style={{ padding: 12 }}>
        Binary file — no diff to show.
      </div>
    ) : diff.kind === "refused" ? (
      <div data-testid="hunk-diff-banner" style={{ padding: 12, background: "#3a2a00" }}>
        Could not resolve a diff: {diff.detail}
      </div>
    ) : diff.kind === "whole-file" ? (
      <>
        <div data-testid="hunk-diff-banner" style={{ padding: 12, background: "#3a2a00" }}>
          This pointer did not resolve to a specific hunk — showing the whole file's diff instead.
        </div>
        <DiffLines lines={flattenLines(diff.diff)} />
      </>
    ) : (
      <DiffLines lines={diff.hunk.lines} />
    )}

    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          data-testid="hunk-tick"
          checked={checked}
          onChange={(event) => {
            const next = event.target.checked
            onToggle(next)
            if (next) onApprove()
          }}
        />
        Approve this hunk
      </label>
      <button type="button" data-testid="hunk-note-affordance" onClick={onOpenNote}>
        {hasNote ? "Edit note" : "Add note"}
      </button>
    </div>
  </div>
)
