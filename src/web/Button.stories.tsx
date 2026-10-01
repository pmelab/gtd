import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, within } from "storybook/test"
import { token } from "./testing/palette.js"
import { Button } from "./Button.js"
import { withRealMousePress } from "./testing/realMousePress.js"

const meta: Meta<typeof Button> = {
  component: Button,
}

export default meta

type Story = StoryObj<typeof Button>

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
    expect(getComputedStyle(button).backgroundColor).toBe(token("accent"))
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
      expect(pressedColor).toBe(token("accent-pressed"))
    })
  },
}

export const PrimaryDisabled: Story = {
  args: { variant: "primary", children: "Primary", disabled: true, onClick: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByText("Primary") as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(getComputedStyle(button).backgroundColor).toBe(token("disabled"))
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
    expect(getComputedStyle(button).backgroundColor).toBe(token("surface"))
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
      expect(pressedColor).toBe(token("border"))
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
      expect(pressedColor).toBe(token("surface"))
    })
  },
}

/**
 * Package 03 Task 3's own "exposed to assistive technology, not only
 * visually" bullet: `button.disabled` (the DOM property every `disabled`
 * story above already asserts) is exactly the state a screen reader
 * announces — the browser maps a native `<button disabled>` straight onto
 * the accessibility tree's own disabled flag, with no `aria-disabled`
 * authored anywhere in `Button.tsx`. `:disabled` is the same state CSS
 * selects on (`VARIANT_CLASSES`'s own `disabled:` utilities) — this story
 * pins BOTH readings together so a future change that satisfies one without
 * the other (an `aria-hidden` fake-disabled look, say) fails here.
 */
export const DisabledExposesStateToAssistiveTechnologyNotOnlyVisually: Story = {
  args: { variant: "primary", children: "Primary", disabled: true, onClick: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByText("Primary") as HTMLButtonElement
    // The accessibility-tree reading: a screen reader queries this exact
    // property, not a visual cue.
    expect(button.matches(":disabled")).toBe(true)
    expect(button).toBeDisabled()
    // The visual reading, pinned alongside it so neither assertion stands alone.
    expect(getComputedStyle(button).backgroundColor).toBe(token("disabled"))
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
