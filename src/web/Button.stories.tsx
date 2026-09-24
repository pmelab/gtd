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
