import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import type { SteeringView, SteeringViewNode } from "../../SteeringFormat.js"
import { TrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { Plan, PlanView } from "./Plan.js"

const meta: Meta<typeof PlanView> = {
  component: PlanView,
}

export default meta

type Story = StoryObj<typeof PlanView>

/** The real `Plan` container's args shared by every "real container" story below — one file/mode pair, reused rather than repeated at each call site. */
const REAL_PLAN_ARGS = { filePath: ".gtd/PLAN.md", mode: "qa" }

/** Opens paragraph 0's note seam and types `text` into the sheet — the setup every "real container" story below shares before diverging into Save vs Save & Done. */
const openNoteSeamAndType = async (
  canvas: ReturnType<typeof within>,
  text: string,
): Promise<void> => {
  await waitFor(() => expect(canvas.getByTestId("note-seam-0")).toBeInTheDocument())
  await fireEvent.click(canvas.getByTestId("note-seam-0"))
  await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), { target: { value: text } })
}

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

/** A plan's own lead-prose node — `OpenQuestions.ts#questionsView` now prepends these to a document that ALSO has questions, so "Read the plan" has real content behind it (requirement 4/T5). */
const planNode = (line: number, title: string): SteeringViewNode => ({
  title,
  anchor: { kind: "paragraph", line },
})

/**
 * The "Read the plan" row must have an actual plan to read even when the
 * document ALSO has open/answered questions — before this fix, a `qa`
 * document's lead prose was dropped entirely from `view.nodes`, so the row
 * confirmed nothing.
 */
export const PlanProseRendersAlongsideQuestions: Story = {
  args: {
    contentHash: "qa-sample-hash",
    isLoading: false,
    view: {
      nodes: [planNode(0, "This plan adds a thing."), openQuestion(0, "Which option?")],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("This plan adds a thing.")).toBeInTheDocument()
    await expect(canvas.getByText("Open Questions")).toBeInTheDocument()
    await expect(canvas.getByTestId("question-card-0")).toBeInTheDocument()
  },
}

