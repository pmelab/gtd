import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { token } from "../testing/palette.js"
import { WorkspaceTrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { fullWorkspace, outage, workspace } from "./dashboard.fixture.js"
import { Projects } from "./Projects.js"
import { useExpanded } from "./useExpanded.js"
import type { ProjectView } from "./view.js"

const calls: { procedure: string; input: unknown }[] = []

const withApi = (resolvers: Record<string, (input: unknown) => unknown>) => [
  (Story: () => React.JSX.Element) => (
    <WorkspaceTrpcTestProvider resolvers={{ projects: () => workspace, ...resolvers }}>
      <Story />
    </WorkspaceTrpcTestProvider>
  ),
]

const StatefulProjects = (args: React.ComponentProps<typeof Projects>) => {
  const [expanded, toggle] = useExpanded(args.projects)
  return <Projects {...args} expanded={expanded} onToggle={toggle} />
}

/** Swaps in `next` as a refresh would when the Refresh button is pressed. */
const Refreshing = ({
  next,
  ...args
}: React.ComponentProps<typeof Projects> & { readonly next: readonly ProjectView[] }) => {
  const [projects, setProjects] = useState(args.projects)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setProjects(next)
        }}
      >
        Refresh
      </button>
      <StatefulProjects {...args} projects={projects} />
    </>
  )
}

const noAttention = (project: ProjectView): ProjectView => ({
  ...project,
  worktrees: project.worktrees.filter((w) => w.status === "idle"),
})

const meta: Meta<typeof Projects> = {
  component: Projects,
  args: { projects: workspace, onOpen: fn() },
  render: (args) => <StatefulProjects {...args} />,
  decorators: withApi({}),
}

export default meta

type Story = StoryObj<typeof Projects>

const rowTexts = (canvasElement: HTMLElement): string[] =>
  within(canvasElement)
    .getAllByTestId("worktree-row")
    .map((row) => [...row.querySelector("button")!.children].map((c) => c.textContent).join(" "))

const statusOf = (row: HTMLElement): string | null | undefined =>
  row.querySelector("[data-status]")?.textContent

/** Every worktree, grouped by project, with its status, what it waits for and why. */
export const ListsEveryWorktreeGroupedByProject: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "api",
      "Portal",
    ])
    await expect(rowTexts(canvasElement)).toEqual([
      "main idle",
      "broken error (crashed) Driver crashed — the driver exited with 1",
      "build working Building",
      "main idle",
      "plan needs you (question) Answer the plan",
      "login idle",
    ])
  },
}

/** A list row names the worktree and its status, not its services. */
export const ShowsNoServiceChips: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryAllByTestId("service-chip")).toEqual([])
  },
}

/** The driver's refusal stays on the worktree while HEAD is the refused commit. */
export const ShowsTheRefusal: Story = {
  play: async ({ canvasElement }) => {
    const refusal = within(canvasElement).getByTestId("refusal")
    await expect(within(refusal).getByTestId("refusal-reason").textContent).toBe(
      "busy: still answering the last question",
    )
    await expect(refusal.textContent).toContain("Last press refused.")
  },
}

/** The worktree whose detail is open beside the list keeps a filled row, not only a focus ring. */
export const FillsTheSelectedRow: Story = {
  args: { selected: "/ws/portal-plan" },
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement).getAllByTestId("worktree-row")
    const plan = rows.find((r) => r.textContent.includes("plan"))!
    await expect(plan.querySelector("button")).toHaveAttribute("aria-current", "true")
    await expect(getComputedStyle(plan).backgroundColor).toBe(token("accent"))
    const login = rows.find((r) => r.textContent.includes("login"))!
    await expect(getComputedStyle(login).backgroundColor).toBe("rgba(0, 0, 0, 0)")
  },
}

/** Keyboard focus rings the whole row, the same box the selection fills, not only its title. */
export const RingsTheWholeFocusedRow: Story = {
  args: { selected: "/ws/portal-plan" },
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement).getAllByTestId("worktree-row")
    const plan = rows.find((r) => r.textContent.includes("plan"))!
    await expect(getComputedStyle(plan).boxShadow).toBe("none")
    plan.querySelector("button")!.focus()
    await expect(getComputedStyle(plan).boxShadow).toContain("inset")
    await expect(getComputedStyle(plan.querySelector("button")!).outlineStyle).toBe("none")
  },
}

/** An adapter outage keeps the last known status, greyed, and says which adapter is down. */
export const GreysAWorktreeWhoseAdapterIsDown: Story = {
  args: { projects: outage },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("worktrees unavailable: wt list failed")).toBeInTheDocument()
    for (const header of canvas.getAllByRole("button", { expanded: false })) {
      await userEvent.click(header)
    }
    await expect(canvas.getByText("worktrees unavailable")).toBeInTheDocument()
    await expect(canvas.getByTestId("services-unavailable").textContent).toBe(
      "services unavailable: the pitchfork supervisor is not running",
    )
    await expect(getComputedStyle(canvas.getByTestId("worktree-row")).opacity).toBe("0.6")
  },
}

/** A tap on a row opens that worktree. */
export const OpensTheTappedWorktree: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByText("plan"))
    await expect(args.onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        worktree: expect.objectContaining({ branch: "plan" }),
      }),
    )
  },
}

/** A main checkout the last clean pass could not bring up to date is marked on its project. */
export const MarksAStaleMainCheckout: Story = {
  args: {
    projects: workspace.map((project) =>
      project.id === "portal"
        ? { ...project, mainStale: "git fetch failed: could not resolve host" }
        : project,
    ),
  },
  play: async ({ canvasElement }) => {
    const marks = within(canvasElement).getAllByTestId("main-stale")
    await expect(marks.map((m) => m.textContent)).toEqual([
      "main checkout stale: git fetch failed: could not resolve host",
    ])
  },
}

