import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, waitFor, within } from "storybook/test"
import { App } from "./App.js"
import { TrpcTestProvider } from "./testing/TrpcTestProvider.js"

const EMPTY_FLEET = {
  buckets: { "wants-you": [], working: [], broken: [], quiet: [] },
  wantsYouCount: 0,
}

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
