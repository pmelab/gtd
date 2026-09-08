import type { Meta, StoryObj } from "@storybook/react-vite"
import { page } from "@vitest/browser/context"
import { expect, fireEvent, fn, waitFor, within } from "storybook/test"
import type { FleetEntry, FleetPayload } from "../../ui/Fleet.js"
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
  driving: false,
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
  driving: false,
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

/**
 * T4's own acceptance: a worktree possibly driven by a foreign (non-server-
 * spawned) driver states that imprecision on the row itself, not behind a
 * hover/title attribute — this story is the one place `foreignDriverPossible:
 * true` is ever exercised; every other fixture in this file hardcodes
 * `false`.
 */
export const PossiblyForeignDriven: Story = {
  args: {
    data: payload({
      working: [okRow({ id: "wk", bucket: "working", foreignDriverPossible: true })],
    }),
    isLoading: false,
    onRefresh: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByTestId("fleet-row-wk")
    expect(row.textContent).toContain("possibly driven elsewhere")
    // Visible text content, not a `title` attribute a hover would be needed to read.
    expect(row.querySelector("[title]")).toBeNull()
  },
}

/**
 * T6: a `prompt` rest left dirty (nothing persists across a restart) reads
 * as Wants you — never Working, which would otherwise claim a driver is
 * still there. The badge itself states only what gtd can OBSERVE (dirty, no
 * driver), never an inferred CAUSE like "a restart did this" — a crash or a
 * manual kill leave the identical shape, and gtd cannot tell them apart.
 */
export const InterruptedPromptReadsAsWantsYou: Story = {
  args: {
    data: payload({
      "wants-you": [
        okRow({
          id: "wy",
          bucket: "wants-you",
          kind: "prompt",
          actor: "agent",
          idle: false,
          interrupted: true,
        }),
      ],
    }),
    isLoading: false,
    onRefresh: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("Wants you")).toBeInTheDocument()
    expect(canvas.getByTestId("interrupted-badge")).toHaveTextContent(
      "Dirty, with nothing currently driving it",
    )
  },
}

/**
 * The two "why is this dirty" signals never print on the same row at once —
 * they can both be true together (a dirty prompt rest whose log was ALSO
 * touched recently is exactly the normal mid-turn shape of a foreign
 * driver), and printing both would have one line claim "nothing driving it"
 * right above "possibly driven elsewhere". The more specific, actionable
 * signal wins.
 */
export const InterruptedAndForeignDriverNeverBothShowOnOneRow: Story = {
  args: {
    data: payload({
      "wants-you": [
        okRow({
          id: "wy",
          bucket: "wants-you",
          kind: "prompt",
          actor: "agent",
          idle: false,
          interrupted: true,
          foreignDriverPossible: true,
        }),
      ],
    }),
    isLoading: false,
    onRefresh: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByTestId("fleet-row-wy")
    expect(row.textContent).toContain("possibly driven elsewhere")
    expect(canvas.queryByTestId("interrupted-badge")).not.toBeInTheDocument()
  },
}

/**
 * A row whose beat carries both `file` and `mode` is tappable — the ONE
 * caller of `onOpen`, which `App.tsx` wires to navigate to `Plan`/`Review`.
 * A row with neither renders as a plain (non-button) div instead — see the
 * next story.
 */
export const OpenableRowNavigatesOnTap: Story = {
  args: {
    data: payload({
      "wants-you": [okRow({ id: "wy", file: ".gtd/PLAN.md", mode: "qa" })],
    }),
    isLoading: false,
    onRefresh: fn(),
    onOpen: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("fleet-row-open-wy"))
    await expect(args.onOpen).toHaveBeenCalledWith({
      worktreePath: "/repos/gtd",
      filePath: ".gtd/PLAN.md",
      mode: "qa",
    })
  },
}

/** No `file`/`mode` (a `script`/`stalled` rest, typically) — never rendered as a fake-clickable row even when `onOpen` is given. */
export const RowWithNoSteeringFileIsNotTappable: Story = {
  args: {
    data: payload({ "wants-you": [okRow({ id: "wy" })] }),
    isLoading: false,
    onRefresh: fn(),
    onOpen: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByTestId("fleet-row-open-wy")).not.toBeInTheDocument()
    expect(canvas.getByTestId("fleet-row-wy")).toBeInTheDocument()
  },
}

/** T5: a Working row gets a Stop button; nothing else does. */
/** Only a `driving: true` Working row (a server-owned child — see `Fleet.ts#FleetEntry.driving`'s own doc comment) gets a real Stop button; a `wants-you` row gets none regardless. */
export const WorkingRowHasAStopButton: Story = {
  args: {
    data: payload({
      working: [okRow({ id: "wk", bucket: "working", driving: true })],
      "wants-you": [okRow({ id: "wy", bucket: "wants-you" })],
    }),
    isLoading: false,
    onRefresh: fn(),
    onStop: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByTestId("fleet-row-stop-wy")).not.toBeInTheDocument()
    await fireEvent.click(canvas.getByTestId("fleet-row-stop-wk"))
    await expect(args.onStop).toHaveBeenCalledWith("/repos/gtd")
  },
}

/** T5: a Working row the registry does NOT own (a foreign driver) gets no Stop button at all — a control that would silently do nothing is worse than none, so the row states plainly that gtd cannot stop it instead. */
export const ForeignWorkingRowOffersNoStopControl: Story = {
  args: {
    data: payload({
      working: [okRow({ id: "wk", bucket: "working", driving: false })],
    }),
    isLoading: false,
    onRefresh: fn(),
    onStop: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByTestId("fleet-row-stop-wk")).not.toBeInTheDocument()
    expect(canvas.getByTestId("fleet-row-unstoppable-wk")).toHaveTextContent(
      "gtd did not spawn this",
    )
  },
}

/** Requirement 6: a loop failure's captured stdout/stderr/exit code inline on the row — verbatim, never summarized. */
export const LoopFailureShowsCapturedOutputInline: Story = {
  args: {
    data: payload({
      quiet: [
        okRow({
          id: "q1",
          bucket: "quiet",
          idle: true,
          lastLoopFailure: { stdout: "", stderr: "gtd: command not found\n", status: 127 },
        }),
      ],
    }),
    isLoading: false,
    onRefresh: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByText("Quiet (1)"))
    expect(canvas.getByTestId("loop-failure").textContent).toContain("gtd: command not found")
    expect(canvas.getByTestId("loop-failure").textContent).toContain("127")
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
// (`src/ui/Beat.ts`'s `okResult`, covered by `Beat.test.ts`): a
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
