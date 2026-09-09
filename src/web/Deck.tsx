import { useState } from "react"
import { Button } from "./Button.js"

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
 * The in-flow back/progress/next row — the `flex flex-col`/`h-dvh` shell's
 * `shrink-0` sibling of the scrollable content (package 02 Task 4). Never
 * `position: fixed`/`sticky`: it stays in normal flow, so it can never
 * overlay content, and it ends up inside the viewport with zero page scroll
 * because the column itself is exactly viewport-tall, not because of
 * anything this row does on its own.
 */
const DeckControls = ({
  current,
  total,
  onAdvance,
}: {
  readonly current: number
  readonly total: number
  readonly onAdvance: (delta: number) => void
}) => (
  <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border p-3">
    <Button variant="secondary" data-testid="deck-prev" onClick={() => onAdvance(-1)}>
      Back
    </Button>
    <span data-testid="deck-progress" className="text-small text-muted">
      {current + 1} / {total}
    </span>
    <Button variant="primary" data-testid="deck-next" onClick={() => onAdvance(1)}>
      {current + 1 === total ? "Done" : "Next"}
    </Button>
  </div>
)

/**
 * A format-agnostic "one item per screen" deck: no review/question domain
 * knowledge, just an array and a render-prop. `flex-1 min-h-0 overflow-auto`
 * is the deck's OWN scroll container (Task 4) — `min-h-0` is mandatory: a
 * flex child's default `min-height: auto` refuses to shrink below its
 * content, which is exactly what pushed the control bar off-screen before.
 * Controls are the container's `shrink-0` sibling, never absolutely
 * positioned, so they can never overlay it.
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
    <div data-testid="deck" className="flex h-full min-h-0 flex-1 flex-col">
      <div data-testid="deck-content" className="min-h-0 flex-1 overflow-auto">
        {item !== undefined && renderItem(item, current)}
      </div>
      <DeckControls current={current} total={items.length} onAdvance={advance} />
    </div>
  )
}
