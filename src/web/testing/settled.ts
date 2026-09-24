/**
 * Waits for every running animation on `element` and its subtree to finish.
 * A story that measures geometry, colour or a press state right after
 * mounting an ANIMATED surface (the note sheet slides up over 220ms) is
 * otherwise sampling a moving box — and would pass or fail on how fast the
 * machine happens to be.
 */
export const settled = async (element: Element): Promise<void> => {
  await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished))
}
