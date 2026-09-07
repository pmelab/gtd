import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import { FREE_TEXT_PLACEHOLDER } from "../../OpenQuestions.js"
import type { SteeringViewNode } from "../../SteeringFormat.js"
import { Question } from "./Question.js"

/**
 * Stands in for the browser's `SpeechRecognition` — mirrors
 * `Mic.stories.tsx#FakeSpeechRecognition` exactly (that one isn't exported;
 * this is the smallest local copy needed to reproduce the "typed during an
 * active dictation session" scenario at this component's own layer, since
 * `Mic.stories.tsx` alone can't prove `Question.tsx`'s consuming side wires
 * the functional-updater fix correctly).
 */
class FakeSpeechRecognition extends EventTarget {
  static instances: FakeSpeechRecognition[] = []
  continuous = false
  interimResults = false
  onresult:
    | ((event: {
        resultIndex: number
        results: { isFinal: boolean; 0: { transcript: string } }[]
      }) => void)
    | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null

  constructor() {
    super()
    FakeSpeechRecognition.instances.push(this)
  }

  start() {}
  stop() {
    this.onend?.()
  }
  emitFinal(transcript: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript } }] })
  }
}

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

/**
 * Reproduces the exact bug: dictation is tapped on an EMPTY free-text field,
 * the human types "hello" WHILE the session is still recording, then stops —
 * the final dictated text must be APPENDED to what was typed meanwhile, never
 * silently replace it. This closes over `freeText` via the `onDictate`
 * functional-updater path (`Question.tsx`), not a stale value read from the
 * render where Dictate was tapped.
 */
export const TypingDuringAnActiveDictationSessionIsNeverClobbered: Story = {
  args: { node: questionNode() },
  beforeEach: () => {
    FakeSpeechRecognition.instances = []
    window.SpeechRecognition = FakeSpeechRecognition as unknown as NonNullable<
      typeof window.SpeechRecognition
    >
    return () => {
      delete window.SpeechRecognition
    }
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("mic-toggle"))
    // Type WHILE the (fake) session is still "recording" — before any final
    // result arrives.
    await fireEvent.change(canvas.getByTestId("free-text-input"), {
      target: { value: "hello" },
    })
    const recognition = FakeSpeechRecognition.instances.at(-1)
    recognition?.emitFinal("world")
    recognition?.stop()
    await waitFor(() => expect(canvas.getByTestId("free-text-input")).toHaveValue("hello world"))
  },
}
