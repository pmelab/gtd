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
  /**
   * Package 04 Task 2's Done control: an optional extra button next to the
   * advance button, rendered ONLY when given — `Review.tsx`'s hunk deck
   * passes neither prop and is entirely unchanged, its last-item advance
   * button still reading "Done". When given, the advance button's own
   * last-item label reverts from "Done" to "Back to list" instead — two
   * buttons both reading "Done" on one screen is the collision this avoids.
   */
  readonly onDone?: () => void
  /** `onDone`'s own button label — required alongside `onDone`, since `Deck` itself carries no domain knowledge of what "done" means for a given caller. */
  readonly doneLabel?: string
}

/** The advance button's own label — "Next" mid-deck; at the last item, "Done" with no separate Done control, else "Back to list" — the collision `DeckControls`'s own doc comment names. Split out so `DeckControls` itself doesn't carry the nested ternary inline. */
const advanceLabel = (isLastItem: boolean, hasDoneControl: boolean): string => {
  if (!isLastItem) return "Next"
  return hasDoneControl ? "Back to list" : "Done"
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
  onDone,
  doneLabel,
}: {
  readonly current: number
  readonly total: number
  readonly onAdvance: (delta: number) => void
  readonly onDone?: () => void
  readonly doneLabel?: string
}) => {
  const isLastItem = current + 1 === total
  return (
    <div
      data-testid="deck-controls"
      className="flex shrink-0 items-center justify-between gap-2 border-t border-border p-3"
    >
      <Button variant="secondary" data-testid="deck-prev" onClick={() => onAdvance(-1)}>
        Back
      </Button>
      <span data-testid="deck-progress" className="text-small text-muted">
        {current + 1} / {total}
      </span>
      <div className="flex gap-2">
        <Button variant="primary" data-testid="deck-next" onClick={() => onAdvance(1)}>
          {advanceLabel(isLastItem, onDone !== undefined)}
        </Button>
        {onDone !== undefined && (
          <Button variant="primary" data-testid="deck-done" onClick={onDone}>
            {doneLabel ?? "Done"}
          </Button>
        )}
      </div>
    </div>
  )
}

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
export const Deck = <T,>({
  items,
  renderItem,
  onExit,
  index,
  onIndexChange,
  onDone,
  doneLabel,
}: DeckProps<T>) => {
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
      <DeckControls
        current={current}
        total={items.length}
        onAdvance={advance}
        {...(onDone !== undefined ? { onDone, doneLabel } : {})}
      />
    </div>
  )
}
