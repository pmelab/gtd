import type { Meta, StoryObj } from "@storybook/react-vite"
import { page } from "@vitest/browser/context"
import { expect, fireEvent, fn, within } from "storybook/test"
import { Deck } from "./Deck.js"
import { withRealMousePress } from "./testing/realMousePress.js"

/**
 * The real ancestor shape `App.tsx` gives every screen — a viewport-tall
 * flex column (`h-dvh flex flex-col`) with the deck as its `flex-1 min-h-0`
 * child — so `Deck`'s own `h-full`/`flex-1` classes have something to
 * actually size against. Mounting `Deck` bare (no such ancestor) would make
 * every geometry assertion below meaningless.
 */
const Shell = ({ children }: { readonly children: React.ReactNode }) => (
  <div className="flex h-dvh flex-col" data-testid="shell">
    {children}
  </div>
)

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

/**
 * The old contract ("position: static") is dropped as of package 02 Task 4:
 * the bar is now IN FLOW as the viewport-tall column's `shrink-0` sibling,
 * so `position` is whatever the browser defaults to (still `static`, but
 * that's no longer the guarantee under test) — the guarantee is geometric:
 * the bar's box lies entirely inside the viewport, the document doesn't
 * page-scroll, and it never starts above where the content box ends.
 */
export const ControlsRenderBelowContentNeverOverlaying: Story = {
  args: {
    items: ["one"],
    renderItem: (item) => <p data-testid="deck-item-content">{item}</p>,
    onExit: fn(),
  },
  render: (args) => (
    <Shell>
      <Deck {...args} />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    await page.viewport(390, 844)
    const canvas = within(canvasElement)
    const content = canvas.getByTestId("deck-content")
    const controls = canvas.getByTestId("deck-next")
    // Controls are a later sibling in flow, not absolutely positioned over content.
    expect(
      content.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const contentRect = content.getBoundingClientRect()
    const controlsRect = (controls.parentElement ?? controls).getBoundingClientRect()
    expect(controlsRect.top).toBeGreaterThanOrEqual(contentRect.bottom)

    // The bar lies entirely inside the 390x844 viewport, and the document
    // itself never page-scrolls to reach it.
    const barRect = (controls.parentElement ?? controls).getBoundingClientRect()
    expect(barRect.top).toBeGreaterThanOrEqual(0)
    expect(barRect.bottom).toBeLessThanOrEqual(844)
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(844)
  },
}

/** package 02 Task 6: Back/Next were bare, unsized buttons — this pins each at the 44px thumb floor, the one control pair the earlier geometry stories never actually measured. */
export const BackAndNextMeetThe44pxFloor: Story = {
  args: {
    items: ["one"],
    renderItem: (item) => <p data-testid="deck-item-content">{item}</p>,
    onExit: fn(),
  },
  render: (args) => (
    <Shell>
      <Deck {...args} />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    await page.viewport(390, 844)
    const canvas = within(canvasElement)
    for (const testId of ["deck-prev", "deck-next"]) {
      const rect = canvas.getByTestId(testId).getBoundingClientRect()
      expect(rect.height).toBeGreaterThanOrEqual(44)
      expect(rect.width).toBeGreaterThanOrEqual(44)
    }
  },
}

/** package 02 Task 6: Back (`Button` `secondary`) and Next (`Button` `primary`) had no pressed story anywhere — this pins both against their real, trusted-press `active:` colour. */
export const BackAndNextPressedStatesDifferFromRest: Story = {
  args: {
    items: ["one"],
    renderItem: (item) => <p data-testid="deck-item-content">{item}</p>,
    onExit: fn(),
  },
  render: (args) => (
    <Shell>
      <Deck {...args} />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    const prev = canvas.getByTestId("deck-prev")
    const prevRest = getComputedStyle(prev).backgroundColor
    await withRealMousePress(prev, () => {
      const pressed = getComputedStyle(prev).backgroundColor
      expect(pressed).not.toBe(prevRest)
      expect(pressed).toBe("rgb(107, 107, 112)") // secondary's active:bg-border
    })

    const next = canvas.getByTestId("deck-next")
    const nextRest = getComputedStyle(next).backgroundColor
    await withRealMousePress(next, () => {
      const pressed = getComputedStyle(next).backgroundColor
      expect(pressed).not.toBe(nextRest)
      expect(pressed).toBe("rgb(63, 127, 224)") // primary's active:bg-accent-pressed
    })
  },
}

/**
 * The stand-in for a keyboard-open layout (`NoteSheet.stories.tsx#141`
 * already established the same `390x500` short viewport for exactly this
 * reason): `interactive-widget=resizes-content` shrinks the layout viewport
 * when the keyboard opens, and `h-dvh` shrinks along with it — the bar must
 * stay reachable at this height too, not just at 844.
 */
export const ControlBarStaysReachableAtAShortKeyboardOpenViewport: Story = {
  args: {
    items: ["one"],
    renderItem: (item) => <p data-testid="deck-item-content">{item}</p>,
    onExit: fn(),
  },
  render: (args) => (
    <Shell>
      <Deck {...args} />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    await page.viewport(390, 500)
    const canvas = within(canvasElement)
    const content = canvas.getByTestId("deck-content")
    const controls = canvas.getByTestId("deck-next")
    const contentRect = content.getBoundingClientRect()
    const barRect = (controls.parentElement ?? controls).getBoundingClientRect()
    expect(barRect.top).toBeGreaterThanOrEqual(contentRect.bottom)
    expect(barRect.top).toBeGreaterThanOrEqual(0)
    expect(barRect.bottom).toBeLessThanOrEqual(500)
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(500)
  },
}

/** Proves the bar stays put (in the viewport, not scrolled away) while a long item's own content scrolls underneath it. */
export const ControlBarStaysPutWhileLongContentScrolls: Story = {
  args: {
    items: ["one"],
    renderItem: () => (
      <div data-testid="deck-item-content" className="h-[3000px]">
        long content
      </div>
    ),
    onExit: fn(),
  },
  render: (args) => (
    <Shell>
      <Deck {...args} />
    </Shell>
  ),
  play: async ({ canvasElement }) => {
    await page.viewport(390, 844)
    const canvas = within(canvasElement)
    const content = canvas.getByTestId("deck-content")
    const controls = canvas.getByTestId("deck-next")
    const bar = controls.parentElement ?? controls
    const barRectBefore = bar.getBoundingClientRect()

    content.scrollTop = 1500
    // The content actually scrolled — otherwise this story would still pass
    // if `overflow-auto`/`min-h-0` were dropped from `deck-content` (the
    // exact regression Task 4 exists to prevent), since the bar's rect would
    // trivially stay unchanged for a container that never scrolls at all.
    expect(content.scrollTop).toBeGreaterThan(0)

    const barRectAfter = bar.getBoundingClientRect()
    expect(barRectAfter.top).toBe(barRectBefore.top)
    expect(barRectAfter.bottom).toBe(barRectBefore.bottom)
    expect(barRectAfter.bottom).toBeLessThanOrEqual(844)
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(844)
  },
}
