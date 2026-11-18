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

/** A worktree's detail is a full screen at every width; Close returns to the view it came from. */
export const DetailIsAFullScreen: Story = {
  play: async ({ canvasElement }) => {
    await viewport(1280, 800)
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Projects" }))
    await userEvent.click(canvas.getByText("login"))
    await expect(canvas.getByTestId("detail")).toBeVisible()
    await expect(canvas.queryByTestId("project")).not.toBeInTheDocument()
    await expect(canvas.queryByRole("navigation", { name: "Views" })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(canvas.getAllByTestId("project")).toHaveLength(2))
  },
}

/** A project a person collapsed stays collapsed after a worktree's detail opens and closes. */
export const KeepsProjectTogglesAcrossADetail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Projects" }))
    const api = () => canvas.getByRole("region", { name: "api" })
    await expect(within(api()).getAllByTestId("worktree-row").length).toBeGreaterThan(0)
    await userEvent.click(within(api()).getByRole("button", { name: /api/ }))
    await expect(within(api()).queryAllByTestId("worktree-row")).toHaveLength(0)
    await userEvent.click(canvas.getByText("login"))
    await userEvent.click(await canvas.findByRole("button", { name: "Close" }))
    await waitFor(() => expect(canvas.getAllByTestId("project")).toHaveLength(2))
    await expect(within(api()).queryAllByTestId("worktree-row")).toHaveLength(0)
  },
}

/** Each screen has its own address, and a switch adds a history entry. */
export const ViewsHaveAddresses: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Inbox" }))
    await expect(window.location.search).toBe("?view=inbox")
    await userEvent.click(canvas.getByRole("button", { name: "Projects" }))
    await expect(window.location.search).toBe("?view=projects")
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

/** An inbox the supervisor cannot read says why, never "Loading…" for good. */
export const InboxThatCannotBeRead: Story = {
  decorators: [
    (Story) => (
      <WorkspaceTrpcTestProvider
        resolvers={{
          projects: () => workspace,
          banners: () => [],
          inbox: () => {
            throw new Error("the supervisor is restarting")
          },
        }}
      >
        <Story />
      </WorkspaceTrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Inbox" }))
    await expect((await canvas.findByTestId("inbox-error")).textContent).toBe(
      "Could not read the inbox: the supervisor is restarting",
    )
  },
}

/** A Start or Pause the supervisor turns down shows why beside the control that sent it. */
export const InboxShowsFailedPresses: Story = {
  decorators: [
    (Story) => (
      <WorkspaceTrpcTestProvider
        resolvers={{
          projects: () => workspace,
          banners: () => [],
          inbox: () => inbox,
          startItem: () => {
            throw new Error("no proposed item boardReady/1")
          },
          pause: () => {
            throw new Error("no feed boardReady in portal")
          },
        }}
      >
        <Story />
      </WorkspaceTrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Inbox" }))
    const [proposed, failed] = await canvas.findAllByTestId("inbox-item")
    await userEvent.click(within(proposed!).getByRole("button", { name: "Start" }))
    await expect((await within(proposed!).findByTestId("press-error")).textContent).toBe(
      "no proposed item boardReady/1",
    )
    await expect(within(failed!).queryByTestId("press-error")).not.toBeInTheDocument()
    const scopes = canvas.getAllByTestId("pause-scope")
    await userEvent.click(within(scopes[4]!).getByRole("button", { name: "Pause" }))
    await expect((await canvas.findByTestId("pause-error")).textContent).toBe(
      "no feed boardReady in portal",
    )
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
