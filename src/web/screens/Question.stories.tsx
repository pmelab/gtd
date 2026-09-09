import type { Meta, StoryObj } from "@storybook/react-vite"
import { useRef, useState } from "react"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import { FREE_TEXT_PLACEHOLDER } from "../../OpenQuestions.js"
import type { SteeringAnchor, SteeringViewNode } from "../../SteeringFormat.js"
import { RefusalBanner, useRefusal } from "../Refusal.js"
import { defaultAnswerFor, Question, type QuestionAnswer } from "./Question.js"

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

/**
 * `Question` is fully controlled (no internal `useState` of its own — see
 * its own doc comment for why: state must survive `Deck` remounting it per
 * navigation, which only a caller-owned answer can do). Every story below
 * still just passes `{node}`, unaware of that — this harness supplies the
 * `answer`/`onAnswerChange` half via `meta.render`, seeded from the SAME
 * `defaultAnswerFor` the real `Plan.tsx` uses, so a story exercises the
 * exact same "starts from node.children, then tracks edits" behavior.
 * `onCommitAnswer`/`onRefusal` pass straight through — absent unless a story
 * supplies them, exactly like the real `Plan.tsx`/`Question.tsx` contract.
 */
const ControlledQuestionHarness = (props: {
  readonly node: SteeringViewNode
  readonly onCommitAnswer?: (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ) => Promise<unknown>
  readonly onRefusal?: (error: unknown) => void
}) => {
  const [answer, setAnswer] = useState<QuestionAnswer>(() => defaultAnswerFor(props.node))
  return (
    <Question
      node={props.node}
      answer={answer}
      onAnswerChange={setAnswer}
      {...(props.onCommitAnswer !== undefined ? { onCommitAnswer: props.onCommitAnswer } : {})}
      {...(props.onRefusal !== undefined ? { onRefusal: props.onRefusal } : {})}
    />
  )
}