export const AlreadyAnsweredSectionRendersBelowOpenQuestions: Story = {
  args: {
    contentHash: "qa-sample-hash",
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
    contentHash: "qa-sample-hash",
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

/** The mirror of the story above — a document with open questions and NONE answered must not show an empty "Already answered" heading either. */
export const DocumentWithNoAnsweredQuestionsRendersNoEmptyHeading: Story = {
  args: {
    contentHash: "qa-sample-hash",
    isLoading: false,
    view: {
      nodes: [openQuestion(0, "Open one")],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("Open Questions")).toBeInTheDocument()
    await expect(canvas.queryByText("Already answered")).not.toBeInTheDocument()
  },
}

/**
 * An answered question's own `view` node carries no options at all
 * (`OpenQuestions.ts`'s answered section never has checkboxes to answer),
 * so drilling into one would render `Question.tsx` with nothing to show and
 * a status line that CONTRADICTS the section the card came from
 * ("unanswered" on a card that's already resolved). The card renders as an
 * inert summary row instead — no button semantics, no drill-in.
 */
/**
 * `deck-next` past the LAST open question must exit the deck (returning to
 * the list) rather than advancing into an answered question — `Deck.tsx`
 * navigates its own item array directly, bypassing `QuestionCard`'s
 * per-card `onOpen` guard entirely, so the deck's own item list must never
 * include an answered node in the first place (`openQuestionNodesOf`).
 * Reproduces the reviewer's own repro: one open, one answered, tap the open
 * card, then tap `deck-next`.
 */
export const DeckNavigationPastTheLastOpenQuestionNeverReachesAnAnsweredOne: Story = {
  args: {
    contentHash: "qa-sample-hash",
    isLoading: false,
    view: {
      nodes: [openQuestion(0, "Open one"), answeredQuestion(1, "Answered one")],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("question-card-0"))
    await expect(canvas.getByTestId("question-screen")).toBeInTheDocument()
    await expect(canvas.getByTestId("question-screen")).toHaveTextContent("Open one")

    await fireEvent.click(canvas.getByTestId("deck-next"))

    // Back to the list — never an answered question rendering "unanswered".
    await expect(canvas.queryByTestId("question-screen")).not.toBeInTheDocument()
    await expect(canvas.getByTestId("plan-screen")).toBeInTheDocument()
  },
}

/**
 * An answer must survive `deck-next`/`deck-prev` navigation — `Deck.tsx`
 * remounts a fresh `Question` per index, so before this fix the answer
 * lived only in `Question`'s own internal (now-removed) `useState` and was
 * silently discarded the moment the deck paged away and back.
 */
export const AnAnswerSurvivesPagingNextThenBackThroughTheDeck: Story = {
  args: {
    contentHash: "qa-sample-hash",
    isLoading: false,
    view: {
      nodes: [openQuestion(0, "First?"), openQuestion(1, "Second?")],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("question-card-0"))
    await expect(canvas.getByTestId("question-screen")).toHaveTextContent("First?")
    await fireEvent.click(canvas.getByTestId("option-radio-0"))
    await expect(canvas.getByTestId("option-radio-0")).toBeChecked()
    await expect(canvas.getByTestId("question-status")).toHaveTextContent("answered")

    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByTestId("question-screen")).toHaveTextContent("Second?")
    await expect(canvas.getByTestId("option-radio-0")).not.toBeChecked()

    await fireEvent.click(canvas.getByTestId("deck-prev"))
    await expect(canvas.getByTestId("question-screen")).toHaveTextContent("First?")
    await expect(canvas.getByTestId("option-radio-0")).toBeChecked()
    await expect(canvas.getByTestId("question-status")).toHaveTextContent("answered")
  },
}

export const AnAnsweredCardIsNotDrillable: Story = {
  args: {
    contentHash: "qa-sample-hash",
    isLoading: false,
    view: {
      nodes: [answeredQuestion(0, "Answered one")],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByTestId("question-card-0")
    expect(card.tagName).not.toBe("BUTTON")
    await fireEvent.click(card)
    await expect(canvas.queryByTestId("question-screen")).not.toBeInTheDocument()
    await expect(canvas.getByTestId("plan-screen")).toBeInTheDocument()
  },
}

/** A prose-only `view` — every node `paragraph`-anchored at its real, server-computed start line (`OpenQuestions.ts#paragraphNodesOf`), no `status` at all — the exact shape `PlanBody` uses to decide "no question-shaped nodes, render prose". */
const paragraphNode = (line: number, title: string, note?: string): SteeringViewNode => ({
  title,
  anchor: { kind: "paragraph", line },
  ...(note !== undefined ? { note } : {}),
})

export const ProseOnlyFileRendersParagraphsAndNoQuestionList: Story = {
  args: {
    contentHash: "prose-hash-1",
    isLoading: false,
    view: {
      nodes: [
        paragraphNode(0, "First paragraph of the plan."),
        paragraphNode(2, "Second paragraph with more detail."),
      ],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("First paragraph of the plan.")).toBeInTheDocument()
    await expect(canvas.getByText("Second paragraph with more detail.")).toBeInTheDocument()
    // A REAL, visible affordance — legible label text and a non-zero touch
    // target — not a 0-visible-pixels strip a test could only ever find by
    // testid.
    const seam = canvas.getByTestId("note-seam-0")
    await expect(seam).toHaveTextContent("Add note")
    expect(seam.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    // "spans the full width" — geometrically, not just `style.width`: the
    // seam's own box must equal the width of the paragraph it belongs to
    // (their shared container), never a fraction of it.
    const paragraph = canvas.getByText("First paragraph of the plan.")
    const container = paragraph.parentElement!
    expect(seam.getBoundingClientRect().width).toBe(container.getBoundingClientRect().width)
    // "sits below its paragraph" — geometrically: the seam's own top edge
    // is at or after the paragraph's own bottom edge, never above/overlapping
    // it (which a mutant moving the seam ABOVE the `<p>` in the JSX would
    // otherwise still pass a testid-only or text-only assertion).
    expect(seam.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      paragraph.getBoundingClientRect().bottom,
    )
    await expect(canvas.getByTestId("note-seam-1")).toHaveTextContent("Add note")
    await expect(canvas.queryByText("Open Questions")).not.toBeInTheDocument()
    await expect(canvas.queryByTestId("question-card-0")).not.toBeInTheDocument()
  },
}

export const ParagraphNoteSeamOpensTheNoteSheetOnTheRealAnchor: Story = {
  args: {
    contentHash: "prose-hash-2",
    isLoading: false,
    view: { nodes: [paragraphNode(0, "A paragraph worth commenting on.")] } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("note-seam-0"))
    await expect(canvas.getByTestId("note-sheet")).toBeInTheDocument()
    await expect(canvas.getByText("Note on this paragraph")).toBeInTheDocument()
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "worth flagging" },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await expect(canvas.queryByTestId("note-sheet")).not.toBeInTheDocument()
    await expect(canvas.getByTestId("paragraph-note-0")).toHaveTextContent("worth flagging")
  },
}

export const ParagraphAlreadyCarryingANoteOffersEditingNotASecondNote: Story = {
  args: {
    contentHash: "prose-hash-3",
    isLoading: false,
    view: {
      nodes: [paragraphNode(0, "A paragraph with a note attached.", "the existing comment")],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("paragraph-note-0")).toHaveTextContent("the existing comment")
    await expect(canvas.getByTestId("note-seam-0")).toHaveTextContent("Edit note")
    await fireEvent.click(canvas.getByTestId("note-seam-0"))
    await expect(canvas.getByTestId("note-sheet-textarea")).toHaveValue("the existing comment")
  },
}

/** Toggles `PlanView`'s `contentHash` between two versions of "the same file" on a button click — so a story can prove the read-the-plan confirmation (keyed on `contentHash`) clears the moment the file is REWRITTEN, without needing Storybook's own arg-update machinery. */
const RewritablePlan = () => {
  const [rewritten, setRewritten] = useState(false)
  const contentHash = rewritten ? "version-two-hash" : "version-one-hash"
  return (
    <div>
      <button type="button" data-testid="rewrite-file" onClick={() => setRewritten(true)}>
        Rewrite file
      </button>
      <PlanView
        contentHash={contentHash}
        isLoading={false}
        view={{ nodes: [] } satisfies SteeringView}
      />
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

/** A `useState`-backed recorder — see `Review.stories.tsx#WriteCallRecorder`'s identical doc comment for why a plain mutated array wouldn't trigger the re-render this needs. */
const PlanWriteCallRecorder = ({
  args,
  onRegisterWriteNote,
}: {
  readonly args: { readonly filePath: string; readonly mode: string }
  readonly onRegisterWriteNote: (record: (input: unknown) => void) => void
}) => {
  const [calls, setCalls] = useState<readonly unknown[]>([])
  onRegisterWriteNote((input) => setCalls((prev) => [...prev, input]))
  return (
    <>
      <div data-testid="write-calls">{JSON.stringify(calls)}</div>
      <Plan {...args} />
    </>
  )
}

/** Proves the REAL `Plan` container round-trips through `readSteeringFile` (never a bare `content` prop) and write-throughs a saved paragraph note via `writeNote`, using the exact tokens the read returned. */
export const RealContainerWriteThroughsAParagraphNoteViaWriteNote: StoryObj<typeof Plan> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: "A paragraph worth commenting on.",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: {
              nodes: [
                {
                  title: "A paragraph worth commenting on.",
                  anchor: { kind: "paragraph", line: 0 },
                },
              ],
            },
          }),
          writeNote: (input) => {
            record(input)
            return { ok: true }
          },
        }}
      >
        <PlanWriteCallRecorder args={args} onRegisterWriteNote={(fn) => (record = fn)} />
      </TrpcTestProvider>
    )
  },
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openNoteSeamAndType(canvas, "worth flagging")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() =>
      expect(canvas.getByTestId("write-calls")).toHaveTextContent("worth flagging"),
    )
    await expect(canvas.getByTestId("write-calls")).toHaveTextContent(
      JSON.stringify({
        filePath: ".gtd/PLAN.md",
        expectedHeadSha: "abc123",
        expectedContentHash: "deadbeef",
        mode: "qa",
        anchor: { kind: "paragraph", line: 0 },
        text: "worth flagging",
      }).slice(1, -1),
    )
  },
}

