import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { viewport } from "../testing/browserContext.js"
import { WorkspaceTrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { Dashboard } from "./Dashboard.js"
import { fullInbox, fullWorkspace, workspace } from "./dashboard.fixture.js"

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
      url: "https://github.com/acme/api/pull/7",
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

/** The inbox items with these titles, wherever their feed groups them. */
const itemsTitled = async (
  canvas: ReturnType<typeof within>,
  ...titles: string[]
): Promise<HTMLElement[]> => {
  const items = await canvas.findAllByTestId("inbox-item")
  return titles.map((title) => items.find((i: HTMLElement) => i.textContent.includes(title))!)
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

/** The bottom tab bar, once the resize to a phone has reached the dashboard. */
const phoneNav = (canvas: ReturnType<typeof within>) =>
  waitFor(() => {
    const nav = canvas.getByRole("navigation", { name: "Views" })
    if (nav.closest("aside") !== null) throw new Error("still the desktop sidebar")
    return nav
  })

/** The dashboard opens on Now, counts what needs you, and shows the workspace's banners. */
export const OpensOnNow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("button", { name: "Now (2)" })).toHaveAttribute(
      "aria-current",
      "true",
    )
    await expect(canvas.getAllByTestId("now-card")).toHaveLength(2)
    await expect(await canvas.findByRole("button", { name: "Inbox (2)" })).toBeInTheDocument()
    await expect(canvas.getByTestId("banner")).toHaveTextContent("Workspace settings not reloaded")
    await expect(canvas.getByTestId("banner-detail").textContent).toBe(
      "gtd.workspace.ts not reloaded: workspace.x: unknown key",
    )
  },
}

/** On a phone a worktree's detail is a full screen; Close returns to the view it came from. */
export const DetailIsAFullScreen: Story = {
  play: async ({ canvasElement }) => {
    await viewport(360, 800)
    const canvas = within(canvasElement)
    await userEvent.click(within(await phoneNav(canvas)).getByRole("button", { name: "Projects" }))
    await userEvent.click(canvas.getByText("login"))
    await expect(canvas.getByTestId("detail")).toBeVisible()
    await expect(canvas.queryByTestId("project")).not.toBeInTheDocument()
    await expect(canvas.queryByRole("navigation", { name: "Views" })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(canvas.getAllByTestId("project")).toHaveLength(2))
  },
}

/** Crossing 1024 px with a detail open keeps that detail mounted, so its local state survives. */
export const ResizingKeepsTheOpenDetail: Story = {
  play: async ({ canvasElement }) => {
    await viewport(1440, 900)
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Projects" }))
    await userEvent.click(canvas.getByText("login"))
    const detail = canvas.getByTestId("detail")
    await viewport(360, 800)
    await waitFor(() => expect(canvas.queryByTestId("project")).not.toBeInTheDocument())
    await expect(canvas.getByTestId("detail")).toBe(detail)
    await viewport(1440, 900)
    await waitFor(() => expect(canvas.getAllByTestId("project")).toHaveLength(2))
    await expect(canvas.getByTestId("detail")).toBe(detail)
  },
}

/** From 1024 px a side navigation replaces the tabs, and a worktree opens beside its list. */
export const DesktopSplitsListAndDetail: Story = {
  play: async ({ canvasElement }) => {
    await viewport(1440, 900)
    const canvas = within(canvasElement)
    const nav = await canvas.findByRole("navigation", { name: "Views" })
    await expect(getComputedStyle(nav).flexDirection).toBe("column")
    await userEvent.click(canvas.getByRole("button", { name: "Projects" }))
    await expect(canvas.getByTestId("detail-placeholder")).toBeVisible()
    await userEvent.click(canvas.getByText("login"))
    await expect(canvas.getByTestId("detail")).toBeVisible()
    await expect(canvas.getAllByTestId("project")).toHaveLength(2)
    await expect(canvas.queryByTestId("detail-placeholder")).not.toBeInTheDocument()
    await expect(document.documentElement.scrollWidth <= document.documentElement.clientWidth).toBe(
      true,
    )
  },
}

