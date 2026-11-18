import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
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
  args: {
    filePath: ".gtd/PLAN.md",
    isLoading: false,
    view: widgetFormat.view(PLAN),
  },
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
    await expect(custom.queryByTestId("widget-custom-save")).toBeNull()
    await fireEvent.change(custom.getByRole("textbox"), {
      target: { value: "Postgres" },
    })
    await waitFor(() => expect(custom.getByRole("radio")).toBeChecked())
    await fireEvent.change(custom.getByRole("textbox"), {
      target: { value: "" },
    })
    await waitFor(() => expect(custom.getByRole("radio")).not.toBeChecked())
  },
}

const Leavable = ({ filePath }: { readonly filePath: string }) => {
  const [shown, setShown] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setShown(false)}>
        Leave
      </button>
      {shown && <Document filePath={filePath} />}
    </>
  )
}

const leaveCalls: unknown[] = []

export const LeavingRightAfterTypingStillSavesTheCustomAnswer: StoryObj<typeof Document> = {
  render: (args) => (
    <TrpcTestProvider resolvers={recording(leaveCalls)}>
      <Leavable {...args} />
    </TrpcTestProvider>
  ),
  args: { filePath: ".gtd/PLAN.md" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("widget-custom")).toBeInTheDocument())
    await fireEvent.change(within(canvas.getByTestId("widget-custom")).getByRole("textbox"), {
      target: { value: "Postgres" },
    })
    await fireEvent.click(canvas.getByText("Leave"))
    await waitFor(() => expect(JSON.stringify(leaveCalls)).toContain('"text":"Postgres"'))
  },
}

const REVIEW = [
  "<!-- base: e9503c1abcdef -->",
  "",
  "# Review",
  "",
  "See [the limiter](./src/limit.ts#1-40) first.",
  "",
  "## 🔍 Middleware",
  "",
  "- [ ] ./src/limit.ts#1-40",
  "- [ ] ./src/todos.js#20-25",
  "",
].join("\n")

export const AReviewShowsTheBaseAndStepsThroughHunks: Story = {
  args: {
    filePath: ".gtd/REVIEW.md",
    isLoading: false,
    view: widgetFormat.view(REVIEW),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("document-base")).toHaveTextContent("Review base: e9503c1")
    await expect(canvas.queryByText(/<!-- base/)).toBeNull()
    await fireEvent.click(canvas.getByText("the limiter"))
    await expect(canvas.getByTestId("hunk-position")).toHaveTextContent("1 / 3")
    await expect(canvas.queryByTestId("hunk-tick")).toBeNull()
    await fireEvent.click(canvas.getByTestId("hunk-next"))
    await expect(canvas.getByTestId("hunk-position")).toHaveTextContent("2 / 3")
    await fireEvent.click(canvas.getByTestId("hunk-tick"))
    await expect(canvas.getByTestId("hunk-position")).toHaveTextContent("3 / 3")
    await fireEvent.click(canvas.getByTestId("hunk-back"))
    await expect(canvas.getAllByTestId("widget-hunk")[0]!.querySelector("input")).toBeChecked()
    await expect(canvas.getAllByTestId("widget-hunk")[1]!.querySelector("input")).not.toBeChecked()
  },
}

const Refetched = ({ before, after }: { readonly before: string; readonly after: string }) => {
  const [content, setContent] = useState(before)
  return (
    <>
      <button type="button" onClick={() => setContent(after)}>
        Refetch
      </button>
      <DocumentView filePath=".gtd/REVIEW.md" isLoading={false} view={widgetFormat.view(content)} />
    </>
  )
}

export const ARefetchThatDropsEveryHunkShowsTheDocumentAgain: Story = {
  render: () => <Refetched before={REVIEW} after={"# Review\n\nAll hunks resolved.\n"} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByText("the limiter"))
    await expect(canvas.getByTestId("hunk-slider")).toBeInTheDocument()
    await fireEvent.click(canvas.getByText("Refetch"))
    await waitFor(() => expect(canvas.queryByTestId("hunk-slider")).toBeNull())
    await expect(canvas.getByTestId("document-scroll")).not.toHaveClass("hidden")
    await expect(canvas.getByText("All hunks resolved.")).toBeVisible()
  },
}