const meta: Meta<typeof Question> = {
  component: Question,
  render: (args) => (
    <ControlledQuestionHarness
      node={args.node}
      {...(args.onCommitAnswer !== undefined ? { onCommitAnswer: args.onCommitAnswer } : {})}
      {...(args.onRefusal !== undefined ? { onRefusal: args.onRefusal } : {})}
    />
  ),
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

/** One recorded `onCommitAnswer` call — shared by every harness/story below that records commits, so the JSON shape and its read-back helper (`readCommitCalls`) stay a single definition instead of N near-identical inline `JSON.parse` casts. */
interface CommitCall {
  readonly anchor: SteeringAnchor
  readonly opts: { readonly checked?: boolean; readonly text?: string }
}

/** Reads `data-testid="commit-calls"`'s JSON back off the DOM — the recorder pattern every commit-recording harness below uses, mirroring `Review.stories.tsx#SetValueCallRecorder`'s identical reasoning: a plain closure-captured array goes stale across `Question`'s own re-renders, so `waitFor` must always re-read the CURRENT DOM state instead. */
const readCommitCalls = (canvas: ReturnType<typeof within>): readonly CommitCall[] =>
  JSON.parse(canvas.getByTestId("commit-calls").textContent ?? "[]") as CommitCall[]

/**
 * `onCommitAnswer` recorded into the DOM (`data-testid="commit-calls"`) as
 * JSON — see `readCommitCalls`'s own doc comment for why (the bug the
 * previous version of these two stories had: `calls` never actually
 * populated, so both asserted nothing).
 */
const CommitCallRecordingHarness = ({ node }: { readonly node: SteeringViewNode }) => {
  const [answer, setAnswer] = useState<QuestionAnswer>(() => defaultAnswerFor(node))
  const [calls, setCalls] = useState<readonly CommitCall[]>([])
  const onCommitAnswer = (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ) => {
    setCalls((prev) => [...prev, { anchor, opts }])
    return Promise.resolve({ ok: true })
  }
  return (
    <>
      <div data-testid="commit-calls">{JSON.stringify(calls)}</div>
      <Question
        node={node}
        answer={answer}
        onAnswerChange={setAnswer}
        onCommitAnswer={onCommitAnswer}
      />
    </>
  )
}

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

/**
 * A stale/malformed `node.children` snapshot with TWO options already
 * `checked: true` must seed as unanswered — never "pick the first ticked
 * one", which would render "answered" for a document the server's own
 * `isAnswered` (and the landing gate) both read as unanswered
 * (`ticked.length !== 1` fails immediately). The radio UI itself can never
 * produce this once a human is driving the screen; this guards the SEED.
 */
export const ANodeWithTwoOptionsAlreadyCheckedSeedsAsUnanswered: Story = {
  args: {
    node: questionNode({
      children: [
        {
          title: "Option A",
          checked: true,
          anchor: { kind: "option", questionIndex: 0, index: 0 },
        },
        {
          title: "Option B",
          checked: true,
          anchor: { kind: "option", questionIndex: 0, index: 1 },
        },
        {
          title: "Ship it this way",
          checked: false,
          anchor: { kind: "option", questionIndex: 0, index: 2 },
        },
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("option-radio-0")).not.toBeChecked()
    await expect(canvas.getByTestId("option-radio-1")).not.toBeChecked()
    await expect(canvas.getByTestId("question-status")).toHaveTextContent("unanswered")
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
    // T7: "hides the mic, KEEPS THE TEXTAREA, and shows a one-line hint" —
    // the textarea itself must still be there and still usable, never
    // removed alongside the mic.
    const textarea = canvas.getByTestId("free-text-input") as HTMLTextAreaElement
    expect(textarea).toBeInTheDocument()
    await fireEvent.change(textarea, { target: { value: "typed by hand instead" } })
    expect(textarea.value).toBe("typed by hand instead")
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

/** Package 03's Task 10: `Question.stories.tsx`'s first commit-path coverage — type, blur, exactly one `setValue`-shaped call carrying `checked` and `text` together, never two separate writes. Never taps the radio directly: `FreeTextOption`'s own focus/change handlers stay LOCAL-only (`selectLocally`), so the blur is the ONLY write this produces — a radio tap would fire its own separate `{checked:true}`-only write first. */
export const TypingThenBlurringCommitsOnceWithCheckedAndTextTogether: StoryObj<typeof Question> = {
  args: { node: questionNode() },
  render: (args) => <CommitCallRecordingHarness node={args.node} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByTestId("free-text-input")
    await fireEvent.change(textarea, { target: { value: "the third way, typed" } })
    await fireEvent.blur(textarea)
    await waitFor(() => expect(readCommitCalls(canvas)).toHaveLength(1))
    expect(readCommitCalls(canvas)[0]?.opts).toEqual({
      checked: true,
      text: "the third way, typed",
    })
  },
}

/**
 * Package 03's Task 5: 800ms after the last keystroke with NO blur at all,
 * the free-text slot commits on its own — a typed-but-never-blurred answer
 * must still land, or a tab close/screen lock before any blur silently
 * discards it (`Question.tsx#118`'s own package doc comment).
 */
export const TypedTextCommitsOnItsOwnAfterTheDebounceWithNoBlur: StoryObj<typeof Question> = {
  args: { node: questionNode() },
  render: (args) => <CommitCallRecordingHarness node={args.node} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.change(canvas.getByTestId("free-text-input"), {
      target: { value: "typed but never blurred" },
    })
    expect(canvas.getByTestId("commit-calls")).toHaveTextContent("[]")
    // A real wait, not `vi.useFakeTimers()`: this Storybook interaction test
    // runs the component in a real browser iframe, whose own `setTimeout`
    // fake timers installed in the OUTER test realm never reach — advancing
    // a fake clock here just leaves the real 800ms timer never actually
    // firing.
    await waitFor(() => expect(readCommitCalls(canvas)).toHaveLength(1), { timeout: 2_000 })
    expect(readCommitCalls(canvas)[0]?.opts).toEqual({
      checked: true,
      text: "typed but never blurred",
    })
  },
}

/**
 * Package 03's Task 6: deleting a previously-written free-text answer and
 * blurring must write the ERASE (`checked: false, text: ""`), not silently
 * leave the stale text on disk while the UI shows empty — the guard moved
 * off "is the text empty" onto "did the text change from what was last
 * committed", so a bare focus-then-blur (covered elsewhere) still writes
 * nothing, but THIS, an actual edit back to empty, must write through.
 */
export const DeletingAPreviouslyWrittenAnswerAndBlurringErasesIt: StoryObj<typeof Question> = {
  args: {
    node: questionNode({
      children: [
        {
          title: "Option A",
          checked: false,
          anchor: { kind: "option", questionIndex: 0, index: 0 },
        },
        {
          title: "Option B",
          checked: false,
          anchor: { kind: "option", questionIndex: 0, index: 1 },
        },
        {
          title: "an existing typed answer",
          checked: true,
          anchor: { kind: "option", questionIndex: 0, index: 2 },
        },
      ],
    }),
  },
  render: (args) => <CommitCallRecordingHarness node={args.node} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByTestId("free-text-input")
    await expect(textarea).toHaveValue("an existing typed answer")
    await fireEvent.change(textarea, { target: { value: "" } })
    await fireEvent.blur(textarea)
    await waitFor(() => expect(readCommitCalls(canvas)).toHaveLength(1))
    expect(readCommitCalls(canvas)[0]?.opts).toEqual({ checked: false, text: "" })
  },
}

/**
 * A hand-built `onCommitAnswer` whose write for option 0 never resolves
 * until this harness's own "Reject A" button fires it — every OTHER option
 * resolves immediately. Mirrors `Review.stories.tsx#TwoHunkRevertHarness`'s
 * identical pattern, at `Question`'s own layer.
 */
const RevertScopeHarness = ({ node }: { readonly node: SteeringViewNode }) => {
  const [answer, setAnswer] = useState<QuestionAnswer>(() => defaultAnswerFor(node))
  const pendingRejectRef = useRef<((error: unknown) => void) | undefined>(undefined)
  const onCommitAnswer = (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<unknown> => {
    void opts
    if (anchor.kind === "option" && anchor.index === 0) {
      return new Promise((_resolve, reject) => {
        pendingRejectRef.current = reject
      })
    }
    return Promise.resolve({ ok: true })
  }
  return (
    <>
      <button
        type="button"
        data-testid="reject-option-a"
        onClick={() => pendingRejectRef.current?.(new Error("stale token"))}
      >
        Reject A
      </button>
      <Question
        node={node}
        answer={answer}
        onAnswerChange={setAnswer}
        onCommitAnswer={onCommitAnswer}
      />
    </>
  )
}

/**
 * Package 03's Task 7, verbatim concrete failure: tick option 0 (slow
 * write), tick option 1 (lands), option 0's write rejects — option 1's tick
 * must still stand. The per-FIELD (`selected`) seq is what makes this safe:
 * a whole-`answer` snapshot revert (the previous defect) would instead wipe
 * `selected` back to whatever it was before option 0 was ever tapped,
 * discarding option 1's own, already-landed tick.
 */
export const ARejectedTickOnOneOptionLeavesALaterTickOnAnotherOptionStanding: StoryObj<
  typeof Question
> = {
  args: { node: questionNode() },
  render: (args) => <RevertScopeHarness node={args.node} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("option-radio-0")) // A — write never resolves yet
    await expect(canvas.getByTestId("option-radio-0")).toBeChecked()

    await fireEvent.click(canvas.getByTestId("option-radio-1")) // B — write resolves immediately
    await expect(canvas.getByTestId("option-radio-1")).toBeChecked()
    await expect(canvas.getByTestId("option-radio-0")).not.toBeChecked()

    await fireEvent.click(canvas.getByTestId("reject-option-a"))
    await waitFor(() => expect(canvas.getByTestId("option-radio-1")).toBeChecked()) // still B
    await expect(canvas.getByTestId("option-radio-0")).not.toBeChecked()
  },
}

/**
 * A hand-built `onCommitAnswer` whose free-text write (option 2, carrying
 * `text`) never resolves until "Reject Free Text" fires it — an ordinary
 * option tick resolves immediately.
 */
const FreeTextRevertScopeHarness = ({ node }: { readonly node: SteeringViewNode }) => {
  const [answer, setAnswer] = useState<QuestionAnswer>(() => defaultAnswerFor(node))
  const pendingRejectRef = useRef<((error: unknown) => void) | undefined>(undefined)
  const onCommitAnswer = (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<unknown> => {
    if (opts.text !== undefined) {
      return new Promise((_resolve, reject) => {
        pendingRejectRef.current = reject
      })
    }
    void anchor
    return Promise.resolve({ ok: true })
  }
  return (
    <>
      <button
        type="button"
        data-testid="reject-free-text"
        onClick={() => pendingRejectRef.current?.(new Error("stale token"))}
      >
        Reject free text
      </button>
      <Question
        node={node}
        answer={answer}
        onAnswerChange={setAnswer}
        onCommitAnswer={onCommitAnswer}
      />
    </>
  )
}

/**
 * The free-text half of Task 7's same defect: typing into the free-text
 * slot and blurring fires a write that never resolves yet; a plain option
 * tick made WHILE it's still pending resolves immediately and must still
 * stand once the free-text write rejects — a whole-`answer` snapshot revert
 * would instead restore `previous.selected` too, discarding the radio tick
 * made in the interim.
 */
export const ARejectedFreeTextWriteLeavesALaterRadioTickStanding: StoryObj<typeof Question> = {
  args: { node: questionNode() },
  render: (args) => <FreeTextRevertScopeHarness node={args.node} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByTestId("free-text-input")
    await fireEvent.change(textarea, { target: { value: "typed while in flight" } })
    await fireEvent.blur(textarea) // write never resolves yet

    await fireEvent.click(canvas.getByTestId("option-radio-0")) // resolves immediately
    await expect(canvas.getByTestId("option-radio-0")).toBeChecked()

    await fireEvent.click(canvas.getByTestId("reject-free-text"))
    await waitFor(() => expect(canvas.getByTestId("option-radio-0")).toBeChecked()) // still ticked
  },
}

/**
 * `RefusalHarness` mounts the SAME `useRefusal`/`RefusalBanner` pair the real
 * `Plan`/`Review` containers mount, wired to `Question`'s own `onRefusal`
 * prop — package 03 Task 1's acceptance: a rejected write names its reason on
 * screen, not silence. Also wraps `onCommitAnswer` in `trackSave`, exactly
 * like `Plan.tsx`'s own `onCommitAnswerTracked` — needed to reproduce the
 * spec-feedback bug where a refused write's `saveStatus` still settled to
 * `"saved"`, later showing "Saved" for a write that never landed once the
 * refusal itself was dismissed.
 */
const RefusalHarness = ({
  node,
  onCommitAnswer,
}: {
  readonly node: SteeringViewNode
  readonly onCommitAnswer: (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ) => Promise<unknown>
}) => {
  const [answer, setAnswer] = useState<QuestionAnswer>(() => defaultAnswerFor(node))
  const { refusal, saveStatus, showRefusal, dismiss, trackSave } = useRefusal()
  const onCommitAnswerTracked = (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<unknown> => trackSave(onCommitAnswer(anchor, opts))
  return (
    <>
      <RefusalBanner refusal={refusal} saveStatus={saveStatus} onDismiss={dismiss} />
      <Question
        node={node}
        answer={answer}
        onAnswerChange={setAnswer}
        onCommitAnswer={onCommitAnswerTracked}
        onRefusal={showRefusal}
      />
    </>
  )
}

/**
 * Package 03's Task 1: a `setValue`-shaped write rejecting with a
 * `stale-token` refusal (`moved: "sha"`) must show `Refusal.tsx`'s own named
 * sentence for it — never silence, never `error.message`.
 */
export const ARejectedStaleTokenWriteShowsTheNamedReasonOnScreen: StoryObj<typeof Question> = {
  args: { node: questionNode() },
  render: (args) => (
    <RefusalHarness
      node={args.node}
      onCommitAnswer={() =>
        Promise.reject({ data: { writeRefusal: { reason: "stale-token", moved: "sha" } } })
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("option-radio-0"))
    await waitFor(() =>
      expect(canvas.getByTestId("refusal-message")).toHaveTextContent(
        "Someone else committed a change underneath you",
      ),
    )
  },
}

/**
 * Spec feedback on package 03: dismissing a refusal must not leave the SAME
 * live region announcing "Saved" for the write that was just refused.
 * `trackSave` used to settle `saveStatus` to `"saved"` in a `.finally`
 * regardless of outcome, and `dismiss` only ever cleared `refusal` — so once
 * the human dismissed (a realistic tap within `SAVED_LINGER_MS`), the banner
 * fell through to `saveStatus`'s own `"saved"` branch and reported the write
 * landed when it did not. `trackSave` now only ever settles to `"saved"` on
 * a genuine resolve.
 */
export const DismissingARefusalNeverThenReportsSaved: StoryObj<typeof Question> = {
  args: { node: questionNode() },
  render: (args) => (
    <RefusalHarness
      node={args.node}
      onCommitAnswer={() =>
        Promise.reject({ data: { writeRefusal: { reason: "stale-token", moved: "sha" } } })
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("option-radio-0"))
    await waitFor(() =>
      expect(canvas.getByTestId("refusal-message")).toHaveTextContent(
        "Someone else committed a change underneath you",
      ),
    )
    await fireEvent.click(canvas.getByTestId("refusal-dismiss"))
    // The banner (the SAME live region) must disappear entirely, not fall
    // through to `saveStatus`'s own "Saved" branch — `RefusalBanner` renders
    // nothing when there's neither a refusal nor an in-flight/settled save,
    // so its continued absence IS the assertion that "Saved" never shows for
    // the write that was just refused.
    await waitFor(() => expect(canvas.queryByTestId("refusal-banner")).not.toBeInTheDocument())
  },
}

/**
 * `onCommitAnswer` recorded into the DOM (like `CommitCallRecordingHarness`)
 * AND the refusal banner (like `RefusalHarness`), combined — needed to prove
 * BOTH that the refusal shows AND that a retry with the SAME text actually
 * fires a second write, not a silent no-op. Rejects only the write at
 * `rejectCallIndex` (0 by default: the first).
 */
const RefusalRetryHarness = ({ node }: { readonly node: SteeringViewNode }) => {
  const [answer, setAnswer] = useState<QuestionAnswer>(() => defaultAnswerFor(node))
  const { refusal, saveStatus, showRefusal, dismiss } = useRefusal()
  const [calls, setCalls] = useState<
    ReadonlyArray<{
      readonly anchor: SteeringAnchor
      readonly opts: { readonly checked?: boolean; readonly text?: string }
    }>
  >([])
  const onCommitAnswer = (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<unknown> => {
    const callIndex = calls.length
    setCalls((prev) => [...prev, { anchor, opts }])
    return callIndex === 0
      ? Promise.reject({ data: { writeRefusal: { reason: "stale-token", moved: "sha" } } })
      : Promise.resolve({ ok: true })
  }
  return (
    <>
      <RefusalBanner refusal={refusal} saveStatus={saveStatus} onDismiss={dismiss} />
      <div data-testid="commit-calls">{JSON.stringify(calls)}</div>
      <Question
        node={node}
        answer={answer}
        onAnswerChange={setAnswer}
        onCommitAnswer={onCommitAnswer}
        onRefusal={showRefusal}
      />
    </>
  )
}

/**
 * Spec feedback on package 03: a refused free-text write must not poison its
 * own retry. Type "hello", blur — `setValue` rejects with `stale-token`, the
 * banner shows. Without rolling `lastCommittedFreeTextRef` back to its
 * pre-write value (empty, here), Task 6's changed-since-last-commit guard
 * would then compare a RETYPED "hello" against the never-written "hello" the
 * ref still (wrongly) held, see no change, and silently skip the write —
 * the exact silent divergence Task 6 exists to eliminate, just moved one
 * refusal downstream. Retyping "hello" and blurring again must fire a
 * SECOND write.
 */
export const ARefusedFreeTextWriteRetriesRatherThanSilentlySkipping: StoryObj<typeof Question> = {
  args: { node: questionNode() },
  render: (args) => <RefusalRetryHarness node={args.node} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByTestId("free-text-input")
    await fireEvent.change(textarea, { target: { value: "hello" } })
    await fireEvent.blur(textarea)
    await waitFor(() =>
      expect(canvas.getByTestId("refusal-message")).toHaveTextContent(
        "Someone else committed a change underneath you",
      ),
    )
    await waitFor(() => expect(readCommitCalls(canvas)).toHaveLength(1))

    // Retype the SAME text and blur again — must fire a second write, not
    // silently no-op against a "last committed" value that was never
    // actually written.
    await fireEvent.change(textarea, { target: { value: "" } })
    await fireEvent.change(textarea, { target: { value: "hello" } })
    await fireEvent.blur(textarea)
    await waitFor(() => expect(readCommitCalls(canvas)).toHaveLength(2))
  },
}