/** A worktree's address opens the split with that worktree selected. */
export const DesktopOpensAWorktreeFromItsAddress: Story = {
  play: async ({ canvasElement }) => {
    await viewport(1440, 900)
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Projects" }))
    await userEvent.click(canvas.getByText("login"))
    await canvas.findByTestId("detail")
    window.dispatchEvent(new PopStateEvent("popstate"))
    await expect(window.location.search).toContain("worktree=")
    await expect(canvas.getByTestId("detail")).toBeVisible()
    await expect(canvas.getAllByTestId("project")).toHaveLength(2)
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
    await userEvent.click(await canvas.findByRole("button", { name: /^Inbox/ }))
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
    await userEvent.click(await canvas.findByRole("button", { name: /^Inbox/ }))
    const [proposed, failed] = await itemsTitled(canvas, "Add login", "Fix logout")
    await expect(within(proposed!).getByTestId("inbox-state").textContent).toBe("proposed")
    await expect(proposed!.closest("section")).toHaveAccessibleName("portal")
    await expect(within(failed!).getByTestId("inbox-reason").textContent).toBe("Start failed")
    await expect(within(failed!).getByTestId("inbox-message").textContent).toBe(
      "start:work exited 1",
    )
    const feedFailing = canvas.getByTestId("feed-failing")
    await expect(feedFailing.textContent).toBe("gh: not logged in")
    await expect(feedFailing.parentElement).toHaveTextContent("Feed check failed")
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

/** A failed item of a feed that left the config offers Dismiss, not Retry. */
export const InboxOffersNoRetryOfARemovedFeed: Story = {
  decorators: [
    (Story) => (
      <WorkspaceTrpcTestProvider
        resolvers={{
          projects: () => workspace,
          banners: () => [],
          inbox: () => ({ ...inbox, feeds: inbox.feeds.filter((f) => f.feed !== "boardReady") }),
        }}
      >
        <Story />
      </WorkspaceTrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: /^Inbox/ }))
    const [failed] = await itemsTitled(canvas, "Fix logout")
    await expect(within(failed!).getByRole("button", { name: "Dismiss" })).toBeInTheDocument()
    await expect(within(failed!).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument()
  },
}

/** The Inbox shows the drives in use out of maxDrives, and why a queued item waits. */
export const InboxSaysWhyAnItemWaits: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: /^Inbox/ }))
    await expect((await canvas.findByTestId("drives")).textContent).toBe("2 of 2 drives in use")
    const [queued] = await itemsTitled(canvas, "Review #7")
    await expect(within(queued!).getByTestId("inbox-reason").textContent).toBe(
      "2 of 2 drives in use — the workspace limit",
    )
    await expect(within(queued!).getByTestId("inbox-message").textContent).toBe(
      "2 of 2 drives in use (limits.maxDrives)",
    )
    await expect(within(queued!).queryByRole("button")).not.toBeInTheDocument()
  },
}

/** An inbox title with a URL is underlined: in the light theme the link colour equals the text colour. */
export const InboxTitleLinkIsUnderlined: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: /^Inbox/ }))
    const link = await canvas.findByRole("link", { name: "Review #7" })
    await expect(getComputedStyle(link).textDecorationLine).toBe("underline")
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
    await expect(within(canvasElement).getByRole("alert").textContent).toContain(
      "Check that gtd workspace is running, then reload.",
    )
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
    await userEvent.click(await canvas.findByRole("button", { name: /^Inbox/ }))
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
    await userEvent.click(await canvas.findByRole("button", { name: /^Inbox/ }))
    const [proposed, failed] = await itemsTitled(canvas, "Add login", "Fix logout")
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
    await userEvent.click(await canvas.findByRole("button", { name: /^Inbox/ }))
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

export const InboxListsEveryItemState: Story = {
  decorators: [
    (Story) => (
      <WorkspaceTrpcTestProvider
        resolvers={{ projects: () => fullWorkspace, banners: () => [], inbox: () => fullInbox }}
      >
        <Story />
      </WorkspaceTrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: /^Inbox/ }))
    const items = await canvas.findAllByTestId("inbox-item")
    await expect(items).toHaveLength(6)
    await expect(items.map((i) => within(i).getByTestId("inbox-state").textContent)).toEqual([
      "blocked",
      "starting",
      "started",
      "failed",
      "proposed",
      "queued",
    ])
    for (const project of ["shop", "blog", "docs"]) {
      await expect(canvas.getByRole("region", { name: project })).toBeInTheDocument()
    }
  },
}

