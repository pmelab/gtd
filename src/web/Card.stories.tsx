import type { Meta, StoryObj } from "@storybook/react-vite"
import { page } from "@vitest/browser/context"
import { useState } from "react"
import { expect, fireEvent, within } from "storybook/test"
import { Card, CardList } from "./Card.js"
import { Deck } from "./Deck.js"
import { useScrollRestoration } from "./useScrollRestoration.js"

const meta: Meta<typeof CardList> = {
  component: CardList,
}

export default meta

type Story = StoryObj<typeof CardList>

const ITEMS = ["alpha", "beta", "gamma"]

/**
 * The two-level shell as a screen would actually wire it: a list of
 * `Card`s, each opening a `Deck` of the same item repeated so a deck of
 * one item is exercised too. Lives here (not in Card.tsx) because Card and
 * Deck stay domain-agnostic — composing them is a screen's job. Scroll
 * preservation goes through the SAME `useScrollRestoration` hook the real
 * screens (`Review.tsx`, `Plan.tsx`) use, not a one-off `useRef` — this demo
 * is what proves the hook itself works, not a parallel reimplementation.
 */
const TwoLevelShellDemo = () => {
  const [open, setOpen] = useState<string | null>(null)
  const { capture, restore } = useScrollRestoration()

  if (open !== null) {
    return (
      <Deck
        items={[open]}
        renderItem={(item) => <p>{item} detail</p>}
        onExit={() => {
          setOpen(null)
          restore()
        }}
      />
    )
  }

  return (
    <div style={{ maxWidth: 390 }} data-testid="shell-list">
      {ITEMS.map((item) => (
        <Card
          key={item}
          testId={`card-${item}`}
          onOpen={() => {
            capture()
            setOpen(item)
          }}
        >
          {item}
        </Card>
      ))}
      <div style={{ height: 2000 }} />
    </div>
  )
}

export const ListOfCards: Story = {
  render: () => <TwoLevelShellDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const item of ITEMS) {
      await expect(canvas.getByTestId(`card-${item}`)).toBeInTheDocument()
    }
  },
}

export const OpeningACardsDeck: Story = {
  render: () => <TwoLevelShellDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("card-beta"))
    await expect(canvas.getByText("beta detail")).toBeInTheDocument()
    await expect(canvas.queryByTestId("shell-list")).not.toBeInTheDocument()
  },
}

export const BackFromFirstItemReturnsToListWithoutLosingScroll: Story = {
  render: () => <TwoLevelShellDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    window.scrollTo(0, 500)
    await fireEvent.click(canvas.getByTestId("card-gamma"))
    await expect(canvas.getByText("gamma detail")).toBeInTheDocument()
    await fireEvent.click(canvas.getByTestId("deck-prev"))
    await expect(canvas.getByTestId("shell-list")).toBeInTheDocument()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(window.scrollY).toBe(500)
  },
}

export const RendersCorrectlyAt390pxWide: Story = {
  render: () => <TwoLevelShellDemo />,
  play: async ({ canvasElement }) => {
    await page.viewport(390, 844)
    const canvas = within(canvasElement)
    const list = canvas.getByTestId("shell-list")
    expect(list.scrollWidth).toBeLessThanOrEqual(390)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  },
}
