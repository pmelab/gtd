import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, fn, within } from "storybook/test"
import { Deck } from "./Deck.js"

const meta: Meta<typeof Deck<string>> = {
  component: Deck,
}

export default meta

type Story = StoryObj<typeof Deck<string>>

export const SingleItem: Story = {
  args: {
    items: ["only item"],
    renderItem: (item) => <p>{item}</p>,
    onExit: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("only item")).toBeInTheDocument()
    await expect(canvas.getByTestId("deck-progress")).toHaveTextContent("1 / 1")

    // Advancing past the only item exits without crashing.
    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(args.onExit).toHaveBeenCalledTimes(1)

    // Retreating before the only item also exits, not underflows.
    await fireEvent.click(canvas.getByTestId("deck-prev"))
    await expect(args.onExit).toHaveBeenCalledTimes(2)
  },
}

export const AdvancingThroughItems: Story = {
  args: {
    items: ["one", "two", "three"],
    renderItem: (item) => <p>{item}</p>,
    onExit: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("one")).toBeInTheDocument()
    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByText("two")).toBeInTheDocument()
    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByText("three")).toBeInTheDocument()
    await expect(canvas.getByTestId("deck-progress")).toHaveTextContent("3 / 3")
  },
}

export const AdvancingPastTheLastItemReturnsToTheList: Story = {
  args: {
    items: ["one", "two"],
    renderItem: (item) => <p>{item}</p>,
    onExit: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByText("two")).toBeInTheDocument()
    await expect(args.onExit).not.toHaveBeenCalled()
    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(args.onExit).toHaveBeenCalledTimes(1)
  },
}

export const BackFromTheFirstItemReturnsToTheList: Story = {
  args: {
    items: ["one", "two"],
    renderItem: (item) => <p>{item}</p>,
    onExit: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("one")).toBeInTheDocument()
    await fireEvent.click(canvas.getByTestId("deck-prev"))
    await expect(args.onExit).toHaveBeenCalledTimes(1)
  },
}

export const ControlsRenderBelowContentNeverOverlaying: Story = {
  args: {
    items: ["one"],
    renderItem: (item) => <p data-testid="deck-item-content">{item}</p>,
    onExit: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const content = canvas.getByTestId("deck-content")
    const controls = canvas.getByTestId("deck-next")
    // Controls are a later sibling in flow, not absolutely positioned over content.
    expect(
      content.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const contentStyle = getComputedStyle(content)
    const controlsStyle = getComputedStyle(controls.parentElement ?? controls)
    expect(contentStyle.position).not.toBe("absolute")
    expect(controlsStyle.position).not.toBe("absolute")
  },
}
