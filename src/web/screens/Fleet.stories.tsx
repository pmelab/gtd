import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, fn, within } from "storybook/test"
import type { FleetEntry, FleetPayload } from "../../serve/Fleet.js"
import { FleetView } from "./Fleet.js"

const meta: Meta<typeof FleetView> = {
  component: FleetView,
}

export default meta

type Story = StoryObj<typeof FleetView>

type OkEntry = Extract<FleetEntry, { status: "ok" }>
type BrokenEntry = Extract<FleetEntry, { status: "broken" }>

const okRow = (over: Partial<OkEntry>): FleetEntry => ({
  status: "ok",
  id: "id",
  path: "/repos/gtd",
  repo: "gtd",
  branch: "main",
  label: "reviewing a PR",
  kind: "prompt",
  actor: "human",
  idle: false,
  rest: new Date(Date.now() - 5 * 60_000).toISOString(),
  bucket: "wants-you",
  ...over,
})

const brokenRow = (over: Partial<BrokenEntry>): FleetEntry => ({
  status: "broken",
  id: "id",
  path: "/repos/gtd",
  repo: "gtd",
  branch: "main",
  detail: "gtd: refused — dirty tree at exit 1",
  bucket: "broken",
  ...over,
})

const emptyBuckets: FleetPayload["buckets"] = {
  "wants-you": [],
  working: [],
  broken: [],
  quiet: [],
}

const payload = (buckets: Partial<FleetPayload["buckets"]>): FleetPayload => {
  const full = { ...emptyBuckets, ...buckets }
  return {
    buckets: full,
    wantsYouCount: full["wants-you"].length,
  }
}

export const AllFourBuckets: Story = {
  args: {
    data: payload({
      "wants-you": [okRow({ id: "wy", bucket: "wants-you", idle: false, actor: "human" })],
      working: [okRow({ id: "wk", bucket: "working", idle: false, actor: "agent" })],
      broken: [brokenRow({ id: "bk" })],
      quiet: [okRow({ id: "q1", bucket: "quiet", idle: true })],
    }),
    isLoading: false,
    onRefresh: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("Wants you")).toBeInTheDocument()
    await expect(canvas.getByText("Working")).toBeInTheDocument()
    await expect(canvas.getByText("Broken")).toBeInTheDocument()
    await expect(canvas.getByText("Quiet (1)")).toBeInTheDocument()
  },
}

export const BrokenRowShowsStderrVerbatim: Story = {
  args: {
    data: payload({
      broken: [brokenRow({ id: "bk", detail: "line one\nline two" })],
    }),
    isLoading: false,
    onRefresh: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText((_, element) => element?.textContent === "line one\nline two"),
    ).toBeInTheDocument()
  },
}

export const QuietCollapsesBehindItsCount: Story = {
  args: {
    data: payload({
      quiet: [
        okRow({ id: "q1", bucket: "quiet", idle: true }),
        okRow({ id: "q2", bucket: "quiet", idle: true }),
      ],
    }),
    isLoading: false,
    onRefresh: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByText("Quiet (2)")
    await expect(canvas.queryByText("reviewing a PR")).not.toBeInTheDocument()
    await fireEvent.click(toggle)
    await expect(canvas.getAllByText("reviewing a PR").length).toBeGreaterThan(0)
  },
}

export const EmptyFleet: Story = {
  args: {
    data: payload({}),
    isLoading: false,
    onRefresh: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("No worktrees found — nothing to triage.")).toBeInTheDocument()
  },
}

export const NoLabelFallsBackToStateName: Story = {
  args: {
    data: payload({
      "wants-you": [okRow({ id: "nolabel", label: "idle" })],
    }),
    isLoading: false,
    onRefresh: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("idle")).toBeInTheDocument()
  },
}

export const PullToRefreshTriggersOnRefresh: Story = {
  args: {
    data: payload({ "wants-you": [okRow({ id: "wy" })] }),
    isLoading: false,
    onRefresh: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const screen = canvas.getByTestId("fleet-screen")
    const touch = (clientY: number) =>
      new Touch({ identifier: 0, target: screen, clientX: 0, clientY })
    fireEvent.touchStart(screen, { touches: [touch(0)] })
    fireEvent.touchMove(screen, { touches: [touch(120)] })
    fireEvent.touchEnd(screen)
    await expect(args.onRefresh).toHaveBeenCalled()
  },
}
