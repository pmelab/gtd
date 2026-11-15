import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { viewport } from "../testing/browserContext.js"
import { WorkspaceTrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { Dashboard } from "./Dashboard.js"
import { workspace } from "./dashboard.fixture.js"

const pressed: unknown[] = []

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
      feed: "boardReady",
      project: "portal",
      key: "2",
      title: "Fix logout",
      action: "start:work",
      priority: 0,
      blockedBy: [],
      data: null,
      state: "failed",
      message: "start:work exited 1",
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
  paused: [{ project: "api" }],
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
            pressed.push(["dismiss", input])
          },
          startItem: (input) => {
            pressed.push(["startItem", input])
          },
          retryItem: (input) => {
            pressed.push(["retryItem", input])
          },
          pause: (input) => {
            pressed.push(["pause", input])
          },
          resume: (input) => {
            pressed.push(["resume", input])
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

/** The Inbox lists what waits and reports failing feeds; Start, Retry and Dismiss reach the supervisor. */
export const InboxPressesAnItem: Story = {
  play: async ({ canvasElement }) => {
    pressed.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Inbox" }))
    const [proposed, failed] = await canvas.findAllByTestId("inbox-item")
    await expect(proposed!.textContent).toContain("proposed · boardReady · portal")
    await expect(within(failed!).getByTestId("inbox-message").textContent).toBe(
      "start:work exited 1",
    )
    await expect(canvas.getByTestId("feed-failing").textContent).toBe(
      "feed reviews failing: gh: not logged in",
    )
    await userEvent.click(within(proposed!).getByRole("button", { name: "Start" }))
    await userEvent.click(within(failed!).getByRole("button", { name: "Retry" }))
    await userEvent.click(within(failed!).getByRole("button", { name: "Dismiss" }))
    await waitFor(() =>
      expect(pressed).toEqual([
        ["startItem", { feed: "boardReady", key: "1" }],
        ["retryItem", { feed: "boardReady", key: "2" }],
        ["dismiss", { feed: "boardReady", key: "2" }],
      ]),
    )
  },
}

/** The Inbox shows the drives in use out of maxDrives, and why a queued item waits. */
export const InboxSaysWhyAnItemWaits: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Inbox" }))
    await expect((await canvas.findByTestId("drives")).textContent).toBe("2 of 2 drives in use")
    const queued = canvas.getAllByTestId("inbox-item")[2]
    await expect(within(queued!).getByTestId("inbox-message").textContent).toBe(
      "2 of 2 drives in use (limits.maxDrives)",
    )
    await expect(within(queued!).queryByRole("button")).not.toBeInTheDocument()
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

/** The Inbox pauses and resumes dispatch in the workspace, a project or a feed. */
export const InboxPausesDispatch: Story = {
  play: async ({ canvasElement }) => {
    pressed.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Inbox" }))
    const scopes = await canvas.findAllByTestId("pause-scope")
    await expect(scopes.map((scope) => scope.firstChild?.textContent)).toEqual([
      "workspace · dispatching",
      "api · paused",
      "feed reviews · dispatching",
      "portal · dispatching",
      "feed boardReady · dispatching",
    ])
    await userEvent.click(within(scopes[1]!).getByRole("button", { name: "Resume" }))
    await userEvent.click(within(scopes[4]!).getByRole("button", { name: "Pause" }))
    await waitFor(() =>
      expect(pressed).toEqual([
        ["resume", { project: "api" }],
        ["pause", { project: "portal", feed: "boardReady" }],
      ]),
    )
  },
}