const setInsets = (top: number, bottom: number): void => {
  document.documentElement.style.setProperty("--safe-top", `${top}px`)
  document.documentElement.style.setProperty("--safe-bottom", `${bottom}px`)
}
const clearInsets = (): void => {
  document.documentElement.style.removeProperty("--safe-top")
  document.documentElement.style.removeProperty("--safe-bottom")
}

/** On a phone the views sit in a bottom bar as wide as the screen, under a top bar naming the view. */
export const PhoneHasATopBarAndBottomTabs: Story = {
  play: async ({ canvasElement }) => {
    await viewport(360, 800)
    const canvas = within(canvasElement)
    const nav = await phoneNav(canvas)
    await userEvent.click(within(nav).getByRole("button", { name: /^Now/ }))
    await expect(canvas.getByRole("heading", { level: 1 }).textContent).toBe("Now")
    const box = nav.getBoundingClientRect()
    await expect([box.left, box.right, box.bottom]).toEqual([
      0,
      document.documentElement.clientWidth,
      window.innerHeight,
    ])
    for (const tab of within(nav).getAllByRole("button")) {
      const { width, height } = tab.getBoundingClientRect()
      await expect(width).toBeGreaterThanOrEqual(44)
      await expect(height).toBeGreaterThanOrEqual(56)
    }
    await userEvent.click(canvas.getByRole("button", { name: "Projects" }))
    await expect(canvas.getByRole("heading", { level: 1 }).textContent).toBe("Projects")
  },
}

/** Under a notch and a home indicator the tabs keep their height, the bar grows, the title clears the top and the last row clears the bar. */
export const PhoneClearsTheInsets: Story = {
  play: async ({ canvasElement }) => {
    await viewport(360, 800)
    setInsets(59, 34)
    try {
      const canvas = within(canvasElement)
      const nav = await phoneNav(canvas)
      for (const tab of within(nav).getAllByRole("button")) {
        const { width, height } = tab.getBoundingClientRect()
        await expect(width).toBeGreaterThanOrEqual(44)
        await expect(height).toBeGreaterThanOrEqual(56)
        await expect(nav.getBoundingClientRect().bottom - tab.getBoundingClientRect().bottom).toBe(
          34,
        )
      }
      const title = canvas.getByRole("heading", { level: 1 })
      await expect(title.getBoundingClientRect().top).toBeGreaterThanOrEqual(59)
      window.scrollTo(0, document.documentElement.scrollHeight)
      const rows = canvasElement.querySelectorAll("main li, main section")
      const last = rows[rows.length - 1]!
      await waitFor(() =>
        expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
          nav.getBoundingClientRect().top,
        ),
      )
    } finally {
      clearInsets()
    }
  },
}

/** The desktop sidebar lists each project with what needs you and what failed; a click opens it in Projects. */
export const SidebarListsProjects: Story = {
  play: async ({ canvasElement }) => {
    await viewport(1440, 900)
    const canvas = within(canvasElement)
    const rows = await canvas.findAllByTestId("sidebar-project")
    await expect(rows.map((r) => r.textContent)).toEqual(["api1 in error", "Portal1 need you"])
    await expect(within(rows[0]!).getByTestId("sidebar-error")).toHaveClass("tabular-nums")
    await expect(within(rows[1]!).queryByTestId("sidebar-error")).toBeNull()
    await userEvent.click(canvas.getByRole("button", { name: "Projects" }))
    await userEvent.click(canvas.getByRole("button", { name: "Portal" }))
    await waitFor(() => expect(canvas.queryByText("login")).not.toBeInTheDocument())
    await userEvent.click(canvas.getByRole("button", { name: /^Now/ }))
    await userEvent.click(rows[1]!)
    await expect(window.location.search).toBe("?view=projects")
    await expect(await canvas.findByText("login")).toBeVisible()
  },
}
