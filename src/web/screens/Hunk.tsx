import type { DiffResult, FileDiff } from "../../ui/Diff.js"
import type { SteeringViewNode } from "../../SteeringFormat.js"
import { Button } from "../Button.js"
import { highlightDiffLine } from "../Highlight.js"
import { Notice } from "../Notice.js"

export interface HunkProps {
  /** The `review`-view hunk node this screen renders — `title`/`path`/`line` for the header, `checked` seeds nothing here (the caller passes the live `checked` prop below instead, since a chunk-level check-all can move it out from under this node). */
  readonly node: SteeringViewNode
  /**
   * `src/ui/Diff.ts#resolveDiff`'s closed result for this hunk's own
   * pointer — `undefined` only while `Review.tsx#HunkWithDiff`'s
   * `trpc.diff` query is still in flight, never because the fetch doesn't
   * exist: `Router.ts`'s `diff` procedure and that container are both real.
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
  add: "bg-[#0d2818]",
  del: "bg-[#2b1113]",
  context: "bg-transparent",
  header: "bg-[#1a1a1a]",
  // Git's own `\ No newline at end of file` marker — visually distinct from
  // `context` (T8: added/removed/context lines must be distinguishable, and
  // this is deliberately none of the three), never painted as one.
  marker: "bg-[#1a1a1a]",
}

/**
 * Token color per `Highlight.ts#classNameOf`'s five class names — none of
 * these map onto the shared palette in `styles.css`, so each is an
 * arbitrary-value Tailwind class (package 02 Task 1: one styling mechanism,
 * no `style={{` literal anywhere under `src/web/`, even for one-off colors
 * outside the shared token set).
 */
const TOKEN_COLOR: Readonly<Record<string, string>> = {
  com: "text-[#6a9955]",
  str: "text-[#ce9178]",
  kw: "text-[#569cd6]",
  num: "text-[#b5cea8]",
  typ: "text-[#4ec9b0]",
}

const DiffLines = ({ lines }: { readonly lines: readonly string[] }) => (
  <div className="font-mono text-small overflow-x-auto">
    {lines.map((line, i) => {
      const { kind, tokens } = highlightDiffLine(line)
      return (
        <div
          key={i}
          data-testid={`diff-line-${i}`}
          data-kind={kind}
          className={`${LINE_BACKGROUND[kind]} whitespace-pre px-2`}
        >
          {tokens.map((token, j) => (
            <span
              key={j}
              data-token-kind={token.className}
              className={token.className !== undefined ? TOKEN_COLOR[token.className] : undefined}
            >
              {token.text}
            </span>
          ))}
        </div>
      )
    })}
  </div>
)

/** The whole-file fallback's own lines: each hunk's `@@ ... @@` header FIRST, then its body — never bare bodies concatenated with nothing between them. Without the header, non-contiguous regions of the file render as one continuous block with no visible gap marker; `highlightDiffLine` already renders a `@@` line unhighlighted (T8), but only when one actually reaches it. */
const flattenLines = (diff: FileDiff): readonly string[] =>
  diff.hunks.flatMap((h) => [h.header, ...h.lines])

/** The diff area's own six-way branch (loading / binary / no-changes / refused / whole-file-fallback-with-banner / a single resolved hunk) — split out so `Hunk` itself stays a plain layout shell around it. */
// fallow-ignore-next-line complexity
const DiffBody = ({ diff }: { readonly diff: DiffResult | undefined }) => {
  if (diff === undefined) {
    return (
      <Notice tone="info" data-testid="hunk-diff-loading">
        Loading diff…
      </Notice>
    )
  }
  if (diff.kind === "binary") {
    return (
      <Notice tone="info" data-testid="hunk-diff-binary">
        Binary file — no diff to show.
      </Notice>
    )
  }
  if (diff.kind === "no-changes") {
    return (
      <Notice tone="info" data-testid="hunk-diff-no-changes">
        This path has no changes in the review range.
      </Notice>
    )
  }
  if (diff.kind === "refused") {
    return (
      <Notice tone="error" data-testid="hunk-diff-banner">
        Could not resolve a diff: {diff.detail}
      </Notice>
    )
  }
  if (diff.kind === "whole-file") {
    return (
      <>
        <Notice tone="error" data-testid="hunk-diff-banner">
          This pointer did not resolve to a specific hunk — showing the whole file's diff instead.
        </Notice>
        <DiffLines lines={flattenLines(diff.diff)} />
      </>
    )
  }
  return <DiffLines lines={diff.hunk.lines} />
}

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
    {/* Same "N / M" slash notation `Deck.tsx`'s own progress control uses below the content — one notation across the screen, not two ("of" here, "/" there) for what is otherwise the identical count. */}
    <div data-testid="hunk-progress" className="text-small text-muted px-3 pt-2">
      Hunk {index + 1} / {total}
    </div>
    <div className="px-3 py-1 font-semibold">{node.title}</div>

    <DiffBody diff={diff} />

    <div className="flex flex-col gap-2 p-3">
      <label className="flex min-h-11 items-center gap-2">
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
      <Button variant="ghost" data-testid="hunk-note-affordance" onClick={onOpenNote}>
        {hasNote ? "Edit note" : "Add note"}
      </Button>
    </div>
  </div>
)
