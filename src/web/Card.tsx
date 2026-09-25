import { cn } from "./cn.js"

/**
 * One row of the "list" half of the two-level shell. Format-agnostic: it
 * knows nothing about chunks, questions or hunks — just a clickable row
 * that a screen wires to open its own `Deck`.
 */
export interface CardProps {
  readonly onOpen: () => void
  readonly children: React.ReactNode
  readonly testId?: string
  /**
   * Marks this row as the thing to act on (an open question) with a left
   * accent rule plus the `surface` background — absent (every other card:
   * review, fleet, answered rows below their own inert path), the rendered
   * classes are byte-identical to before this prop existed.
   */
  readonly accent?: boolean
}

/**
 * The chevron is the row's only "this opens something" cue: a full-bleed row
 * of plain text reads as a heading, and every tappable row on this client is
 * one. Decorative — the button's own text is the accessible name.
 */
const Chevron = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="size-4 shrink-0 self-center text-muted"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export const Card = ({ onOpen, children, testId, accent }: CardProps) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onOpen}
    className={cn(
      "flex w-full min-h-11 items-start justify-between gap-3 border-b border-divider px-3 py-3 text-left text-body text-text",
      "transition-[scale] duration-150 ease-out active:scale-[0.99] active:bg-surface",
      "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
      accent === true && "border-l-4 border-l-accent bg-surface",
    )}
  >
    <span className="min-w-0 flex-1">{children}</span>
    <Chevron />
  </button>
)

export interface CardListProps {
  readonly children: React.ReactNode
}

/** A plain vertical stack — no more than that; the acceptance criterion is "renders correctly at 390px", which flows for free from block-level rows. */
export const CardList = ({ children }: CardListProps) => (
  <div data-testid="card-list">{children}</div>
)
