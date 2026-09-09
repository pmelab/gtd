import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, within } from "storybook/test"
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