/** A refused write must revert the optimistic `noteOverrides` entry — see `Review.stories.tsx#RealContainerRevertsTheOptimisticNoteOnARefusedWrite`'s identical doc comment. */
export const RealContainerRevertsTheOptimisticNoteOnARefusedWrite: StoryObj<typeof Plan> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: "A paragraph worth commenting on.",
          headSha: "abc123",
          contentHash: "deadbeef",
          view: {
            nodes: [
              { title: "A paragraph worth commenting on.", anchor: { kind: "paragraph", line: 0 } },
            ],
          },
        }),
        writeNote: () => {
          throw new Error("stale token")
        },
      }}
    >
      <Plan {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openNoteSeamAndType(canvas, "This never actually lands.")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() => expect(canvas.queryByTestId("paragraph-note-0")).not.toBeInTheDocument())
    await expect(canvas.getByTestId("note-seam-0")).toHaveTextContent("Add note")
  },
}

/** A `useState`-backed recorder for the `done` mutation's input — mirrors `PlanWriteCallRecorder`'s identical reasoning. */
const PlanDoneCallRecorder = ({
  args,
  onRegisterDone,
}: {
  readonly args: { readonly filePath: string; readonly mode: string }
  readonly onRegisterDone: (record: (input: unknown) => void) => void
}) => {
  const [calls, setCalls] = useState<readonly unknown[]>([])
  onRegisterDone((input) => setCalls((prev) => [...prev, input]))
  return (
    <>
      <div data-testid="done-calls">{JSON.stringify(calls)}</div>
      <Plan {...args} />
    </>
  )
}

