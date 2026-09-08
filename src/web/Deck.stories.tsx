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
    // "exactly one item per screen" — asserted both ways: the CURRENT item
    // is present, and every OTHER item is absent. `getByText` alone (present
    // only) would still pass a mutant that stacks every item via
    // `items.map(renderItem)`; the negative half is what actually pins it.
    await expect(canvas.getByText("one")).toBeInTheDocument()
    expect(canvas.queryByText("two")).not.toBeInTheDocument()
    expect(canvas.queryByText("three")).not.toBeInTheDocument()

    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByText("two")).toBeInTheDocument()
    expect(canvas.queryByText("one")).not.toBeInTheDocument()
    expect(canvas.queryByText("three")).not.toBeInTheDocument()

    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByText("three")).toBeInTheDocument()
    expect(canvas.queryByText("one")).not.toBeInTheDocument()
    expect(canvas.queryByText("two")).not.toBeInTheDocument()
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
    // `position: static` specifically — NOT merely "not absolute": `fixed`
    // and `sticky` both pass an `!== "absolute"` check yet can still overlay
    // or detach from flow exactly like `absolute` does (the precise
    // regression `NoteSheet.tsx`'s own footer once had).
    expect(contentStyle.position).toBe("static")
    expect(controlsStyle.position).toBe("static")
    // The geometric guarantee an "overlay" check should actually make: the
    // controls' own box starts at or below where the content's box ends —
    // never overlapping it, regardless of what `position` value produced
    // the layout.
    const contentRect = content.getBoundingClientRect()
    const controlsRect = (controls.parentElement ?? controls).getBoundingClientRect()
    expect(controlsRect.top).toBeGreaterThanOrEqual(contentRect.bottom)
  },
}
