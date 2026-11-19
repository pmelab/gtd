import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { viewport } from "../testing/browserContext.js"
import { WorkspaceTrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { fullWorkspace, statusWorktrees, workspace } from "./dashboard.fixture.js"
import { Detail } from "./Detail.js"
import type { Entry } from "./view.js"

const portal = workspace[1]!
const plan = { project: portal, worktree: portal.worktrees[1]! }

const calls: { procedure: string; input: unknown }[] = []
const record =
  (procedure: string, answer: unknown) =>
  (input: unknown): unknown => {
    calls.push({ procedure, input })
    return answer
  }

const withApi = (resolvers: Record<string, (input: unknown) => unknown>) => [
  (Story: () => React.JSX.Element) => (
    <WorkspaceTrpcTestProvider resolvers={{ projects: () => workspace, ...resolvers }}>
      <Story />
    </WorkspaceTrpcTestProvider>
  ),
]

const meta: Meta<typeof Detail> = {
  component: Detail,
  args: { entry: plan, onClose: fn() },
  decorators: withApi({}),
}

export default meta

type Story = StoryObj<typeof Detail>

/** On a phone the detail covers the screen, the gate page first, with its tab bar at the bottom. */
export const GateFirstFullScreenOnAPhone: Story = {
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    const frame = canvas.getByTitle("Gate page")
    await expect(frame.getAttribute("src")).toBe(plan.worktree.gate)
    const detail = canvas.getByTestId("detail").getBoundingClientRect()
    await expect(detail.width).toBe(window.innerWidth)
    const tabs = canvas.getByRole("navigation", { name: "Worktree" }).getBoundingClientRect()
    await expect(tabs.bottom).toBe(window.innerHeight)
    await expect(canvas.getByRole("button", { name: "Gate" }).getAttribute("aria-current")).toBe(
      "true",
    )
  },
}

/** The embedded gate links to the full gate page in a tab of its own. */
export const OpenInTab: Story = {
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByTestId("open-gate")
    await expect(link.getAttribute("href")).toBe(plan.worktree.gate)
    await expect(link.getAttribute("target")).toBe("_blank")
  },
}

/** The detail offers Gate and Actions, in that order, and no Terminal. */
export const OffersGateThenActions: Story = {
  play: async ({ canvasElement }) => {
    const tabs = within(canvasElement).getByRole("navigation", {
      name: "Worktree",
    })
    await expect(
      within(tabs)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Gate", "Actions"])
  },
}

/** The Actions tab offers the actions for the status, with their fields, and runs the chosen one. */
export const ActionsRunWithTheirFields: Story = {
  decorators: withApi({
    actions: () => ({
      status: "needsYou",
      actions: [
        {
          id: "gate:revise",
          label: "Revise",
          status: "needsYou",
          fields: [
            {
              name: "note",
              type: "text",
              required: true,
              help: "What to change",
            },
            {
              name: "mode",
              type: "select",
              required: false,
              choices: ["fast", "slow"],
            },
            { name: "dry", type: "flag", required: false },
          ],
        },
        { id: "any:shell", label: "Open a shell", status: "any", fields: [] },
      ],
    }),
    runAction: record("runAction", { ok: true }),
  }),
  play: async ({ canvasElement }) => {
    calls.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Actions" }))
    await userEvent.type(await canvas.findByRole("textbox"), "shorter")
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "mode" }), "slow")
    await userEvent.click(canvas.getByRole("checkbox", { name: "dry" }))
    await userEvent.click(canvas.getByRole("button", { name: "Run" }))
    await waitFor(() =>
      expect(calls).toEqual([
        {
          procedure: "runAction",
          input: {
            project: "portal",
            worktree: "/ws/portal-plan",
            action: "gate:revise",
            values: { note: "shorter", mode: "slow", dry: true },
          },
        },
      ]),
    )
  },
}

/** Close returns to the list. */
export const Closes: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Close" }))
    await expect(args.onClose).toHaveBeenCalled()
  },
}

