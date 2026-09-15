import type { Meta, StoryObj } from "@storybook/react-vite"
import { useRef, useState } from "react"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import { FREE_TEXT_PLACEHOLDER } from "../../steering/index.js"
import type { SteeringAnchor, SteeringViewNode } from "../../steering/index.js"
import { RefusalBanner, useRefusal } from "../Refusal.js"
import { defaultAnswerFor, Question, type QuestionAnswer } from "./Question.js"

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

/** Spec feedback: `option-radio-<i>`'s native `<input type="radio">` sits inside a `<label>` sized to the 44px floor — the label (the actual tap target), not the raw input, is what's measured. */
export const OptionRadioRowMeetsThe44pxFloor: Story = {
  args: { node: questionNode() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByTestId("option-radio-0")
    const label = input.closest("label")
    expect(label).not.toBeNull()
    const rect = label!.getBoundingClientRect()
    expect(rect.height).toBeGreaterThanOrEqual(44)
    expect(rect.width).toBeGreaterThanOrEqual(44)
  },
}

/** Package 03's Task 10: `Question.stories.tsx`'s first commit-path coverage — type, tap the free-text Save button, exactly one `setValue`-shaped call carrying `checked` and `text` together, never two separate writes. Never taps the radio directly: `FreeTextOption`'s own focus/change handlers stay LOCAL-only (`selectLocally`), so the Save tap is the ONLY write this produces — a radio tap would fire its own separate `{checked:true}`-only write first. */
export const TypingThenTappingSaveCommitsOnceWithCheckedAndTextTogether: StoryObj<typeof Question> =
  {
    args: { node: questionNode() },
    render: (args) => <CommitCallRecordingHarness node={args.node} />,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      const textarea = canvas.getByTestId("free-text-input")
      await fireEvent.change(textarea, { target: { value: "the third way, typed" } })
      await fireEvent.click(canvas.getByTestId("free-text-save"))
      await waitFor(() => expect(readCommitCalls(canvas)).toHaveLength(1))
      expect(readCommitCalls(canvas)[0]?.opts).toEqual({
        checked: true,
        text: "the third way, typed",
      })
    },
  }

/**
 * Package 03's own requirement, verbatim: "Text left unsaved is discarded."
 * Typing into the free-text slot must never write through on its own — not
 * after any elapsed time (there is no debounce left to fire) and not on
 * blur (there is no blur handler left either) — ONLY a deliberate tap on
 * the free-text Save button ever calls `onCommitAnswer`.
 */
export const TypingWithoutTappingSaveFiresNoWriteEverNotAfterAnyElapsedTimeNorOnBlur: StoryObj<
  typeof Question
> = {
  args: { node: questionNode() },
  render: (args) => <CommitCallRecordingHarness node={args.node} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByTestId("free-text-input") as HTMLTextAreaElement
    await fireEvent.change(textarea, { target: { value: "typed but never saved" } })
    // A real wait past the OLD 800ms debounce window — proves no timer fires
    // a write, not just that none has fired yet.
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(canvas.getByTestId("commit-calls")).toHaveTextContent("[]")
    // A genuine focus transition, not a bare `fireEvent.blur` — this runs
    // against a real browser (vitest-browser), so only an element that was
    // actually focused first emits a real blur when focus moves away.
    ;(canvas.getByTestId("free-text-save") as HTMLButtonElement).focus()
    expect(canvas.getByTestId("commit-calls")).toHaveTextContent("[]")
  },
}

/**
 * The unmount half of the same requirement: typing then navigating away
 * (`Deck` remounting a fresh `Question`) with no Save tap must discard the
 * text — never flush it on the way out. `Question` no longer has an
 * unmount-commit effect at all.
 */
const UnmountDiscardsFreeTextHarness = ({ node }: { readonly node: SteeringViewNode }) => {
  const [answer, setAnswer] = useState<QuestionAnswer>(() => defaultAnswerFor(node))
  const [calls, setCalls] = useState<readonly CommitCall[]>([])
  const [mounted, setMounted] = useState(true)
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
      <button type="button" data-testid="unmount" onClick={() => setMounted(false)}>
        unmount
      </button>
      {mounted && (
        <Question
          node={node}
          answer={answer}
          onAnswerChange={setAnswer}
          onCommitAnswer={onCommitAnswer}
        />
      )}
    </>
  )
}

export const TypingThenUnmountingWithoutSavingFiresNoWrite: StoryObj<typeof Question> = {
  args: { node: questionNode() },
  render: (args) => <UnmountDiscardsFreeTextHarness node={args.node} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.change(canvas.getByTestId("free-text-input"), {
      target: { value: "typed then torn down" },
    })
    await fireEvent.click(canvas.getByTestId("unmount"))
    await waitFor(() => expect(canvas.queryByTestId("question-screen")).not.toBeInTheDocument())
    expect(canvas.getByTestId("commit-calls")).toHaveTextContent("[]")
  },
}

