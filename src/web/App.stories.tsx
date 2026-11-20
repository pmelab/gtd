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
                {
                  title: "A paragraph worth reading.",
                  anchor: { kind: "paragraph", line: 0 },
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
        resolvers={{
          step: () => ({ status: "moved-on", label: "reviewing a PR" }),
        }}
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
                {
                  title: "A paragraph worth reading.",
                  anchor: { kind: "paragraph", line: 0 },
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
    await expect(canvas.getByTestId("app-loading")).toBeInTheDocument()
    await expect(canvasElement.querySelector("[data-slot=skeleton]")).not.toBeNull()
    await expect(canvasElement.textContent?.length).toBeGreaterThan(0)
    await waitFor(() => expect(canvas.getByTestId("document-screen")).toBeInTheDocument())
  },
}

const withInsets = async (top: number, bottom: number, run: () => Promise<void>): Promise<void> => {
  document.documentElement.style.setProperty("--safe-top", `${top}px`)
  document.documentElement.style.setProperty("--safe-bottom", `${bottom}px`)
  try {
    await run()
  } finally {
    document.documentElement.style.removeProperty("--safe-top")
    document.documentElement.style.removeProperty("--safe-bottom")
  }
}

const brokenDecorator: NonNullable<Story["decorators"]> = [
  (Story) => (
    <TrpcTestProvider
      resolvers={{
        step: () => ({
          status: "broken",
          repo: "gtd",
          branch: "main",
          detail: "bad",
        }),
      }}
    >
      <Story />
    </TrpcTestProvider>
  ),
]

/** A state page keeps its own padding on top of the inset, and keeps it with no inset. */
export const StatePagePaddingAddsToTheInsets: Story = {
  decorators: brokenDecorator,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const box = async (): Promise<DOMRect> =>
      (await canvas.findByTestId("app-broken")).getBoundingClientRect()
    await withInsets(0, 0, async () => {
      await expect((await box()).top).toBeGreaterThanOrEqual(32)
    })
    await withInsets(50, 34, async () => {
      await expect((await box()).top).toBeGreaterThanOrEqual(82)
    })
  },
}

/** The gate header clears the top inset once; the document screen adds no second band. */
export const DocumentScreenClearsInsetsOnce: Story = {
  ...Default,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await withInsets(50, 34, async () => {
      const header = await canvas.findByTestId("gate-header")
      await expect(parseFloat(getComputedStyle(header).paddingTop)).toBeGreaterThanOrEqual(50)
    })
  },
}
