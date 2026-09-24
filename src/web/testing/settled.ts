/**
 * Waits for every running animation on `element` and its subtree to finish.
 * A story that measures geometry, colour or a press state right after
 * mounting an ANIMATED surface (the note sheet slides up over 220ms) is
 * otherwise sampling a moving box — and would pass or fail on how fast the
 * machine happens to be.
 *
 * DRAINS in a loop rather than awaiting one snapshot of `getAnimations()`: an
 * animation that begins after that snapshot is taken — a mount effect landing
 * a frame late on a loaded runner, or a replacement for one the browser
 * cancelled — is not in it, so a single pass can return with the surface
 * still at the very START of its entrance. That is a real CI failure, not a
 * hypothetical: a sheet measured 278px (its own full height) below rest,
 * exactly `translateY(100%)`, on a run whose twin on the same commit passed.
 *
 * A cancelled animation rejects `finished`; it is also, by definition, no
 * longer running, so it counts as settled here.
 */
export const settled = async (element: Element): Promise<void> => {
  // Bounded because a never-ending animation would otherwise hang the story
  // rather than fail it. No stylesheet in this package declares one today.
  for (let pass = 0; pass < 10; pass++) {
    const running = element.getAnimations({ subtree: true })
    if (running.length === 0) return
    await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)))
  }
}