/** Proves the REAL `Plan` container wires "Save & Done" to `trpc.done` (never a second, disjoint `writeNote` call) using the exact same tokens — `done` writes and hands off server-side; this client renders no further round trip after it resolves. */
export const RealContainerSaveAndDoneCallsTrpcDone: StoryObj<typeof Plan> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: "A paragraph worth commenting on.",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: {
              nodes: [
                {
                  title: "A paragraph worth commenting on.",
                  anchor: { kind: "paragraph", line: 0 },
                },
              ],
            },
          }),
          done: (input) => {
            record(input)
            return { ok: true }
          },
          writeNote: () => {
            throw new Error("writeNote must never be called by Save & Done")
          },
        }}
      >
        <PlanDoneCallRecorder args={args} onRegisterDone={(fn) => (record = fn)} />
      </TrpcTestProvider>
    )
  },
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openNoteSeamAndType(canvas, "handing back now")
    await fireEvent.click(canvas.getByTestId("note-sheet-done"))
    await waitFor(() =>
      expect(canvas.getByTestId("done-calls")).toHaveTextContent("handing back now"),
    )
    await expect(canvas.getByTestId("done-calls")).toHaveTextContent(
      JSON.stringify({
        filePath: ".gtd/PLAN.md",
        expectedHeadSha: "abc123",
        expectedContentHash: "deadbeef",
        mode: "qa",
        anchor: { kind: "paragraph", line: 0 },
        text: "handing back now",
      }).slice(1, -1),
    )
  },
}