/**
 * Package 03's Task 6 (now Task 2): deleting a previously-written free-text
 * answer and tapping Save must write the ERASE (`checked: false, text: ""`),
 * not silently leave the stale text on disk while the UI shows empty. An
 * explicit tap always writes — there's no changed-since-last-commit guard
 * left to skip it.
 */
export const DeletingAPreviouslyWrittenAnswerAndSavingErasesIt: StoryObj<typeof Question> = {
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
    await fireEvent.click(canvas.getByTestId("free-text-save"))
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
 * slot and tapping Save fires a write that never resolves yet; a plain
 * option tick made WHILE it's still pending resolves immediately and must
 * still stand once the free-text write rejects — a whole-`answer` snapshot
 * revert would instead restore `previous.selected` too, discarding the radio
 * tick made in the interim.
 */
export const ARejectedFreeTextWriteLeavesALaterRadioTickStanding: StoryObj<typeof Question> = {
  args: { node: questionNode() },
  render: (args) => <FreeTextRevertScopeHarness node={args.node} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByTestId("free-text-input")
    await fireEvent.change(textarea, { target: { value: "typed while in flight" } })
    await fireEvent.click(canvas.getByTestId("free-text-save")) // write never resolves yet

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
 * `stale-token` refusal must show `Refusal.tsx`'s own named sentence for it
 * — never silence, never `error.message`. Task 01 pins this on
 * `moved: "content-hash"` specifically (a genuine concurrent edit, never
 * auto-retried by `staleRetry.ts#withStaleShaRetry`) — see this file's own
 * doc comment on why: `moved: "sha"` is covered end-to-end, including the
 * post-refusal recovery, by `Plan.stories.tsx`/`Review.stories.tsx`'s own
 * "recovers in place"/"Try again" stories instead.
 */
export const ARejectedStaleTokenWriteShowsTheNamedReasonOnScreen: StoryObj<typeof Question> = {
  args: { node: questionNode() },
  render: (args) => (
    <RefusalHarness
      node={args.node}
      onCommitAnswer={() =>
        Promise.reject({ data: { writeRefusal: { reason: "stale-token", moved: "content-hash" } } })
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("option-radio-0"))
    await waitFor(() =>
      expect(canvas.getByTestId("refusal-message")).toHaveTextContent(
        "The file's content changed underneath you",
      ),
    )
    expect(canvas.getByTestId("refusal-message")).not.toHaveTextContent("reload")
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
        Promise.reject({ data: { writeRefusal: { reason: "stale-token", moved: "content-hash" } } })
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("option-radio-0"))
    await waitFor(() =>
      expect(canvas.getByTestId("refusal-message")).toHaveTextContent(
        "The file's content changed underneath you",
      ),
    )
    expect(canvas.getByTestId("refusal-message")).not.toHaveTextContent("reload")
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
      ? Promise.reject({ data: { writeRefusal: { reason: "stale-token", moved: "content-hash" } } })
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
 * own retry. Type "hello", tap Save — `setValue` rejects with `stale-token`,
 * the banner shows. An explicit tap always writes (package 03 Task 3 removed
 * the changed-since-last-commit guard entirely), so tapping Save again with
 * the SAME retyped text must still fire a second write, not silently no-op.
 */
export const ARefusedFreeTextWriteRetriesRatherThanSilentlySkipping: StoryObj<typeof Question> = {
  args: { node: questionNode() },
  render: (args) => <RefusalRetryHarness node={args.node} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const textarea = canvas.getByTestId("free-text-input")
    await fireEvent.change(textarea, { target: { value: "hello" } })
    await fireEvent.click(canvas.getByTestId("free-text-save"))
    await waitFor(() =>
      expect(canvas.getByTestId("refusal-message")).toHaveTextContent(
        "The file's content changed underneath you",
      ),
    )
    expect(canvas.getByTestId("refusal-message")).not.toHaveTextContent("reload")
    await waitFor(() => expect(readCommitCalls(canvas)).toHaveLength(1))

    // Retype the SAME text and tap Save again — must fire a second write.
    await fireEvent.change(textarea, { target: { value: "" } })
    await fireEvent.change(textarea, { target: { value: "hello" } })
    await fireEvent.click(canvas.getByTestId("free-text-save"))
    await waitFor(() => expect(readCommitCalls(canvas)).toHaveLength(2))
  },
}
