import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { WorkspaceTrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { outage, workspace } from "./dashboard.fixture.js"
import { Projects } from "./Projects.js"

const calls: { procedure: string; input: unknown }[] = []

const withApi = (resolvers: Record<string, (input: unknown) => unknown>) => [
  (Story: () => React.JSX.Element) => (
    <WorkspaceTrpcTestProvider resolvers={{ projects: () => workspace, ...resolvers }}>
      <Story />
    </WorkspaceTrpcTestProvider>
  ),
]

const meta: Meta<typeof Projects> = {
  component: Projects,
  args: { projects: workspace, selected: undefined, onOpen: fn() },
  decorators: withApi({}),
}

export default meta

type Story = StoryObj<typeof Projects>

const rowTexts = (canvasElement: HTMLElement): string[] =>
  within(canvasElement)
    .getAllByTestId("worktree-row")
    .map((row) => [...row.querySelector("button")!.children].map((c) => c.textContent).join(" "))

/** Every worktree, grouped by project, with its status, what it waits for and why. */
export const ListsEveryWorktreeGroupedByProject: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "api",
      "Portal",
    ])
    await expect(rowTexts(canvasElement)).toEqual([
      "idle main Idle",
      "error (crashed) broken Driver crashed — the driver exited with 1",
      "working build Building",
      "idle main Idle",
      "needs you (question) plan Answer the plan",
      "idle login Idle",
    ])
  },
}

/** A chip names the service, whether it runs and its error; a chip with a URL links to it. */
export const ShowsServiceChips: Story = {
  play: async ({ canvasElement }) => {
    const chips = within(canvasElement).getAllByTestId("service-chip")
    await expect(chips.map((c) => c.textContent)).toEqual([
      "web (running)",
      "web (stopped)",
      "jobs (error: exit code 3)",
    ])
    await expect(chips.map((c) => c.getAttribute("href"))).toEqual([
      "https://web.portal.example.ts.net",
      "https://web.login.portal.example.ts.net",
      null,
    ])
  },
}

/** The driver's refusal stays on the worktree while HEAD is the refused commit. */
export const ShowsTheRefusal: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId("refusal").textContent).toBe(
      "refused: busy: still answering the last question",
    )
  },
}

/** An adapter outage keeps the last known status, greyed, and says which adapter is down. */
export const GreysAWorktreeWhoseAdapterIsDown: Story = {
  args: { projects: outage },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("worktrees unavailable: wt list failed")).toBeInTheDocument()
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
      expect.objectContaining({ worktree: expect.objectContaining({ branch: "plan" }) }),
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
        { procedure: "createWorktree", input: { project: "portal", branch: "signup" } },
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
    createWorktree: () => ({ path: "/ws/portal-signup", failure: "web: exit code 3" }),
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
