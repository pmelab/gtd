import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, within } from "storybook/test"
import { FREE_TEXT_PLACEHOLDER } from "../../OpenQuestions.js"
import type { SteeringViewNode } from "../../SteeringFormat.js"
import { Question } from "./Question.js"

const meta: Meta<typeof Question> = {
  component: Question,
}

export default meta

type Story = StoryObj<typeof Question>

/** A three-option question: two ordinary options, plus a free-text slot LAST — labeled to look like a normal option (no "other"/"free text" wording), so it's identified by array position alone. */
const questionNode = (over: Partial<SteeringViewNode> = {}): SteeringViewNode => ({
  title: "Which option?",
  status: "open",
  answered: false,
  anchor: { kind: "question", index: 0 },
  children: [
    { title: "Option A", checked: false, anchor: { kind: "option", questionIndex: 0, index: 0 } },
    { title: "Option B", checked: false, anchor: { kind: "option", questionIndex: 0, index: 1 } },
    {
      title: "Ship it this way",
      checked: false,
      anchor: { kind: "option", questionIndex: 0, index: 2 },
    },
  ],
  ...over,
})

export const TickingASecondOptionUnticksTheFirst: Story = {
  args: { node: questionNode() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("option-radio-0"))
    await expect(canvas.getByTestId("option-radio-0")).toBeChecked()
    await fireEvent.click(canvas.getByTestId("option-radio-1"))
    await expect(canvas.getByTestId("option-radio-1")).toBeChecked()
    await expect(canvas.getByTestId("option-radio-0")).not.toBeChecked()
  },
}

export const TickedFreeTextOptionWithEmptyTextIsUnanswered: Story = {
  args: { node: questionNode() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("option-radio-2"))
    await expect(canvas.getByTestId("question-status")).toHaveTextContent("unanswered")
  },
}

export const TickedFreeTextOptionWithTextIsAnswered: Story = {
  args: { node: questionNode() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("option-radio-2"))
    await fireEvent.change(canvas.getByTestId("free-text-input"), {
      target: { value: "Do it the third way" },
    })
    await expect(canvas.getByTestId("question-status")).toHaveTextContent("answered")
  },
}

/** The free-text slot is IDENTIFIED BY ARRAY POSITION, not label text: option 2's title ("Ship it this way") reads like an ordinary option, yet typing into `free-text-input` still answers the question — proving the last slot is treated as free-text regardless of what it's labeled. */
export const FreeTextSlotIsIdentifiedByPositionNotLabel: Story = {
  args: { node: questionNode() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("option-2")).toHaveTextContent("Ship it this way")
    await expect(canvas.getByTestId("free-text-input")).toBeInTheDocument()
    await fireEvent.click(canvas.getByTestId("option-radio-2"))
    await fireEvent.change(canvas.getByTestId("free-text-input"), {
      target: { value: "answered via the last slot" },
    })
    await expect(canvas.getByTestId("question-status")).toHaveTextContent("answered")
  },
}

export const PlaceholderDifferingOnlyInCaseNormalizesToEmpty: Story = {
  args: { node: questionNode() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("option-radio-2"))
    await fireEvent.change(canvas.getByTestId("free-text-input"), {
      // The SAME sentinel `OpenQuestions.ts#FREE_TEXT_PLACEHOLDER` uses
      // server-side, just differing in letter case — proving this component
      // normalizes against the one real placeholder, not an invented hint.
      target: { value: FREE_TEXT_PLACEHOLDER.toUpperCase() },
    })
    await expect(canvas.getByTestId("question-status")).toHaveTextContent("unanswered")
  },
}

export const AnOrdinaryOptionAnswersImmediatelyOnceTicked: Story = {
  args: { node: questionNode() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("option-radio-0"))
    await expect(canvas.getByTestId("question-status")).toHaveTextContent("answered")
  },
}

export const NoSpeechApiShowsAHintInsteadOfAMicButton: Story = {
  args: { node: questionNode() },
  beforeEach: () => {
    delete window.SpeechRecognition
    delete window.webkitSpeechRecognition
    return () => {}
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByTestId("mic-toggle")).not.toBeInTheDocument()
    await expect(canvas.getByTestId("mic-hint")).toBeInTheDocument()
  },
}
