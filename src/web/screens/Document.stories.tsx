import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import { widgetFormat } from "../../steering/index.js"
import { viewport } from "../testing/browserContext.js"
import { TrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { Document, DocumentView } from "./Document.js"

const meta: Meta<typeof DocumentView> = {
  component: DocumentView,
  parameters: { layout: "fullscreen" },
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
    await expect(canvas.getByTestId("hunk-position")).toHaveClass("sr-only")
    await expect(canvas.queryByTestId("hunk-tick")).toBeNull()
    await fireEvent.click(canvas.getByTestId("hunk-next"))
    await expect(canvas.getByTestId("hunk-position")).toHaveTextContent("2 / 3")
    await fireEvent.click(canvas.getByTestId("hunk-tick"))
    await expect(canvas.getByTestId("hunk-position")).toHaveTextContent("3 / 3")
    await fireEvent.click(canvas.getByTestId("hunk-back"))
    const hunks = canvas.getAllByTestId("widget-hunk")
    await expect(within(hunks[0]!).getByRole("checkbox")).toBeChecked()
    await expect(within(hunks[1]!).getByRole("checkbox")).not.toBeChecked()
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

const REQUIREMENTS = [
  "# Requirements",
  "",
  "## 🔘 Where is the counter stored?",
  "",
  "- [ ] Redis",
  "- [ ] Memory",
  "",
  "## 🔘 Which window?",
  "",
  "- [x] One minute",
  "- [ ] One hour",
  "",
  "## Acceptance Criteria",
  "",
  "- AC-1: A client over the limit gets a 429.",
  "",
  "## Impact",
  "",
  "- The limiter lands in the limiter module",
  "",
].join("\n")

const CONTEXT = { repo: "portal", branch: "rate-limit", label: "answering the requirements" }

export const ARequirementsPageShowsQuestionsCriteriaAndImpact: Story = {
  args: {
    filePath: ".gtd/REQUIREMENTS.md",
    context: CONTEXT,
    isLoading: false,
    view: widgetFormat.view(REQUIREMENTS),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const selects = canvas.getAllByTestId("widget-single-select")
    await expect(selects).toHaveLength(2)
    await expect(within(selects[0]!).getAllByRole("radio")[0]).not.toBeChecked()
    await expect(within(selects[1]!).getAllByRole("radio")[0]).toBeChecked()
    await expect(canvas.getByText("Acceptance Criteria")).toBeInTheDocument()
    await expect(canvas.getByText(/AC-1: A client over the limit/)).toBeInTheDocument()
    await expect(canvas.getByText("Impact")).toBeInTheDocument()
    const header = within(canvas.getByTestId("gate-header"))
    await expect(header.getByRole("heading", { level: 1 })).toHaveTextContent("Requirements")
    await expect(
      within(canvas.getByTestId("document-scroll")).queryByRole("heading", {
        name: "Requirements",
      }),
    ).toBeNull()
    await expect(header.getByTestId("gate-context")).toHaveTextContent(
      "portal / rate-limit · answering the requirements",
    )
    await expect(
      within(selects[0]!).getByRole("heading", { name: "Where is the counter stored?" }),
    ).toBeInTheDocument()
  },
}

/** Every answer row, note control and hunk link is a thumb-sized target on a phone. */
export const AnswerRowsAreThumbSizedOnAPhone: Story = {
  args: {
    filePath: ".gtd/PLAN.md",
    isLoading: false,
    view: widgetFormat.view(PLAN),
  },
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    const select = canvas.getByTestId("widget-single-select")
    const targets = [
      within(select).getByText("Redis").closest("label")!,
      within(canvas.getByTestId("widget-custom")).getByRole("radio").closest("label")!,
      within(select).getByTestId("widget-note-open"),
      within(canvas.getByTestId("widget-review-checklist")).getByText("Show the change"),
    ]
    for (const target of targets) {
      await expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
    await expect(
      within(select).getByTestId("widget-note-open").getBoundingClientRect().height,
    ).toBeLessThan(60)
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  },
}

/** The note gesture is explained once per page, however many prose runs the widgets split it into. */
export const TheNoteGestureIsExplainedOncePerPage: Story = {
  args: {
    filePath: ".gtd/PLAN.md",
    isLoading: false,
    view: widgetFormat.view(PLAN + "\n## After\n\nA closing paragraph.\n"),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByTestId("prose-paragraphs").length).toBeGreaterThan(1)
    await expect(canvas.getAllByTestId("note-gesture-hint")).toHaveLength(1)
  },
}

export const ADesignGateWithNoOpenQuestionIsAcceptedAsIs: Story = {
  args: {
    filePath: ".gtd/DESIGN.md",
    isLoading: false,
    view: widgetFormat.view("# Design\n\nThe limiter wraps the router.\n"),
    onDone: () => Promise.resolve(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("The limiter wraps the router.")).toBeInTheDocument()
    await expect(canvas.queryByTestId("widget-single-select")).toBeNull()
    await expect(canvas.getByTestId("plan-done")).toBeEnabled()
  },
}

const REVIEW_WITH_NOTES = [
  "<!-- base: e9503c1abcdef -->",
  "",
  "# Review",
  "",
  "Start with [the limiter](./src/limit.ts#1-40).",
  "",
  "## 🔘 Is the key per client?",
  "",
  "- [ ] Yes",
  "- [ ] No",
  "",
  "## 🔍 Middleware",
  "",
  "- [ ] ./src/limit.ts#1-40",
  "",
].join("\n")

export const AReviewPageShowsWalkthroughHunkLinksBaseAndNotes: Story = {
  args: {
    filePath: ".gtd/REVIEW.md",
    context: { ...CONTEXT, label: "reviewing the change" },
    isLoading: false,
    view: widgetFormat.view(REVIEW_WITH_NOTES),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("document-base")).toHaveTextContent("Review base: e9503c1")
    await expect(canvas.getByText(/Start with/)).toBeInTheDocument()
    await expect(canvas.getByText("the limiter")).toBeInTheDocument()
    await expect(canvas.getAllByTestId("widget-hunk")).toHaveLength(1)
    await expect(canvas.getByTestId("widget-reviewed-count")).toHaveTextContent("0 of 1 reviewed")
    await expect(canvas.getByTestId("widget-single-select")).toBeInTheDocument()
    await fireEvent.click(canvas.getByText("the limiter"))
    await expect(canvas.getByTestId("hunk-slider")).toBeInTheDocument()
  },
}

