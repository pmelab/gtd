import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { viewport } from "../testing/browserContext.js"
import { WorkspaceTrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { workspace } from "./dashboard.fixture.js"
import { Detail } from "./Detail.js"

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

/** On a wide screen the tabs sit on top, under the worktree's header. */
export const TabsOnTopOfASidePane: Story = {
  play: async ({ canvasElement }) => {
    await viewport(1280, 800)
    const canvas = within(canvasElement)
    const tabs = canvas.getByRole("navigation", { name: "Worktree" }).getBoundingClientRect()
    const frame = canvas.getByTitle("Gate page").getBoundingClientRect()
    await expect(tabs.bottom).toBeLessThanOrEqual(frame.top)
  },
}

/** The Terminal tab shows the terminal adapter's attach command, and opens a shell pane on demand. */
export const TerminalAttachesAndOpensAShell: Story = {
  decorators: withApi({
    terminal: () => ({ attach: "tmux attach -t pane-1" }),
    openShell: record("openShell", { attach: "https://term.example.ts.net/pane-2" }),
  }),
  play: async ({ canvasElement }) => {
    calls.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Terminal" }))
    await waitFor(() => expect(canvas.getByText("tmux attach -t pane-1")).toBeInTheDocument())
    await userEvent.click(canvas.getByRole("button", { name: "Open a shell pane" }))
    const link = await canvas.findByText("Open the shell pane ↗")
    await expect(link.getAttribute("href")).toBe("https://term.example.ts.net/pane-2")
    await expect(calls).toEqual([
      { procedure: "openShell", input: { project: "portal", worktree: "/ws/portal-plan" } },
    ])
  },
}

/** A terminal adapter with no attach, or a worktree with no driver pane, says so. */
export const TerminalWithoutAttach: Story = {
  decorators: withApi({ terminal: () => ({}) }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Terminal" }))
    await expect(await canvas.findByTestId("no-attach")).toBeInTheDocument()
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
            { name: "note", type: "text", required: true, help: "What to change" },
            { name: "mode", type: "select", required: false, choices: ["fast", "slow"] },
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
