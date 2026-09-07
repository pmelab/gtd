import { useRef } from "react"

/**
 * The scroll-preservation half of the two-level shell's "back from the first
 * deck item returns to the list without losing scroll position" acceptance
 * bullet — `Deck.tsx`/`Card.tsx` stay domain-agnostic and know nothing about
 * a "list" scroll position, so any screen composing them into a
 * list-drills-into-a-deck shape (`Review.tsx`, `Plan.tsx`, …) calls this
 * itself: `capture()` right before opening a deck, `restore()` in the deck's
 * own `onExit`. `restore` defers to the next animation frame because the
 * list DOM (and its real scroll height) isn't back in the document until the
 * re-render this same state change triggers has committed.
 */
export const useScrollRestoration = () => {
  const scrollBefore = useRef(0)
  const capture = () => {
    scrollBefore.current = window.scrollY
  }
  const restore = () => {
    requestAnimationFrame(() => window.scrollTo(0, scrollBefore.current))
  }
  return { capture, restore }
}