/** Remove first lists what would be lost; a second press confirms, removes and closes the detail. */
export const RemoveAsksToConfirm: Story = {
  decorators: withApi({
    removeWorktree: (input) => {
      calls.push({ procedure: "removeWorktree", input })
      return (input as { confirmed?: boolean }).confirmed === true
        ? { removed: true }
        : {
            confirm: ["the tree has uncommitted changes", "the branch is not integrated"],
          }
    },
  }),
  play: async ({ canvasElement, args }) => {
    calls.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Remove" }))
    await expect((await canvas.findByTestId("remove-confirm")).textContent).toBe(
      "Remove anyway? This loses: the tree has uncommitted changes, the branch is not integrated",
    )
    await userEvent.click(canvas.getByRole("button", { name: "Remove anyway" }))
    await waitFor(() => expect(args.onClose).toHaveBeenCalled())
    await expect(calls).toEqual([
      {
        procedure: "removeWorktree",
        input: {
          project: "portal",
          worktree: "/ws/portal-plan",
          confirmed: false,
        },
      },
      {
        procedure: "removeWorktree",
        input: {
          project: "portal",
          worktree: "/ws/portal-plan",
          confirmed: true,
        },
      },
    ])
  },
}

/** A worktree that Remove keeps shows gtd's reason. */
export const ShowsWhyRemoveKeepsAWorktree: Story = {
  decorators: withApi({
    removeWorktree: () => {
      throw new Error("its driver runs")
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Remove" }))
    await expect((await canvas.findByTestId("remove-error")).textContent).toBe("its driver runs")
  },
}

const MovingRest = (args: React.ComponentProps<typeof Detail>) => {
  const [worktree, setWorktree] = useState(plan.worktree)
  return (
    <>
      <button onClick={() => setWorktree((w) => ({ ...w, label: "Answer the plan again" }))}>
        relabel
      </button>
      <button onClick={() => setWorktree((w) => ({ ...w, head: "c0ffee" }))}>commit</button>
      <Detail {...args} entry={{ ...plan, worktree }} />
    </>
  )
}

/** The gate page loads again once the worktree's HEAD moves on, and only then. */
export const GateFollowsTheRest: Story = {
  render: (args) => <MovingRest {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const first = canvas.getByTitle("Gate page")
    await userEvent.click(canvas.getByRole("button", { name: "relabel" }))
    await expect(canvas.getByTitle("Gate page")).toBe(first)
    await userEvent.click(canvas.getByRole("button", { name: "commit" }))
    await expect(canvas.getByTitle("Gate page")).not.toBe(first)
  },
}

/** The main checkout has no Remove. */
export const NoRemoveOnTheMainCheckout: Story = {
  args: { entry: { project: portal, worktree: portal.worktrees[0]! } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole("button", { name: "Remove" }),
    ).not.toBeInTheDocument()
  },
}

const shop = fullWorkspace[0]!

const detailShows =
  (key: string, status: string, message?: string): NonNullable<Story["play"]> =>
  async ({ canvasElement }) => {
    const detail = within(canvasElement).getByTestId("detail")
    await expect(detail).toHaveTextContent(status)
    if (message) await expect(detail).toHaveTextContent(message)
    await expect(detail).toHaveTextContent(statusWorktrees[key]!.branch!)
  }

const detailOf = (key: string, status: string, message?: string): Story => {
  const entry: Entry = { project: shop, worktree: statusWorktrees[key]! }
  return { args: { entry, onClose: fn() }, play: detailShows(key, status, message) }
}

export const DetailIdle: Story = detailOf("idle", "idle: Idle")
export const DetailIdleWithNote: Story = detailOf("idleNote", "idle: Idle", "merged into main")
export const DetailAtAGateWithNoDriver: Story = detailOf("gate", "needs you: Answer the plan")
export const DetailNeedsYouPermission: Story = detailOf(
  "permission",
  "needs you (permission): Allow the edit",
)
export const DetailNeedsYouQuestion: Story = detailOf(
  "question",
  "needs you (question): Pick a store",
)
export const DetailNeedsYouNoDriverRuns: Story = detailOf(
  "noDriver",
  "needs you: Build the change",
  "no driver runs",
)
export const DetailWorking: Story = detailOf("working", "working: Building")
export const DetailErrorStalled: Story = detailOf(
  "stalled",
  "error (stalled): Stalled",
  "the process cannot go on",
)
export const DetailErrorCrashed: Story = detailOf(
  "crashed",
  "error (crashed): Driver crashed",
  "the driver exited with 1",
)
export const DetailErrorDriver: Story = detailOf(
  "driver",
  "error (driver): Driver failed",
  "the model refused",
)
export const DetailErrorNote: Story = detailOf(
  "note",
  "error (note): Note failed",
  "gh: not logged in",
)
