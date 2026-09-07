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

/**
 * A format-agnostic "one item per screen" deck: no review/question domain
 * knowledge, just an array and a render-prop. Controls are plain flow
 * content below `renderItem`'s output, never absolutely positioned, so they
 * can never overlay it.
 */
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
      <div style={{ display: "flex", justifyContent: "space-between", padding: "12px" }}>
        <button type="button" data-testid="deck-prev" onClick={() => advance(-1)}>
          Back
        </button>
        <span data-testid="deck-progress" style={{ opacity: 0.7, fontSize: 12 }}>
          {current + 1} / {items.length}
        </span>
        <button type="button" data-testid="deck-next" onClick={() => advance(1)}>
          {current + 1 === items.length ? "Done" : "Next"}
        </button>
      </div>
    </div>
  )
}
