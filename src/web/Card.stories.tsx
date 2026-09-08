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

/** A fourth item, distinct from `ITEMS` (`ListOfCards`/`OpeningACardsDeck`/`BackFromFirstItemReturnsToListWithoutLosingScroll` all assert exact text against alpha/beta/gamma's own short `"<item> detail"` rendering — reusing one of them for a long-text stress test would break those), used ONLY by the 390px width story below. */
const LONG_DETAIL_ITEM = "delta"

/**
 * A realistically long, normally space-breakable sentence (~180 characters,
 * matching a real chunk/question's own prose length) — long enough that it
 * only stays within a 390px container if the container's block-level width
 * actually clamps it and the browser's own default text wrapping (breaking
 * at whitespace, which this content HAS) does its job, unlike three short
 * words like "alpha"/"beta"/"gamma" which could never overflow any width
 * regardless of whether the container constrains anything at all — exactly
 * what made the old 390px check here tautological. Deliberately NOT a
 * single unbreakable token: `Hunk.tsx`'s own diff lines are `white-space:
 * pre` by design (an intentional horizontal-scroll for code, not a bug),
 * so "no unbreakable content may ever overflow 390px" isn't actually this
 * shell's contract — realistic prose wrapping is.
 */
const LONG_DETAIL =
  "This is a realistically long paragraph of detail text, the kind a real " +
  "chunk or question in the review or plan screen might actually carry, " +
  "long enough to prove the 390px container really does wrap it."

/**
 * The two-level shell as a screen would actually wire it: a list of
 * `Card`s, each opening a `Deck` of the same item repeated so a deck of
 * one item is exercised too. Lives here (not in Card.tsx) because Card and
 * Deck stay domain-agnostic — composing them is a screen's job. Scroll
 * preservation goes through the SAME `useScrollRestoration` hook the real
 * screens (`Review.tsx`, `Plan.tsx`) use, not a one-off `useRef` — this demo
 * is what proves the hook itself works, not a parallel reimplementation.
 *
 * ONE `maxWidth: 390` wrapper around BOTH the list AND the deck branch —
 * mirroring how a real screen (`Plan.tsx`'s `plan-screen`, `Review.tsx`'s
 * `review-screen`) wraps its own single outer container regardless of which
 * of the two it's currently showing — rather than the list hardcoding its
 * own `maxWidth` in isolation while the deck branch, "the other half of the
 * shell", was never measured at all.
 */
const TwoLevelShellDemo = ({ items = ITEMS }: { readonly items?: readonly string[] }) => {
  const [open, setOpen] = useState<string | null>(null)
  const { capture, restore } = useScrollRestoration()

  return (
    <div style={{ maxWidth: 390 }} data-testid="shell-container">
      {open !== null ? (
        <Deck
          items={[open]}
          renderItem={(item) => (
            <p data-testid="deck-item-detail">
              {item === LONG_DETAIL_ITEM ? LONG_DETAIL : `${item} detail`}
            </p>
          )}
          onExit={() => {
            setOpen(null)
            restore()
          }}
        />
      ) : (
        <div data-testid="shell-list">
          {items.map((item) => (
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
      )}
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

/**
 * Measures BOTH halves of "the shell" at 390px — the list AND the deck
 * (the deck was never measured at all before this) — using an item whose
 * own rendered content is a realistically long paragraph, not three short
 * words that could never overflow any width regardless of whether the
 * container actually constrains it.
 */
export const RendersCorrectlyAt390pxWide: Story = {
  render: () => <TwoLevelShellDemo items={[...ITEMS, LONG_DETAIL_ITEM]} />,
  play: async ({ canvasElement }) => {
    await page.viewport(390, 844)
    const canvas = within(canvasElement)
    const list = canvas.getByTestId("shell-list")
    expect(list.scrollWidth).toBeLessThanOrEqual(390)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)

    await fireEvent.click(canvas.getByTestId(`card-${LONG_DETAIL_ITEM}`))
    const detail = canvas.getByTestId("deck-item-detail")
    await expect(detail).toHaveTextContent(LONG_DETAIL)
    expect(detail.scrollWidth).toBeLessThanOrEqual(390)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  },
}
