import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import { App } from "./App.js"
import { TrpcTestProvider } from "./testing/TrpcTestProvider.js"

const EMPTY_FLEET = {
  buckets: { "wants-you": [], working: [], broken: [], quiet: [] },
  wantsYouCount: 0,
}

const okFleetRow = (over: Record<string, unknown>) => ({
  status: "ok",
  id: "id",
  path: "/repos/gtd",
  repo: "gtd",
  branch: "main",
  label: "reviewing a PR",
  kind: "prompt",
  actor: "human",
  idle: false,
  rest: new Date().toISOString(),
  bucket: "wants-you",
  foreignDriverPossible: false,
  ...over,
})

const meta: Meta<typeof App> = {
  component: App,
  decorators: [
    (Story) => (
      <TrpcTestProvider resolveFleet={() => EMPTY_FLEET}>
        <Story />
      </TrpcTestProvider>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof App>

/** `App` is the fleet screen itself (package 02's requirement: it's the first thing the phone loads) — this proves the real query round-trips through `App`, not just `FleetView` in isolation. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByText("No worktrees found — nothing to triage.")).toBeInTheDocument(),
    )
  },
}

/**
 * The end-to-end navigation `Router.ts#RouterContext`'s `done`/`stop`
 * plumbing exists FOR: tapping an openable fleet row (one whose beat
 * carries `file`+`mode`) actually navigates to `Plan` — the concrete
 * `qa`-mode case — and "← Fleet" returns. Package 05's own T2/T3 acceptance
 * ("the phone returns to the fleet list immediately") is otherwise
 * unreachable from any real screen.
 */
export const TappingAnOpenableRowNavigatesToPlanAndBackReturnsToFleet: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider
        resolvers={{
          fleet: () => ({
            buckets: {
              "wants-you": [okFleetRow({ id: "wy", file: ".gtd/PLAN.md", mode: "qa" })],
              working: [],
              broken: [],
              quiet: [],
            },
            wantsYouCount: 1,
          }),
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
    await waitFor(() => expect(canvas.getByTestId("fleet-row-open-wy")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("fleet-row-open-wy"))
    await waitFor(() => expect(canvas.getByTestId("plan-screen")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("back-to-fleet"))
    await waitFor(() => expect(canvas.getByTestId("fleet-screen")).toBeInTheDocument())
  },
}

/** `mode: "review"` picks `Review`, never `Plan` — the one place this file switches on the mode string, to choose a SCREEN rather than a format. */
export const TappingAReviewModeRowNavigatesToReview: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider
        resolvers={{
          fleet: () => ({
            buckets: {
              "wants-you": [okFleetRow({ id: "wy", file: ".gtd/REVIEW.md", mode: "review" })],
              working: [],
              broken: [],
              quiet: [],
            },
            wantsYouCount: 1,
          }),
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
    await waitFor(() => expect(canvas.getByTestId("fleet-row-open-wy")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("fleet-row-open-wy"))
    await waitFor(() => expect(canvas.getByTestId("review-screen")).toBeInTheDocument())
  },
}

/** A row whose beat carries no `file`/`mode` renders un-tappable — nothing to open, so `App` never navigates. */
export const RowWithNoSteeringFileStaysOnFleet: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider
        resolvers={{
          fleet: () => ({
            buckets: {
              "wants-you": [okFleetRow({ id: "wy" })],
              working: [],
              broken: [],
              quiet: [],
            },
            wantsYouCount: 1,
          }),
        }}
      >
        <Story />
      </TrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("fleet-row-wy")).toBeInTheDocument())
    expect(canvas.queryByTestId("fleet-row-open-wy")).not.toBeInTheDocument()
    expect(canvas.getByTestId("fleet-screen")).toBeInTheDocument()
  },
}
