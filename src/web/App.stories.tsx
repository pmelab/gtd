import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"
import { App } from "./App.js"
import { TrpcTestProvider } from "./testing/TrpcTestProvider.js"

const okStep = (over: Record<string, unknown>) => ({
  status: "ok",
  path: "/repos/gtd",
  repo: "gtd",
  branch: "main",
  label: "reviewing a PR",
  kind: "prompt",
  actor: "human",
  idle: false,
  rest: new Date().toISOString(),
  ...over,
})

const meta: Meta<typeof App> = {
  component: App,
}

export default meta

type Story = StoryObj<typeof App>

/** `gtd ui` never binds on a step this client can't render (package 02's own refuse-to-start gate), so `App` always opens directly on the served worktree's one step — `mode: "qa"` picks `Plan`. */
export const Default: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider
        resolvers={{
          step: () => okStep({ file: ".gtd/PLAN.md", mode: "qa" }),
          readSteeringFile: () => ({
            ok: true,
            content: "A paragraph worth reading.",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: {
              nodes: [
                { title: "A paragraph worth reading.", anchor: { kind: "paragraph", line: 0 } },
              ],
            },
          }),
        }}
      >
        <Story />
      </TrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("plan-screen")).toBeInTheDocument())
  },
}

/** `mode: "review"` picks `Review`, never `Plan` — the one place this file switches on the mode string, to choose a SCREEN rather than a format. */
export const TappingAReviewModeRowNavigatesToReview: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider
        resolvers={{
          step: () => okStep({ file: ".gtd/REVIEW.md", mode: "review" }),
          readSteeringFile: () => ({
            ok: true,
            content: "",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: { nodes: [] },
          }),
        }}
      >
        <Story />
      </TrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("review-screen")).toBeInTheDocument())
  },
}

/** A step with no steering `file` (a `script`/`stalled` rest) renders nothing — the server itself never binds on one (package 02's refuse-to-start gate), so this is defensive, not a reachable production shape. */
export const StepWithNoSteeringFileRendersNothing: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider resolvers={{ step: () => okStep({ kind: "script" }) }}>
        <Story />
      </TrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByTestId("plan-screen")).not.toBeInTheDocument()
    expect(canvas.queryByTestId("review-screen")).not.toBeInTheDocument()
  },
}
