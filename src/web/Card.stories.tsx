import type { Meta, StoryObj } from "@storybook/react-vite"
import { viewport } from "./testing/browserContext.js"
import { useRef, useState } from "react"
import { expect, fireEvent, within } from "storybook/test"
import { token } from "./testing/palette.js"
import { Card, CardList } from "./Card.js"
import { Deck } from "./Deck.js"
import { withRealMousePress } from "./testing/realMousePress.js"
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
  const listRef = useRef<HTMLDivElement | null>(null)

  return (
    <div className="mx-auto flex h-dvh max-w-[390px] flex-col" data-testid="shell-container">
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
            restore(listRef)
          }}
        />
      ) : (
        <div ref={listRef} data-testid="shell-list" className="min-h-0 flex-1 overflow-auto">
          {items.map((item) => (
            <Card
              key={item}
              testId={`card-${item}`}
              onOpen={() => {
                capture(listRef)
                setOpen(item)
              }}
            >
              {item}
            </Card>
          ))}
          <div className="h-[2000px]" />
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

/** package 02 Task 6: a one-line Card row lands near 38px tall today — this pins it at the 44px thumb floor instead. */
export const OneLineRowMeetsThe44pxFloor: Story = {
  render: () => <TwoLevelShellDemo />,
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    const row = canvas.getByTestId("card-alpha")
    const rect = row.getBoundingClientRect()
    expect(rect.height).toBeGreaterThanOrEqual(44)
    expect(rect.width).toBeGreaterThanOrEqual(44)
  },
}

/** package 02 Task 6: `Card` is the one restyled control not routed through `Button` — it hand-writes its own `active:bg-surface`. Nothing pinned that the pressed state actually differs from rest; this does. */
export const RowPressedStateDiffersFromRest: Story = {
  render: () => <TwoLevelShellDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByTestId("card-alpha")
    const restColor = getComputedStyle(row).backgroundColor
    await withRealMousePress(row, () => {
      const pressedColor = getComputedStyle(row).backgroundColor
      expect(pressedColor).not.toBe(restColor)
      expect(pressedColor).toBe(token("surface"))
    })
  },
}

/** package 02 Task 3: `accent` absent produces the exact class list a `Card` renders today — no new class appears just from the prop existing on the type. */
export const CardWithoutAccentPropIsUnchanged: Story = {
  render: () => (
    <Card testId="plain-card" onOpen={() => {}}>
      plain
    </Card>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByTestId("plain-card")
    // Asserted on what `accent` actually paints, not on a frozen class
    // string: the accent treatment is a left rule plus the surface
    // background, and a plain card carries neither.
    const style = getComputedStyle(card)
    expect(style.borderLeftWidth).toBe("0px")
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)")
  },
}

/** package 02 Task 3: `accent` renders a left accent rule and the `surface` background — asserted on computed style, not by reading any heading/label text. */
export const CardWithAccentPropRendersTheAccentTreatment: Story = {
  render: () => (
    <Card testId="accent-card" onOpen={() => {}} accent>
      accented
    </Card>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByTestId("accent-card")
    const style = getComputedStyle(card)
    expect(style.borderLeftWidth).toBe("4px")
    // `--color-surface`, the SAME rgb `RowPressedStateDiffersFromRest` above
    // pins as the pressed-state background — here it's the RESTING background.
    expect(style.backgroundColor).toBe(token("surface"))
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
    await viewport(390, 844)
    const canvas = within(canvasElement)
    const list = canvas.getByTestId("shell-list")
    list.scrollTop = 500
    await fireEvent.click(canvas.getByTestId("card-gamma"))
    await expect(canvas.getByText("gamma detail")).toBeInTheDocument()
    await fireEvent.click(canvas.getByTestId("deck-prev"))
    const restoredList = canvas.getByTestId("shell-list")
    await expect(restoredList).toBeInTheDocument()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(restoredList.scrollTop).toBe(500)
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
    await viewport(390, 844)
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
