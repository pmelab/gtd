import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { viewport } from "../testing/browserContext.js"
import { WorkspaceTrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { Dashboard } from "./Dashboard.js"
import { workspace } from "./dashboard.fixture.js"

const dismissed: unknown[] = []
const started: unknown[] = []

const inbox = {
  items: [
    {
      feed: "boardReady",
      project: "portal",
      key: "1",
      title: "Add login",
      action: "start:work",
      priority: 0,
      blockedBy: [],
      data: null,
      state: "proposed",
      firstSeen: "2026-01-01T00:00:00.000Z",
    },
    {
      feed: "reviews",
      project: "api",
      key: "pr-7",
      title: "Review #7",
      action: "start:review",
      priority: 0,
      blockedBy: [],
      data: null,
      state: "queued",
      firstSeen: "2026-01-01T00:00:00.000Z",
      message: "2 of 2 drives in use (limits.maxDrives)",
    },
  ],
  drives: { inUse: 2, max: 2 },
  feeds: [
    { feed: "boardReady", project: "portal", mode: "propose", every: "5m" },
    {
      feed: "reviews",
      project: "api",
      mode: "propose",
      every: "5m",
      failing: "gh: not logged in",
    },
  ],
}

const meta: Meta<typeof Dashboard> = {
  component: Dashboard,
  decorators: [
    (Story) => (
      <WorkspaceTrpcTestProvider
        resolvers={{
          projects: () => workspace,
          banners: () => [
            {
              kind: "configError",
              message: "gtd.workspace.ts not reloaded: workspace.x: unknown key",
            },
          ],
          inbox: () => inbox,
          dismiss: (input) => {
            dismissed.push(input)
          },
          startItem: (input) => {
            started.push(input)
          },
          terminal: () => ({}),
        }}
      >
        <Story />
      </WorkspaceTrpcTestProvider>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof Dashboard>

/** The dashboard opens on Now, counts what needs you, and shows the workspace's banners. */
export const OpensOnNow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("button", { name: "Now (2)" })).toHaveAttribute(
      "aria-current",
      "true",
    )
    await expect(canvas.getAllByTestId("now-card")).toHaveLength(2)
    await expect(canvas.getByTestId("banner").textContent).toBe(
      "gtd.workspace.ts not reloaded: workspace.x: unknown key",
    )
  },
}

/** On a phone a worktree's detail replaces the list; Close brings the list back. */
export const DetailCoversTheListOnAPhone: Story = {
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Projects" }))
    await userEvent.click(canvas.getByText("login"))
    await expect(canvas.getByTestId("detail")).toBeVisible()
    await expect(canvas.getByRole("navigation", { name: "Views", hidden: true })).not.toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Close" }))
    await expect(canvas.queryByTestId("detail")).not.toBeInTheDocument()
    await expect(canvas.getByRole("navigation", { name: "Views" })).toBeVisible()
  },
}

/** On a wide screen the detail is a pane beside the list, which stays in view. */
export const DetailBesideTheListOnADesktop: Story = {
  play: async ({ canvasElement }) => {
    await viewport(1280, 800)
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Projects" }))
    await userEvent.click(canvas.getByText("plan"))
    const detail = canvas.getByTestId("detail").getBoundingClientRect()
    const list = canvas.getAllByTestId("project")[0]!.getBoundingClientRect()
    await expect(canvas.getAllByTestId("project")[0]).toBeVisible()
    await expect(detail.left).toBeGreaterThanOrEqual(list.right)
    const row = within(canvas.getAllByTestId("project")[1]!).getByText("plan")
    await expect(row.closest("button")).toHaveAttribute("aria-current", "true")
  },
}

/** The Inbox lists what waits, reports failing feeds, and dismisses a proposed item. */
export const InboxDismissesAProposedItem: Story = {
  play: async ({ canvasElement }) => {
    dismissed.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Inbox" }))
    const [item] = await canvas.findAllByTestId("inbox-item")
    await expect(item!.textContent).toContain("proposed · boardReady · portal")
    await expect(canvas.getByTestId("feed-failing").textContent).toBe(
      "feed reviews failing: gh: not logged in",
    )
    await userEvent.click(within(item!).getByRole("button", { name: "Dismiss" }))
    await waitFor(() => expect(dismissed).toEqual([{ feed: "boardReady", key: "1" }]))
  },
}

/** The Inbox shows the drives in use out of maxDrives, why an item waits, and starts a proposed item. */
export const InboxStartsAnItemAndSaysWhyOneWaits: Story = {
  play: async ({ canvasElement }) => {
    started.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Inbox" }))
    await expect((await canvas.findByTestId("drives")).textContent).toBe("2 of 2 drives in use")
    const [proposed, queued] = canvas.getAllByTestId("inbox-item")
    await expect(within(queued!).getByTestId("inbox-message").textContent).toBe(
      "2 of 2 drives in use (limits.maxDrives)",
    )
    await expect(within(queued!).queryByRole("button")).not.toBeInTheDocument()
    await userEvent.click(within(proposed!).getByRole("button", { name: "Start" }))
    await waitFor(() => expect(started).toEqual([{ feed: "boardReady", key: "1" }]))
  },
}

/** A supervisor that cannot be reached is said so, never a blank page. */
export const UnreachableSupervisor: Story = {
  decorators: [
    (Story) => (
      <WorkspaceTrpcTestProvider
        resolvers={{
          projects: () => {
            throw new Error("connection refused")
          },
          banners: () => [],
        }}
      >
        <Story />
      </WorkspaceTrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const notice = await within(canvasElement).findByTestId("dashboard-error")
    await expect(notice.textContent).toBe("Could not reach the supervisor: connection refused")
  },
}
