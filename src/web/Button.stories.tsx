import type { Meta, StoryObj } from "@storybook/react-vite"
import { cdp } from "@vitest/browser/context"
import { expect, fn, within } from "storybook/test"
import { Button } from "./Button.js"

const meta: Meta<typeof Button> = {
  component: Button,
}

export default meta

type Story = StoryObj<typeof Button>

/**
 * `context.d.ts`'s own `CDPSession` interface is intentionally empty ("methods
 * are defined by the provider type augmentation") — the playwright provider
 * this project uses supplies `.send()` at runtime, but nothing augments the
 * type in this package, so this is the one narrow cast needed to call it.
 */
interface PlaywrightCdpSession {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
}

/**
 * `Button`'s `active:` utilities only ever apply to a REAL, trusted mouse
 * press — Chromium's `:active` pseudo-class ignores synthetic
 * `fireEvent`/`userEvent.pointer` dispatches entirely (see
 * `Hunk.stories.tsx`'s identical note on its own note-affordance button).
 * The only way to actually observe it here is the raw CDP `Input.
 * dispatchMouseEvent` this test runner exposes via `cdp()` — a real,
 * OS-level-equivalent press the browser can't distinguish from hardware
 * input. Presses and holds at the element's center, runs `duringPress` while
 * held, then always releases.
 */
const withRealMousePress = async (
  element: Element,
  duringPress: () => void | Promise<void>,
): Promise<void> => {
  const rect = element.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  const session = cdp() as unknown as PlaywrightCdpSession
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
  await session.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  })
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

const assertMeets44pxFloor = (element: Element): void => {
  const rect = element.getBoundingClientRect()
  expect(rect.height).toBeGreaterThanOrEqual(44)
  expect(rect.width).toBeGreaterThanOrEqual(44)
}

export const PrimaryDefault: Story = {
  args: { variant: "primary", children: "Primary", onClick: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByText("Primary")
    assertMeets44pxFloor(button)
    expect(getComputedStyle(button).backgroundColor).toBe("rgb(91, 157, 255)")
  },
}

export const PrimaryPressed: Story = {
  args: { variant: "primary", children: "Primary", onClick: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByText("Primary")
    const restColor = getComputedStyle(button).backgroundColor
    await withRealMousePress(button, () => {
      const pressedColor = getComputedStyle(button).backgroundColor
      expect(pressedColor).not.toBe(restColor)
      expect(pressedColor).toBe("rgb(63, 127, 224)")
    })
  },
}

export const PrimaryDisabled: Story = {
  args: { variant: "primary", children: "Primary", disabled: true, onClick: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByText("Primary") as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(getComputedStyle(button).backgroundColor).toBe("rgb(90, 90, 94)")
    button.click()
    expect(args.onClick).not.toHaveBeenCalled()
  },
}

export const SecondaryDefault: Story = {
  args: { variant: "secondary", children: "Secondary", onClick: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByText("Secondary")
    assertMeets44pxFloor(button)
    expect(getComputedStyle(button).backgroundColor).toBe("rgb(28, 28, 30)")
  },
}

export const SecondaryPressed: Story = {
  args: { variant: "secondary", children: "Secondary", onClick: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByText("Secondary")
    const restColor = getComputedStyle(button).backgroundColor
    await withRealMousePress(button, () => {
      const pressedColor = getComputedStyle(button).backgroundColor
      expect(pressedColor).not.toBe(restColor)
      expect(pressedColor).toBe("rgb(107, 107, 112)")
    })
  },
}

export const SecondaryDisabled: Story = {
  args: { variant: "secondary", children: "Secondary", disabled: true, onClick: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByText("Secondary") as HTMLButtonElement
    expect(button.disabled).toBe(true)
    button.click()
    expect(args.onClick).not.toHaveBeenCalled()
  },
}

export const GhostDefault: Story = {
  args: { variant: "ghost", children: "Ghost", onClick: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByText("Ghost")
    assertMeets44pxFloor(button)
    expect(getComputedStyle(button).backgroundColor).toBe("rgba(0, 0, 0, 0)")
  },
}

export const GhostPressed: Story = {
  args: { variant: "ghost", children: "Ghost", onClick: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByText("Ghost")
    const restColor = getComputedStyle(button).backgroundColor
    await withRealMousePress(button, () => {
      const pressedColor = getComputedStyle(button).backgroundColor
      expect(pressedColor).not.toBe(restColor)
      expect(pressedColor).toBe("rgb(28, 28, 30)")
    })
  },
}

export const GhostDisabled: Story = {
  args: { variant: "ghost", children: "Ghost", disabled: true, onClick: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByText("Ghost") as HTMLButtonElement
    expect(button.disabled).toBe(true)
    button.click()
    expect(args.onClick).not.toHaveBeenCalled()
  },
}
