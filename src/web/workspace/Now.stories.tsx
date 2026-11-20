import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { viewport } from "../testing/browserContext.js"
import { WorkspaceTrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { token } from "../testing/palette.js"
import { fullWorkspace, nothingNeedsYou, workspace } from "./dashboard.fixture.js"
import { Now } from "./Now.js"

const pressed: unknown[] = []

const meta: Meta<typeof Now> = {
  component: Now,
  args: { projects: workspace, onOpen: fn() },
  decorators: [
    (Story) => (
      <WorkspaceTrpcTestProvider
        resolvers={{
          proceed: (input) => {
            pressed.push(input)
          },
          retry: () => {
            throw new Error("HEAD moved since the page loaded; reload and look again")
          },
          projects: () => workspace,
        }}
      >
        <Story />
      </WorkspaceTrpcTestProvider>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof Now>

const statuses = (cards: readonly HTMLElement[]) =>
  cards.map((c) => c.querySelector("[data-status]")?.textContent)

/** Only gates and errors get a card, each opening its detail; working worktrees fold into one row. */
export const ShowsOnlyGatesAndErrors: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const cards = canvas.getAllByTestId("now-card")
    await expect(cards.map((c) => within(c).getByRole("heading").textContent)).toEqual([
      "api/broken",
      "Portal/plan",
    ])
    await expect(statuses(cards)).toEqual(["error (crashed)", "needs you (question)"])
    const [error, gate] = cards.map((c) => c.querySelector<HTMLElement>("[data-status]")!)
    await expect(getComputedStyle(error!).backgroundColor).toBe(token("destructive"))
    await expect(getComputedStyle(gate!).backgroundColor).toBe(token("primary"))
    const working = canvas.getByTestId("now-working")
    await expect(within(working).getByRole("button", { expanded: false })).toBeVisible()
    await expect(within(working).getByText("1 working")).toBeVisible()
    await userEvent.click(within(working).getByRole("button", { expanded: false }))
    await expect(within(working).getByRole("button", { name: /api\/build/ })).toBeVisible()
  },
}

/** The driver's refusal reads as a sentence on the card, its reason kept word for word. */
export const ShowsTheRefusal: Story = {
  play: async ({ canvasElement }) => {
    const refusal = within(canvasElement).getByTestId("refusal")
    await expect(refusal.textContent).toBe(
      "Last press refused. busy: still answering the last question",
    )
  },
}

/** Selecting the refusal text to copy it does not open the detail. */
export const SelectingTextDoesNotOpen: Story = {
  play: async ({ canvasElement, args }) => {
    const refusal = within(canvasElement).getByTestId("refusal")
    window.getSelection()?.selectAllChildren(refusal)
    refusal.click()
    await expect(args.onOpen).not.toHaveBeenCalled()
    window.getSelection()?.removeAllRanges()
  },
}

/** Open takes the worktree to its detail, where the gate page is. */
export const OpenShowsTheDetail: Story = {
  play: async ({ canvasElement, args }) => {
    const [, gate] = within(canvasElement).getAllByRole("button", { name: "Open" })
    await userEvent.click(gate!)
    await expect(args.onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ worktree: expect.objectContaining({ branch: "plan" }) }),
    )
  },
}

/** Gates and errors carry no press button, on a phone or at desktop width. */
export const NoPressButtonOnACard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const width of [390, 1280]) {
      await viewport(width, 844)
      await expect(canvas.queryByRole("button", { name: "Proceed" })).toBeNull()
      await expect(canvas.queryByRole("button", { name: "Retry" })).toBeNull()
    }
  },
}

/** A click on the card body opens the detail; the Open button opens it once. */
export const CardBodyOpensTheDetail: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const [, gate] = canvas.getAllByTestId("now-card")
    await userEvent.click(within(gate!).getByRole("heading"))
    await expect(args.onOpen).toHaveBeenCalledTimes(1)
    await userEvent.click(within(gate!).getByRole("button", { name: "Open" }))
    await expect(args.onOpen).toHaveBeenCalledTimes(2)
  },
}

export const NothingNeedsYou: Story = {
  args: { projects: nothingNeedsYou },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("now-empty").textContent).toBe(
      "Nothing needs you.",
    )
  },
}

export const ListsAttentionFromManyProjects: Story = {
  args: { projects: fullWorkspace },
  play: async ({ canvasElement }) => {
    const cards = within(canvasElement).getAllByTestId("now-card")
    await expect(cards).toHaveLength(16)
    await expect(statuses(cards)).toEqual([
      "needs you",
      "needs you (permission)",
      "needs you (question)",
      "needs you",
      "error (stalled)",
      "error (crashed)",
      "error (driver)",
      "error (note)",
      "needs you",
      "needs you (permission)",
      "needs you (question)",
      "needs you",
      "error (stalled)",
      "error (crashed)",
      "error (driver)",
      "error (note)",
    ])
  },
}

/** On a phone a card's actions keep the thumb floor and the page does not scroll sideways. */
export const ActionsKeepTheThumbFloor: Story = {
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const card = within(canvasElement).getAllByTestId("now-card")[0]!
    for (const button of within(card).getAllByRole("button")) {
      await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    )
  },
}
