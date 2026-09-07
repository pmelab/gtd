/**
 * One row of the "list" half of the two-level shell. Format-agnostic: it
 * knows nothing about chunks, questions or hunks — just a clickable row
 * that a screen wires to open its own `Deck`.
 */
export interface CardProps {
  readonly onOpen: () => void
  readonly children: React.ReactNode
  readonly testId?: string
}

export const Card = ({ onOpen, children, testId }: CardProps) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onOpen}
    style={{
      display: "block",
      width: "100%",
      textAlign: "left",
      padding: "10px 12px",
      borderBottom: "1px solid #333",
      background: "none",
      border: "none",
      borderBottomWidth: 1,
      borderBottomStyle: "solid",
      borderBottomColor: "#333",
      font: "inherit",
      color: "inherit",
    }}
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