export const ASquashMessagePageShowsTheProposedMessage: Story = {
  args: {
    filePath: ".gtd/SQUASH_MESSAGE.md",
    context: { ...CONTEXT, label: "approving the message" },
    isLoading: false,
    view: widgetFormat.view("feat: limit requests per client\n\nCloses #12.\n"),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/feat: limit requests per client/)).toBeInTheDocument()
    await expect(canvas.getByText(/Closes #12/)).toBeInTheDocument()
    const message = canvas.getByTestId("commit-message")
    await expect(message).toHaveTextContent("Proposed commit message")
    await expect(within(message).getByText(/feat: limit requests/)).toBeInTheDocument()
    await expect(
      getComputedStyle(message.querySelector("[data-slot=card-content]")!).fontFamily,
    ).toMatch(/mono/i)
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent("Squash message")
  },
}

export const WhileTheFileLoadsTheShapeOfThePageShows: Story = {
  args: { filePath: ".gtd/PLAN.md", isLoading: true, view: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvasElement.querySelector("[data-slot=skeleton]")).not.toBeNull()
    await expect(canvas.getByText("Loading the file…")).toHaveClass("sr-only")
  },
}

export const AFileThatCannotBeReadSaysWhatToDo: Story = {
  args: { filePath: ".gtd/PLAN.md", isLoading: false, view: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toHaveTextContent(/reload this page/)
  },
}
