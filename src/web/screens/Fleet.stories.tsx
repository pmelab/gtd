import type { Meta, StoryObj } from "@storybook/react-vite"
import { page } from "@vitest/browser/context"
import { expect, fireEvent, fn, waitFor, within } from "storybook/test"
import type { FleetEntry, FleetPayload } from "../../serve/Fleet.js"
import { TrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { Fleet, FleetView } from "./Fleet.js"

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
  foreignDriverPossible: false,
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
  foreignDriverPossible: false,
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

export const ARowShowsRepoBranchLabelAndRestAge: Story = {
  args: {
    data: payload({
      "wants-you": [
        okRow({
          id: "wy",
          repo: "gtd",
          branch: "main",
          label: "reviewing a PR",
          rest: new Date(Date.now() - 5 * 60_000).toISOString(),
        }),
      ],
    }),
    isLoading: false,
    onRefresh: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByTestId("fleet-row-wy")
    expect(row.textContent).toContain("gtd")
    expect(row.textContent).toContain("main")
    expect(row.textContent).toContain("reviewing a PR")
    // The rendered AGE string ("5m"), never the raw ISO timestamp `rest` carries.
    expect(row.textContent).toContain("5m")
    expect(row.textContent).not.toContain("T")
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

// The no-label → state-name fallback is computed server-side
// (`src/serve/Beat.ts`'s `okResult`, covered by `Beat.test.ts`): a
// `FleetEntry`'s `label` is always a populated string by the time it
// reaches this component, so there is no "label genuinely absent" case a
// client-side story could exercise — nothing here would ever render blank.

export const RendersCorrectlyAtPhoneWidth: Story = {
  args: {
    data: payload({
      "wants-you": [okRow({ id: "wy", label: "reviewing a very long PR title that could wrap" })],
      broken: [brokenRow({ id: "bk", detail: "a somewhat long refusal message on stderr" })],
    }),
    isLoading: false,
    onRefresh: fn(),
  },
  play: async ({ canvasElement }) => {
    await page.viewport(390, 844)
    const canvas = within(canvasElement)
    await expect(canvas.getByText("Wants you")).toBeInTheDocument()
    await expect(canvas.getByText("Broken")).toBeInTheDocument()
    // No horizontal overflow at 390px — content wraps rather than forcing
    // the page wider than the phone viewport it's meant to fit.
    const screen = canvas.getByTestId("fleet-screen")
    expect(screen.scrollWidth).toBeLessThanOrEqual(390)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
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

/**
 * Exercises `Fleet` (the real container, not just `FleetView`) over an
 * actual `trpc.fleet.useQuery()` round-trip: `TrpcTestProvider`'s mock link
 * is the transport, so a swipe-down genuinely re-issues the query rather
 * than only firing a spy — and the returned payload changes between the two
 * calls, so the re-render (and the document-title update) can only happen
 * if `onRefresh` really triggered a second `fleet` call, not a first-call
 * cache replay.
 */
export const FleetContainerPullToRefreshReissuesTheQuery: StoryObj<typeof Fleet> = {
  render: () => {
    let calls = 0
    const beforeRefresh = payload({})
    const afterRefresh = payload({ "wants-you": [okRow({ id: "wy" })] })
    return (
      <TrpcTestProvider resolveFleet={() => (calls++ === 0 ? beforeRefresh : afterRefresh)}>
        <Fleet />
      </TrpcTestProvider>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByText("No worktrees found — nothing to triage.")).toBeInTheDocument(),
    )
    expect(document.title).toBe("gtd")

    const screen = canvas.getByTestId("fleet-screen")
    const touch = (clientY: number) =>
      new Touch({ identifier: 0, target: screen, clientX: 0, clientY })
    fireEvent.touchStart(screen, { touches: [touch(0)] })
    fireEvent.touchMove(screen, { touches: [touch(120)] })
    fireEvent.touchEnd(screen)

    await waitFor(() => expect(canvas.getByText("Wants you")).toBeInTheDocument())
    await waitFor(() => expect(document.title).toBe("(1) gtd"))
  },
}