/** A `useState`-backed recorder for the `setValue` mutation's own input — mirrors `PlanWriteCallRecorder`'s identical reasoning. */
const PlanSetValueCallRecorder = ({
  args,
  onRegisterSetValue,
}: {
  readonly args: { readonly filePath: string; readonly mode: string }
  readonly onRegisterSetValue: (record: (input: unknown) => void) => void
}) => {
  const [calls, setCalls] = useState<readonly unknown[]>([])
  onRegisterSetValue((input) => setCalls((prev) => [...prev, input]))
  return (
    <>
      <div data-testid="set-value-calls">{JSON.stringify(calls)}</div>
      <Plan {...args} />
    </>
  )
}

/** Proves the REAL `Plan` container write-throughs picking a radio option via `trpc.setValue`, using the exact tokens `readSteeringFile` returned — closes the gap the spec review flagged (T4's "write question answers through to disk"). */
export const RealContainerWriteThroughsAnAnswerViaSetValue: StoryObj<typeof Plan> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: "Sample plan.\n\n## Open Questions\n\n### Which option?\n",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: { nodes: [openQuestion(0, "Which option?")] },
          }),
          setValue: (input) => {
            record(input)
            return { ok: true }
          },
        }}
      >
        <PlanSetValueCallRecorder args={args} onRegisterSetValue={(fn) => (record = fn)} />
      </TrpcTestProvider>
    )
  },
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("question-card-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("question-card-0"))
    await fireEvent.click(canvas.getByTestId("option-radio-0"))
    await waitFor(() =>
      expect(canvas.getByTestId("set-value-calls")).toHaveTextContent('"checked":true'),
    )
    await expect(canvas.getByTestId("set-value-calls")).toHaveTextContent(
      JSON.stringify({
        filePath: ".gtd/PLAN.md",
        expectedHeadSha: "abc123",
        expectedContentHash: "deadbeef",
        mode: "qa",
        anchor: { kind: "option", questionIndex: 0, index: 0 },
        checked: true,
      }).slice(1, -1),
    )
  },
}

/**
 * A refused `setValue` write must revert the optimistic radio selection —
 * otherwise the question reads "answered" forever even though the file was
 * never actually touched, which is exactly the requirement's own "the
 * human's answers vanish" failure mode, just delayed rather than prevented.
 * See `Question.tsx#setSelected`'s identical revert-on-rejection.
 */
export const RealContainerRevertsTheOptimisticAnswerOnARefusedWrite: StoryObj<typeof Plan> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: "Sample plan.\n\n## Open Questions\n\n### Which option?\n",
          headSha: "abc123",
          contentHash: "deadbeef",
          view: { nodes: [openQuestion(0, "Which option?")] },
        }),
        setValue: () => {
          throw new Error("stale token")
        },
      }}
    >
      <Plan {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("question-card-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("question-card-0"))
    await fireEvent.click(canvas.getByTestId("option-radio-0"))
    // Immediately after the tap, the optimistic radio shows checked (before
    // the refusal resolves) — then the refusal reverts it.
    await waitFor(() => expect(canvas.getByTestId("option-radio-0")).not.toBeChecked())
    await expect(canvas.getByTestId("question-status")).toHaveTextContent("unanswered")
  },
}

/**
 * The exact defect the spec review caught: focusing the free-text slot's
 * textarea and blurring it again WITHOUT TYPING ANYTHING — a one-finger
 * mis-tap on a phone, the target device — must send NO `setValue` call at
 * all. Before `Question.tsx`'s `commitFreeText` guarded on
 * `normalizeAnswerText(freeText).length === 0` and its `onFocus` stopped
 * writing through, this sequence fired TWO real writes: one on focus
 * (unticking whatever the human had already picked, via radio semantics on
 * the free-text anchor) and one on blur (blanking the free-text option's own
 * label to `""`, unrecoverable) — silently destroying a real answer with no
 * user-visible error.
 */
