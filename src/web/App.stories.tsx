import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"
import { builtInModeNames } from "../steering/index.js"
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
export const ReviewModeOpensDirectlyOnTheReviewScreen: Story = {
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

/** A step with no steering `file`/`mode` (a `script`/`stalled` rest) is defensive, not a reachable production shape (the server itself never binds on one — package 02's refuse-to-start gate) — but must still render something legible, never a blank screen. */
export const StepWithNoSteeringFileRendersAMessage: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider resolvers={{ step: () => okStep({ kind: "script" }) }}>
        <Story />
      </TrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("app-unrenderable")).toBeInTheDocument())
    expect(canvas.queryByTestId("plan-screen")).not.toBeInTheDocument()
    expect(canvas.queryByTestId("review-screen")).not.toBeInTheDocument()
  },
}

/** `query.isError` — the `step` procedure itself throws (a network failure, a dead server) — is the fifth of `App.tsx`'s five text-only states through `Notice`; nothing exercised it before this story. */
export const QueryErrorShowsTheUnderlyingMessage: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider
        resolvers={{
          step: () => {
            throw new Error("connection refused")
          },
        }}
      >
        <Story />
      </TrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByTestId("app-query-error")).toHaveTextContent("connection refused"),
    )
  },
}

/** `status: "broken"` shows the server-reported `detail` verbatim — never a blank screen for a worktree that can't be read. */
export const BrokenStepShowsItsDetail: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider
        resolvers={{
          step: () => ({
            status: "broken",
            path: "/repos/gtd",
            repo: "gtd",
            detail: "not a git repository",
          }),
        }}
      >
        <Story />
      </TrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByTestId("app-broken")).toHaveTextContent("not a git repository"),
    )
  },
}

/** `status: "moved-on"` (`Server.ts`'s own `readServedStep`) means the outer loop moved on while this server was up — the turn is over and the server is exiting, never a blank screen. */
export const MovedOnStepShowsTheTurnIsOver: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider
        resolvers={{ step: () => ({ status: "moved-on", label: "reviewing a PR" }) }}
      >
        <Story />
      </TrpcTestProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("app-moved-on")).toBeInTheDocument())
  },
}

/** Package 03's own acceptance bullet: `trpc.step` in flight must render something other than an empty document — `App.tsx#28`'s bare `return null` was the exact regression (a blank white screen on first paint, over a tailnet, with nothing to explain why). */
export const StepQueryInFlightShowsALoadingSkeleton: Story = {
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
    expect(canvas.getByTestId("app-loading")).toBeInTheDocument()
    expect(canvasElement.textContent?.length).toBeGreaterThan(0)
    await waitFor(() => expect(canvas.getByTestId("plan-screen")).toBeInTheDocument())
  },
}

/** Package 01's own dispatch branch: an ABSENT `mode` falls through to `FreeForm`, never `Plan`/`Review` — the one case that used to refuse to start entirely (Task 9). */
export const NoModeOpensDirectlyOnTheFreeFormScreen: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider
        resolvers={{
          step: () => okStep({ file: ".gtd/TODO.md", mode: undefined }),
          readSteeringFile: () => ({
            ok: true,
            content: "A paragraph worth editing.",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: {
              nodes: [
                {
                  title: "A paragraph worth editing.",
                  anchor: { kind: "paragraph", line: 0 },
                  block: { kind: "paragraph", text: "A paragraph worth editing." },
                },
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
    await waitFor(() => expect(canvas.getByTestId("freeform-screen")).toBeInTheDocument())
    expect(canvas.queryByTestId("plan-screen")).not.toBeInTheDocument()
    expect(canvas.queryByTestId("review-screen")).not.toBeInTheDocument()
  },
}

/** Package 01's own dispatch branch: an UNREGISTERED `mode` (not "review"/"qa", and not in `steeringFormatFor`'s registry) also falls through to `FreeForm`. */
export const UnregisteredModeOpensDirectlyOnTheFreeFormScreen: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider
        resolvers={{
          step: () => okStep({ file: ".gtd/PLAN.md", mode: "custom-mode" }),
          readSteeringFile: () => ({
            ok: true,
            content: "A paragraph worth editing.",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: {
              nodes: [
                {
                  title: "A paragraph worth editing.",
                  anchor: { kind: "paragraph", line: 0 },
                  block: { kind: "paragraph", text: "A paragraph worth editing." },
                },
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
    await waitFor(() => expect(canvas.getByTestId("freeform-screen")).toBeInTheDocument())
    await expect(
      canvas.getByText('"custom-mode" has no screen — editing as plain markdown'),
    ).toBeInTheDocument()
  },
}

/**
 * A pinning test for the assumption `App.tsx`'s own dispatch hardcodes:
 * `"qa"`/`"review"` are the only two names with their own dedicated screen.
 * If the built-in registry (`steering/index.ts#REGISTRY`) ever grows a third
 * entry, THIS test breaks — loudly, at the source of truth — rather than
 * that third format silently rendering `FreeForm` while nothing here notices
 * `App.tsx`'s dispatch and the registry have quietly diverged.
 */
export const TheBuiltInRegistryStillHasExactlyTheTwoModesAppDispatchesByName: Story = {
  render: () => <></>,
  play: () => {
    expect(builtInModeNames()).toEqual(["qa", "review"])
  },
}
