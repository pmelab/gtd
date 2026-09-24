import type { DiffResult, FileDiff } from "../../ui/index.js"
import type { SteeringViewNode } from "../../steering/index.js"
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
  /** The attached note's own text, when there is one — shown IN PLACE of the note control, matching a chunk row on the list screen. `hasNote` stays the flag the control reads, since a caller with no note text at all still has one to pass. */
  readonly note?: string
  readonly onToggle: (checked: boolean) => void
  /** Fires only when ticking (never un-ticking) — the tick IS the approval gesture here, so `Review.tsx` wires this to advance the deck, which exits back to the chunk list on the last hunk. */
  readonly onApprove: () => void
  readonly onOpenNote: () => void
}

const LINE_BACKGROUND: Readonly<Record<string, string>> = {
  add: "bg-diff-add",
  del: "bg-diff-del",
  context: "bg-transparent",
  header: "bg-surface",
  // Git's own `\ No newline at end of file` marker — visually distinct from
  // `context` (T8: added/removed/context lines must be distinguishable, and
  // this is deliberately none of the three), never painted as one.
  marker: "bg-surface",
}

/**
 * Token colour per `Highlight.ts#classNameOf`'s five class names. These are
 * palette tokens now, not arbitrary hexes: each one has to clear AA over
 * BOTH diff backgrounds as well as the page, which `tokens.test.ts` pins.
 */
const TOKEN_COLOR: Readonly<Record<string, string>> = {
  com: "text-syntax-com",
  str: "text-syntax-str",
  kw: "text-syntax-kw",
  num: "text-syntax-num",
  typ: "text-syntax-typ",
}

const DiffLines = ({ lines }: { readonly lines: readonly string[] }) => (
  <div className="overflow-x-auto border-y border-divider py-1 font-mono text-small leading-6">
    {/* `min-w-max`: a block-level line sizes to the SCROLL PORT, not to the
        scrollable content, so without a content-width wrapper every line's
        background (`LINE_BACKGROUND`) stops at the initial viewport edge and
        an added/removed line scrolled horizontally shows bare page behind
        its own text. Sizing the wrapper to the widest line also paints every
        row to the SAME width, so the add/del bands stay flush. */}
    <div className="min-w-max">
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
 * Approving is THE gesture of this screen, so its control is painted like
 * one: a full-width bordered row whose checked state is carried by the row's
 * own accent boundary and its label as well as by the tick box (never colour
 * alone). It was a bare native checkbox sitting beside the deck's large
 * primary `Next` button, which read as the smaller of the two choices.
 */
const ApproveRow = ({
  checked,
  onToggle,
  onApprove,
}: {
  readonly checked: boolean
  readonly onToggle: (checked: boolean) => void
  readonly onApprove: () => void
}) => (
  <label
    data-testid="hunk-approve-row"
    className={`flex min-h-11 items-center gap-3 rounded border px-3 py-2 transition-[background-color,border-color] duration-150 ease-out ${
      checked ? "border-accent bg-surface" : "border-border bg-transparent"
    }`}
  >
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
    <span className="font-medium">{checked ? "Approved" : "Approve this hunk"}</span>
  </label>
)

/**
 * With a note attached, the note itself is the control — the same rule a
 * chunk row follows on the list screen: "Edit note" says only that one
 * exists, the note says what it is, and tapping it reopens the sheet that
 * wrote it. The bare label survives as the fallback for a caller that knows
 * a note exists but not what it says.
 */
const NoteAffordance = ({
  hasNote,
  note,
  onOpenNote,
}: {
  readonly hasNote: boolean
  readonly note: string | undefined
  readonly onOpenNote: () => void
}) => (
  <Button
    variant="ghost"
    data-testid="hunk-note-affordance"
    onClick={onOpenNote}
    className={
      hasNote
        ? "w-full rounded border border-divider px-2 py-1 text-left text-small font-normal text-muted"
        : "w-full text-left text-small text-muted"
    }
  >
    {hasNote ? (note ?? "Edit note") : "+ Add note"}
  </Button>
)

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
  note,
  onToggle,
  onApprove,
  onOpenNote,
}: HunkProps) => (
  <div data-testid="hunk-screen">
    {/* Same "N / M" slash notation `Deck.tsx`'s own progress control uses below the content — one notation across the screen, not two ("of" here, "/" there) for what is otherwise the identical count. */}
    <div data-testid="hunk-progress" className="px-3 pt-3 text-small text-muted">
      Hunk {index + 1} / {total}
    </div>
    <div className="px-3 pt-0.5 pb-1 font-mono text-body font-semibold break-all">{node.title}</div>
    {node.detail !== undefined && node.detail.length > 0 && (
      <div data-testid="hunk-description" className="px-3 pb-2 text-small text-muted">
        {node.detail}
      </div>
    )}

    <DiffBody diff={diff} />

    <div className="flex flex-col gap-2 p-3">
      <ApproveRow checked={checked} onToggle={onToggle} onApprove={onApprove} />
      <NoteAffordance hasNote={hasNote} note={note} onOpenNote={onOpenNote} />
    </div>
  </div>
)