export const RealContainerFocusingAndBlurringFreeTextWithNoTypingSendsNoWrite: StoryObj<
  typeof Plan
> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: "Sample plan.\n\n## Open Questions\n\n### Which option?\n",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: { nodes: [openQuestion(0, "Which option?")] },
          }),
          setValue: (input) => {
            record(input)
            return { ok: true }
          },
        }}
      >
        <PlanSetValueCallRecorder args={args} onRegisterSetValue={(fn) => (record = fn)} />
      </TrpcTestProvider>
    )
  },
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("question-card-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("question-card-0"))
    const textarea = canvas.getByTestId("free-text-input")
    await fireEvent.focus(textarea)
    await fireEvent.blur(textarea)
    // No `waitFor` here on purpose — a write-through, if one fired, would
    // already have resolved synchronously against this mock resolver; a
    // fixed assertion right after the blur is what actually catches a
    // regression, where `waitFor` would just wait out its own timeout
    // finding nothing, indistinguishable from success.
    await expect(canvas.getByTestId("set-value-calls")).toHaveTextContent("[]")
    await expect(canvas.getByTestId("option-radio-1")).not.toBeChecked()
  },
}

/** After `done` resolves, the client renders the terminal "handed back" panel — no further server round trip, no way back to any list. Mirrors `Review.stories.tsx`'s identical story. */
export const RealContainerRendersHandedBackPanelAfterDone: StoryObj<typeof Plan> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: "A paragraph worth commenting on.",
          headSha: "abc123",
          contentHash: "deadbeef",
          view: {
            nodes: [
              { title: "A paragraph worth commenting on.", anchor: { kind: "paragraph", line: 0 } },
            ],
          },
        }),
        done: () => ({ ok: true }),
      }}
    >
      <Plan {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openNoteSeamAndType(canvas, "handing back now")
    await fireEvent.click(canvas.getByTestId("note-sheet-done"))
    await waitFor(() => expect(canvas.getByTestId("handed-back-panel")).toBeInTheDocument())
    await expect(canvas.queryByTestId("plan-screen")).not.toBeInTheDocument()
  },
}

/**
 * "An answer survives a page reload" (T4's own last acceptance bullet): a
 * FRESH mount of the real `Plan` container — never `PlanView` driven by
 * hand-built `answer` state — against a `readSteeringFile` resolver whose
 * option is already `checked: true`, the exact byte state a real `setValue`
 * write leaves on disk. No interaction happens before the assertion, so
 * `Question.tsx`'s local `answers`/`QuestionAnswer` map is still empty —
 * `defaultAnswerFor` seeding straight off `node.children`'s own `checked` is
 * what must be reading true here, not an optimistic override left by a prior
 * tap (which a real reload would have discarded along with the rest of the
 * page's JS state).
 */
export const RealContainerAnAnsweredOptionSurvivesAPageReload: StoryObj<typeof Plan> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: "Sample plan.\n\n## Open Questions\n\n### Which option?\n",
          headSha: "abc123",
          contentHash: "deadbeef",
          view: {
            nodes: [
              {
                title: "Which option?",
                status: "open",
                answered: true,
                anchor: { kind: "question", index: 0 },
                children: [
                  {
                    title: "Option A",
                    checked: true,
                    anchor: { kind: "option", questionIndex: 0, index: 0 },
                  },
                  {
                    title: "Option B",
                    checked: false,
                    anchor: { kind: "option", questionIndex: 0, index: 1 },
                  },
                ],
              },
            ],
          },
        }),
      }}
    >
      <Plan {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("question-card-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("question-card-0"))
    await expect(canvas.getByTestId("option-radio-0")).toBeChecked()
    await expect(canvas.getByTestId("question-status")).toHaveTextContent("answered")
  },
}
