import { cdpSession } from "./browserContext.js"

/**
 * `getBoundingClientRect()` is relative to THIS document's own viewport —
 * but the story renders inside an `<iframe>` (`window.frameElement`) that
 * the test harness renders SCALED DOWN to fit the outer page (its own
 * `document.documentElement`'s `innerWidth`/`innerHeight` report the
 * UNSCALED layout size, e.g. 1200×900, while its `getBoundingClientRect()`
 * as measured from the PARENT reports the scaled-down box it actually
 * occupies, e.g. 960×720 — a straight OFFSET is not enough, every
 * coordinate must also be multiplied by that scale factor. CDP's
 * `Input.dispatchMouseEvent` targets the TOP-LEVEL page's real, scaled
 * coordinate space, not the iframe's own unscaled one — get this wrong and
 * a control far from the iframe's origin (e.g. `Deck`'s right-aligned
 * `Next` button) silently receives a click meant for empty space outside
 * the iframe's actual (scaled) bounds, while one close to the origin can
 * accidentally still land inside its own small hit box purely by luck.
 */
const toTopLevelCoordinates = (element: Element): { x: number; y: number } => {
  const rect = element.getBoundingClientRect()
  let x = rect.left + rect.width / 2
  let y = rect.top + rect.height / 2
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let win: any = element.ownerDocument.defaultView
  while (win !== null && win !== win.top) {
    const frameRect = win.frameElement?.getBoundingClientRect()
    if (frameRect === undefined) break
    const scaleX = frameRect.width / win.innerWidth
    const scaleY = frameRect.height / win.innerHeight
    x = frameRect.left + x * scaleX
    y = frameRect.top + y * scaleY
    win = win.parent
  }
  return { x, y }
}

/**
 * Every `active:` Tailwind utility in this codebase (`Button.tsx`, `Card.tsx`)
 * only ever applies to a REAL, trusted mouse press — Chromium's `:active`
 * pseudo-class ignores synthetic `fireEvent`/`userEvent.pointer` dispatches
 * entirely. The only way to actually observe it in this test runner is the
 * raw CDP `Input.dispatchMouseEvent` exposed via `cdp()` — a real,
 * OS-level-equivalent press the browser can't distinguish from hardware
 * input. Presses and holds at the element's center, runs `duringPress` while
 * held, then always releases. Outside that runner (the Storybook dev UI has
 * no CDP) there is no trusted press to assert against, so `duringPress` is
 * SKIPPED rather than run against a state that can never be reached.
 */
export const withRealMousePress = async (
  element: Element,
  duringPress: () => void | Promise<void>,
): Promise<void> => {
  const session = await cdpSession()
  if (session === null) return
  const { x, y } = toTopLevelCoordinates(element)
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
  await session.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  })
  // A dispatched CDP input event resolves once the browser process has
  // ACCEPTED it, not once it has finished hit-testing and style
  // invalidation for that frame — without yielding a frame here, reading
  // `:active`'s computed style can race ahead of the browser actually
  // applying it.
  await new Promise((resolve) => requestAnimationFrame(resolve))
  try {
    await duringPress()
  } finally {
    await session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    })
  }
}
