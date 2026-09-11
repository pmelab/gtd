import { useRef, type RefObject } from "react"

/**
 * The scroll-preservation half of the two-level shell's "back from the first
 * deck item returns to the list without losing scroll position" acceptance
 * bullet — `Deck.tsx`/`Card.tsx` stay domain-agnostic and know nothing about
 * a "list" scroll position, so any screen composing them into a
 * list-drills-into-a-deck shape (`Review.tsx`, `Plan.tsx`, …) calls this
 * itself: `capture(ref)` right before opening a deck, `restore(ref)` in the
 * deck's own `onExit`.
 *
 * Element-based via a REF, not `window`-based (package 02 Task 5): Task 4
 * made the page itself non-scrolling (a viewport-tall flex column with each
 * screen owning its own `overflow-auto` container), so `window.scrollY` is
 * permanently 0 after that change — this hook now reads/writes the
 * caller's own scroll container element instead. Takes a REF (not the
 * element itself) because `restore` fires from the SAME handler that
 * triggers the list to remount (e.g. `setOpen(null)`) — the element doesn't
 * exist in the DOM yet at call time, only once React commits that state
 * change and `requestAnimationFrame` fires on the next frame.
 */
export const useScrollRestoration = () => {
  const scrollBefore = useRef(0)
  const capture = (ref: RefObject<HTMLElement | null>): void => {
    if (ref.current === null) return
    scrollBefore.current = ref.current.scrollTop
  }
  const restore = (ref: RefObject<HTMLElement | null>): void => {
    const target = scrollBefore.current
    requestAnimationFrame(() => {
      if (ref.current !== null) ref.current.scrollTop = target
    })
  }
  return { capture, restore }
}