/** New worktree on a project takes a branch name and creates the worktree. */
export const CreatesANewWorktree: Story = {
  decorators: withApi({
    createWorktree: (input) => {
      calls.push({ procedure: "createWorktree", input })
      return { path: "/ws/portal-signup" }
    },
  }),
  play: async ({ canvasElement }) => {
    calls.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getAllByRole("button", { name: "New worktree" })[1]!)
    await userEvent.type(canvas.getByRole("textbox", { name: "Branch" }), "signup")
    await userEvent.click(canvas.getByRole("button", { name: "Create" }))
    await waitFor(() =>
      expect(calls).toEqual([
        {
          procedure: "createWorktree",
          input: { project: "portal", branch: "signup" },
        },
      ]),
    )
    await waitFor(() =>
      expect(canvas.queryByRole("textbox", { name: "Branch" })).not.toBeInTheDocument(),
    )
  },
}

/** A branch name gtd refuses keeps the form open with gtd's reason. */
export const ShowsWhyANewWorktreeIsRefused: Story = {
  decorators: withApi({
    createWorktree: () => {
      throw new Error("a worktree of portal is on plan already")
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getAllByRole("button", { name: "New worktree" })[1]!)
    await userEvent.type(canvas.getByRole("textbox", { name: "Branch" }), "plan")
    await userEvent.click(canvas.getByRole("button", { name: "Create" }))
    await expect((await canvas.findByTestId("new-worktree-error")).textContent).toBe(
      "a worktree of portal is on plan already",
    )
  },
}

/** A new worktree whose services do not start stays, and says why. */
export const SaysWhyTheNewWorktreesServicesDidNotStart: Story = {
  decorators: withApi({
    createWorktree: () => ({
      path: "/ws/portal-signup",
      failure: "web: exit code 3",
    }),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getAllByRole("button", { name: "New worktree" })[1]!)
    await userEvent.type(canvas.getByRole("textbox", { name: "Branch" }), "signup")
    await userEvent.click(canvas.getByRole("button", { name: "Create" }))
    await expect((await canvas.findByTestId("new-worktree-failure")).textContent).toBe(
      "services did not start: web: exit code 3",
    )
  },
}

/** A project with nothing needing you starts collapsed: its worktrees hide, its name and New worktree stay; Expand shows them. */
export const StartsCollapsedWithoutAttention: Story = {
  args: {
    projects: workspace.map((p) =>
      p.id === "api" ? { ...p, worktrees: p.worktrees.filter((w) => w.status === "idle") } : p,
    ),
  },
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole("region", { name: "api" })
    await expect(within(group).queryAllByTestId("worktree-row")).toHaveLength(0)
    await expect(within(group).getByRole("button", { name: "New worktree" })).toBeVisible()
    await userEvent.click(within(group).getByRole("button", { name: /api/ }))
    await expect(within(group).getAllByTestId("worktree-row")).toHaveLength(1)
  },
}

/** A collapsed project's header counts the worktrees that need you or are in error. */
export const CollapsedHeaderCountsAttention: Story = {
  play: async ({ canvasElement }) => {
    const group = within(canvasElement).getByRole("region", { name: "Portal" })
    await userEvent.click(within(group).getByRole("button", { name: /Portal/ }))
    await expect(within(group).getByTestId("project-attention").textContent).toBe("1 need you")
  },
}

/** A refresh that brings a gate to an untouched collapsed project leaves it collapsed. */
export const StaysCollapsedWhenAGateArrives: Story = {
  args: { projects: workspace.map(noAttention) },
  render: (args) => <Refreshing {...args} next={workspace} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const portal = () => canvas.getByRole("region", { name: "Portal" })
    await expect(within(portal()).queryAllByTestId("worktree-row")).toHaveLength(0)
    await userEvent.click(canvas.getByRole("button", { name: "Refresh" }))
    await expect(within(portal()).getByTestId("project-attention").textContent).toBe("1 need you")
    await expect(within(portal()).queryAllByTestId("worktree-row")).toHaveLength(0)
  },
}

/** A refresh that clears the last gate of an untouched expanded project leaves it expanded. */
export const StaysExpandedWhenTheLastGateClears: Story = {
  render: (args) => <Refreshing {...args} next={workspace.map(noAttention)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const portal = () => canvas.getByRole("region", { name: "Portal" })
    await expect(within(portal()).getAllByTestId("worktree-row").length).toBeGreaterThan(0)
    await userEvent.click(canvas.getByRole("button", { name: "Refresh" }))
    await expect(within(portal()).getAllByTestId("worktree-row").length).toBeGreaterThan(0)
  },
}

export const EveryStatusAcrossProjects: Story = {
  args: { projects: fullWorkspace },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByTestId("project")).toHaveLength(4)
    const docs = canvas.getByRole("region", { name: "docs" })
    await expect(within(docs).queryAllByTestId("worktree-row")).toHaveLength(0)
    const empty = canvas.getByRole("region", { name: "empty" })
    await expect(within(empty).queryAllByTestId("worktree-row")).toHaveLength(0)
    for (const name of ["shop", "blog"]) {
      const rows = within(canvas.getByRole("region", { name })).getAllByTestId("worktree-row")
      await expect(rows.map(statusOf)).toEqual([
        "idle",
        "idle",
        "needs you",
        "needs you (permission)",
        "needs you (question)",
        "needs you",
        "working",
        "error (stalled)",
        "error (crashed)",
        "error (driver)",
        "error (note)",
      ])
    }
  },
}
