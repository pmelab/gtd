import { useState } from "react"

export interface DeckProps<T> {
  readonly items: readonly T[]
  readonly renderItem: (item: T, index: number) => React.ReactNode
  /** Called instead of advancing past the last item, or retreating before the first — the deck itself holds no notion of "list", so returning to it is the caller's job. */
  readonly onExit: () => void
  /** Uncontrolled by default (the deck owns its own index); pass both to drive it from outside. */
  readonly index?: number
  readonly onIndexChange?: (index: number) => void
}

/** The in-flow back/progress/next row below the deck's content — never absolutely positioned, so it can never overlay `renderItem`'s output. */
const DeckControls = ({
  current,
  total,
  onAdvance,
}: {
  readonly current: number
  readonly total: number
  readonly onAdvance: (delta: number) => void
}) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "12px" }}>
    <button type="button" data-testid="deck-prev" onClick={() => onAdvance(-1)}>
      Back
    </button>
    <span data-testid="deck-progress" style={{ opacity: 0.7, fontSize: 12 }}>
      {current + 1} / {total}
    </span>
    <button type="button" data-testid="deck-next" onClick={() => onAdvance(1)}>
      {current + 1 === total ? "Done" : "Next"}
    </button>
  </div>
)

/**
 * A format-agnostic "one item per screen" deck: no review/question domain
 * knowledge, just an array and a render-prop. Controls are plain flow
 * content below `renderItem`'s output, never absolutely positioned, so they
 * can never overlay it. Exercised by `Deck.stories.tsx`'s `play()` tests; see
 * `Fleet.tsx#FleetView`'s note on why fallow's static CRAP estimate scores it
 * as untested regardless.
 */
// fallow-ignore-next-line complexity
export const Deck = <T,>({ items, renderItem, onExit, index, onIndexChange }: DeckProps<T>) => {
  const [uncontrolledIndex, setUncontrolledIndex] = useState(0)
  const current = index ?? uncontrolledIndex
  const setCurrent = onIndexChange ?? setUncontrolledIndex

  const advance = (delta: number) => {
    const next = current + delta
    if (next < 0 || next >= items.length) {
      onExit()
      return
    }
    setCurrent(next)
  }

  if (items.length === 0) return null
  const item = items[current]

  return (
    <div data-testid="deck">
      <div data-testid="deck-content">{item !== undefined && renderItem(item, current)}</div>
      <DeckControls current={current} total={items.length} onAdvance={advance} />
    </div>
  )
}
