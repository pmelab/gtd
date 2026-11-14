import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import { widgetFormat } from "../../steering/index.js"
import { TrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { Document, DocumentView } from "./Document.js"

const meta: Meta<typeof DocumentView> = {
  component: DocumentView,
  // A hunk's diff is fetched on demand.
  decorators: [
    (Story) => (
      <TrpcTestProvider resolvers={{ diff: () => ({ kind: "no-changes" }) }}>
        <Story />
      </TrpcTestProvider>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof DocumentView>

const PLAN = [
  "# Plan",
  "",
  "The API has no limit today.",
  "",
  "## 🔘 Where is the counter stored?",
  "",
  "Redis is already deployed.",
  "",
  "- [ ] Redis",
  "- [ ] Memory",
  "- [ ] ✏️",
  "",
  "## ☑️ Which endpoints?",
  "",
  "- [x] /search",
  "- [ ] /upload",
  "",
  "## 🔍 Middleware",
  "",
  "- [ ] ./src/limit.ts#1-40",
  "",
  "## ❔ Ship behind a flag?",
  "",
  "- [ ] Yes",
  "",
].join("\n")

export const RendersEveryWidgetKindInFileOrder: Story = {
  args: { filePath: ".gtd/PLAN.md", isLoading: false, view: widgetFormat.view(PLAN) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("The API has no limit today.")).toBeInTheDocument()
    const kinds = canvas
      .getAllByTestId(/^widget-(single-select|multi-select|review-checklist|boolean)$/)
      .map((el) => el.dataset.testid)
    await expect(kinds).toEqual([
      "widget-single-select",
      "widget-multi-select",
      "widget-review-checklist",
      "widget-boolean",
    ])
    const select = within(canvas.getByTestId("widget-single-select"))
    await expect(select.getAllByRole("radio")).toHaveLength(3)
    await expect(select.getByText("Redis is already deployed.")).toBeInTheDocument()
    await expect(select.getByTestId("widget-required")).toBeInTheDocument()
    const multi = within(canvas.getByTestId("widget-multi-select"))
    await expect(multi.getAllByRole("checkbox")[0]).toBeChecked()
    const checklist = within(canvas.getByTestId("widget-review-checklist"))
    await expect(checklist.getAllByTestId("widget-hunk")).toHaveLength(1)
  },
}

const recording = (calls: unknown[]) => ({
  readSteeringFile: () => ({
    ok: true,
    content: PLAN,
    headSha: "abc123",
    contentHash: "deadbeef",
    view: widgetFormat.view(PLAN),
  }),
  setValue: (input: unknown) => {
    calls.push(input)
    return { ok: true, contentHash: "deadbeef2" }
  },
})

export const PickingAnOptionWritesItsAnchor: StoryObj<typeof Document> = {
  render: (args) => (
    <TrpcTestProvider resolvers={recording([])}>
      <Document {...args} />
    </TrpcTestProvider>
  ),
  args: { filePath: ".gtd/PLAN.md" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("widget-single-select")).toBeInTheDocument())
    const select = within(canvas.getByTestId("widget-single-select"))
    const memory = select.getAllByRole("radio")[1]!
    await fireEvent.click(memory)
    await waitFor(() => expect(memory).toBeChecked())
    await expect(select.getAllByRole("radio")[0]).not.toBeChecked()
  },
}

export const ACustomAnswerSavesItsText: StoryObj<typeof Document> = {
  render: (args) => (
    <TrpcTestProvider resolvers={recording([])}>
      <Document {...args} />
    </TrpcTestProvider>
  ),
  args: { filePath: ".gtd/PLAN.md" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("widget-custom")).toBeInTheDocument())
    const custom = within(canvas.getByTestId("widget-custom"))
    await fireEvent.change(custom.getByRole("textbox"), { target: { value: "Postgres" } })
    await fireEvent.click(custom.getByTestId("widget-custom-save"))
    await waitFor(() => expect(custom.getByRole("radio")).toBeChecked())
  },
}
