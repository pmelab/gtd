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

export const Card = ({ onOpen, children, testId, accent }: CardProps) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onOpen}
    className={
      accent === true
        ? "block min-h-11 w-full border-b border-l-4 border-border border-l-accent bg-surface px-3 py-2.5 text-left text-body text-text active:bg-surface"
        : "block min-h-11 w-full border-b border-border px-3 py-2.5 text-left text-body text-text active:bg-surface"
    }
  >
    {children}
  </button>
)

export interface CardListProps {
  readonly children: React.ReactNode
}

/** A plain vertical stack — no more than that; the acceptance criterion is "renders correctly at 390px", which flows for free from block-level rows. */
export const CardList = ({ children }: CardListProps) => (
  <div data-testid="card-list">{children}</div>
)
