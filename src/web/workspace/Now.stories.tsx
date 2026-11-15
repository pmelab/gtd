import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { WorkspaceTrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { token } from "../testing/palette.js"
import { nothingNeedsYou, workspace } from "./dashboard.fixture.js"
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

/** Only gates and errors get a card, each with its one primary button; working worktrees fold away. */
export const ShowsOnlyGatesAndErrors: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const cards = canvas.getAllByTestId("now-card")
    await expect(cards.map((c) => c.firstElementChild?.textContent)).toEqual([
      "error (crashed)",
      "needs you (question)",
    ])
    await expect(
      cards.map((c) =>
        within(c)
          .getAllByRole("button")
          .map((b) => b.textContent),
      ),
    ).toEqual([
      ["Retry", "Open"],
      ["Proceed", "Open"],
    ])
    await expect(getComputedStyle(cards[0]!).borderColor).toBe(token("danger"))
    await expect(getComputedStyle(cards[1]!).borderColor).toBe(token("warning"))
    const working = canvas.getByTestId("now-working") as HTMLDetailsElement
    await expect(working.open).toBe(false)
    await expect(within(working).getByText("1 working")).toBeVisible()
  },
}

/** Proceed sends the HEAD commit the page showed, so a moved HEAD is refused. */
export const ProceedSendsTheHeadThePageShowed: Story = {
  play: async ({ canvasElement }) => {
    pressed.length = 0
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Proceed" }))
    await waitFor(() =>
      expect(pressed).toEqual([{ worktree: "/ws/portal-plan", commit: "plan-head" }]),
    )
  },
}

/** A press gtd refuses says why, on the card. */
export const ARefusedPressSaysWhy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }))
    await waitFor(() =>
      expect(canvas.getByTestId("press-error").textContent).toBe(
        "HEAD moved since the page loaded; reload and look again",
      ),
    )
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

export const NothingNeedsYou: Story = {
  args: { projects: nothingNeedsYou },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("now-empty").textContent).toBe(
      "Nothing needs you.",
    )
  },
}
