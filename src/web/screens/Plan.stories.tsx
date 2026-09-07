import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import type { SteeringView, SteeringViewNode } from "../../SteeringFormat.js"
import { PlanView } from "./Plan.js"

const meta: Meta<typeof PlanView> = {
  component: PlanView,
}

export default meta

type Story = StoryObj<typeof PlanView>

const openQuestion = (index: number, title: string): SteeringViewNode => ({
  title,
  status: "open",
  answered: false,
  anchor: { kind: "question", index },
  children: [
    {
      title: "Option A",
      checked: false,
      anchor: { kind: "option", questionIndex: index, index: 0 },
    },
    {
      title: "Option B",
      checked: false,
      anchor: { kind: "option", questionIndex: index, index: 1 },
    },
  ],
})

const answeredQuestion = (index: number, title: string): SteeringViewNode => ({
  title,
  status: "answered",
  answered: false,
  anchor: { kind: "question", index },
  children: [],
})

const QA_SAMPLE_CONTENT = `Sample plan.

## Open Questions

### Which option?

- [ ] Option A
- [ ] Option B
`

export const AlreadyAnsweredSectionRendersBelowOpenQuestions: Story = {
  args: {
    content: QA_SAMPLE_CONTENT,
    isLoading: false,
    view: {
      nodes: [openQuestion(0, "Open one"), answeredQuestion(1, "Answered one")],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const openHeading = canvas.getByText("Open Questions")
    const answeredHeading = canvas.getByText("Already answered")
    expect(
      openHeading.compareDocumentPosition(answeredHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
}

export const DocumentWithNoOpenQuestionsRendersNoEmptyHeading: Story = {
  args: {
    content: QA_SAMPLE_CONTENT,
    isLoading: false,
    view: {
      nodes: [answeredQuestion(0, "Answered one")],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText("Open Questions")).not.toBeInTheDocument()
    await expect(canvas.getByText("Already answered")).toBeInTheDocument()
  },
}

export const ProseOnlyFileRendersParagraphsAndNoQuestionList: Story = {
  args: {
    content: "First paragraph of the plan.\n\nSecond paragraph with more detail.",
    isLoading: false,
    view: { nodes: [] } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("First paragraph of the plan.")).toBeInTheDocument()
    await expect(canvas.getByText("Second paragraph with more detail.")).toBeInTheDocument()
    await expect(canvas.getByTestId("note-seam-0")).toBeInTheDocument()
    await expect(canvas.getByTestId("note-seam-1")).toBeInTheDocument()
    await expect(canvas.queryByText("Open Questions")).not.toBeInTheDocument()
    await expect(canvas.queryByTestId("question-card-0")).not.toBeInTheDocument()
  },
}

/** Toggles `PlanView`'s `content` between two versions of "the same file" on a button click — so a story can prove the read-the-plan confirmation (keyed on `content`'s own hash) clears the moment the file is REWRITTEN, without needing Storybook's own arg-update machinery. */
const RewritablePlan = () => {
  const [rewritten, setRewritten] = useState(false)
  const content = rewritten
    ? "Version two of the plan, completely rewritten."
    : "Version one of the plan."
  return (
    <div>
      <button type="button" data-testid="rewrite-file" onClick={() => setRewritten(true)}>
        Rewrite file
      </button>
      <PlanView content={content} isLoading={false} view={{ nodes: [] } satisfies SteeringView} />
    </div>
  )
}

export const ReadThePlanConfirmationClearsWhenContentHashChanges: StoryObj<typeof RewritablePlan> =
  {
    render: () => <RewritablePlan />,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      await fireEvent.click(canvas.getByTestId("read-plan-row"))
      await waitFor(() => expect(canvas.getByTestId("read-plan-row")).toHaveTextContent("✓"))

      // Rewriting the file (a different hash) must clear the confirmation.
      await fireEvent.click(canvas.getByTestId("rewrite-file"))
      await waitFor(() => expect(canvas.getByTestId("read-plan-row")).not.toHaveTextContent("✓"))
    },
  }
