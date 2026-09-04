import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"
import { App } from "./App.js"

const meta: Meta<typeof App> = {
  component: App,
}

export default meta

type Story = StoryObj<typeof App>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("gtd")).toBeInTheDocument()
  },
}
