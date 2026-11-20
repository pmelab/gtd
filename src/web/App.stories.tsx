import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import { widgetFormat } from "../steering/index.js"
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
  parameters: { layout: "fullscreen" },
}

export default meta

type Story = StoryObj<typeof App>

/** `gtd ui` never binds on a step this client can't render, so `App` opens directly on the served worktree's one step: its steering file on the document screen. */
export const Default: Story = {
  decorators: [
    (Story) => (
      <TrpcTestProvider
        resolvers={{
          step: () => okStep({ file: ".gtd/PLAN.md" }),
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
    await waitFor(() => expect(canvas.getByTestId("document-screen")).toBeInTheDocument())
    await expect(canvas.getByTestId("gate-context")).toHaveTextContent(
      "gtd / main · reviewing a PR",
    )
  },
}

/** A step with no steering `file` (a `script`/`stalled` rest) is defensive, not a reachable production shape (the server itself never binds on one — package 02's refuse-to-start gate) — but must still render something legible, never a blank screen. */
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
    await expect(canvas.queryByTestId("document-screen")).not.toBeInTheDocument()
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
    await expect(canvas.getByTestId("app-query-error")).toHaveTextContent(/reload this page/)
    await expect(canvas.getByRole("button", { name: "Reload" })).toBeInTheDocument()
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
            branch: "main",
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
          step: () => okStep({ file: ".gtd/PLAN.md" }),
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
    await expect(canvas.getByTestId("app-loading")).toBeInTheDocument()
    await expect(canvasElement.querySelector("[data-slot=skeleton]")).not.toBeNull()
    await expect(canvasElement.textContent?.length).toBeGreaterThan(0)
    await waitFor(() => expect(canvas.getByTestId("document-screen")).toBeInTheDocument())
  },
}

const LONG_PLAN = [
  "## 🔘 Where is the counter stored?",
  "",
  "- [ ] Redis",
  "- [ ] Memory",
  "",
  ...Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of the plan.\n`),
].join("\n")

/** Inline, in a pane that scrolls, a failed save stays in sight however far you scroll. */
export const InlineAFailedSaveStaysInThePaneWhenScrolled: Story = {
  render: () => (
    <TrpcTestProvider
      resolvers={{
        step: () => okStep({ file: ".gtd/PLAN.md" }),
        readSteeringFile: () => ({
          ok: true,
          content: LONG_PLAN,
          headSha: "abc123",
          contentHash: "deadbeef",
          view: widgetFormat.view(LONG_PLAN),
        }),
        setValue: () => {
          throw new Error("connection refused")
        },
      }}
    >
      <div data-testid="pane" className="relative h-[400px] overflow-auto">
        <App inline />
      </div>
    </TrpcTestProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pane = canvas.getByTestId("pane")
    await waitFor(() => expect(canvas.getAllByRole("radio")).toHaveLength(2))
    await fireEvent.click(canvas.getAllByRole("radio")[1]!)
    await waitFor(() => expect(canvas.getByTestId("save-indicator-expanded")).toBeInTheDocument())
    await expect(pane.scrollHeight).toBeGreaterThan(1200)
    const box = pane.getBoundingClientRect()
    for (const top of [0, pane.scrollHeight / 2, pane.scrollHeight]) {
      pane.scrollTop = top
      const toast = canvas.getByTestId("save-indicator").getBoundingClientRect()
      await expect(toast.top).toBeGreaterThanOrEqual(box.top)
      await expect(toast.bottom).toBeLessThanOrEqual(box.bottom)
    }
  },
}
