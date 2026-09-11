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

/** A single-open-question plan's own `readSteeringFile` resolver — the shape every "real container" story that just needs one question to drill into shares (a document with one open "Which option?" question, no lead prose). */
const sampleOpenQuestionRead = () => ({
  ok: true,
  content: "Sample plan.\n\n## Open Questions\n\n### Which option?\n",
  headSha: "abc123",
  contentHash: "deadbeef",
  view: { nodes: [openQuestion(0, "Which option?")] },
})

/** Opens paragraph 0's note seam and types `text` into the sheet — the setup every "real container" story below shares before diverging into Save vs Save & Done. */
const openNoteSeamAndType = async (
  canvas: ReturnType<typeof within>,
  text: string,
): Promise<void> => {
  await waitFor(() => expect(canvas.getByTestId("note-seam-0")).toBeInTheDocument())
  await fireEvent.click(canvas.getByTestId("note-seam-0"))
  await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), { target: { value: text } })
}

/** Waits for the first open question's card, then taps it open — the setup every "real container" story that drills into the Q&A deck shares. */
const openFirstQuestionCard = async (canvas: ReturnType<typeof within>): Promise<void> => {
  await waitFor(() => expect(canvas.getByTestId("question-card-0")).toBeInTheDocument())
  await fireEvent.click(canvas.getByTestId("question-card-0"))
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

/**
 * package 02, T3: `QuestionCard` wires `accent` on the open path only — an
 * open card gets the left accent rule plus the `surface` background, an
 * answered one (the inert `opacity-[0.85]` row) does not. Asserted on
 * computed style alone, reading no heading text, so a regression that drops
 * `accent` from `Plan.tsx`'s open-question `<Card>` call — leaving
 * `Card.stories.tsx`'s own prop-level stories green — still fails here.
 */
export const OpenQuestionCardRendersTheAccentTreatmentAnsweredDoesNot: Story = {
  args: {
    contentHash: "qa-sample-hash",
    isLoading: false,
    view: {
      nodes: [openQuestion(0, "Open one"), answeredQuestion(1, "Answered one")],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const openCard = getComputedStyle(canvas.getByTestId("question-card-0"))
    const answeredCard = getComputedStyle(canvas.getByTestId("question-card-1"))
    expect(openCard.borderLeftWidth).toBe("4px")
    expect(openCard.backgroundColor).toBe("rgb(28, 28, 30)")
    expect(answeredCard.borderLeftWidth).not.toBe("4px")
  },
}

/**
 * package 02, T1/T4: a plan carrying a heading, prose before the questions
 * section, one open question, one answered question and a trailing
 * paragraph — the open question renders ABOVE the prose (it's the task),
 * the answered one stays BELOW the prose (it's history), and the trailing
 * paragraph — which sits AFTER both question sections in document order —
 * renders after the preceding prose within the single prose block, never
 * hoisted before it.
 */
export const OpenQuestionRendersAboveProseAnsweredBelowTrailingParagraphInOrder: Story = {
  args: {
    contentHash: "layout-order-hash",
    isLoading: false,
    view: {
      nodes: [
        {
          title: "A heading",
          anchor: { kind: "paragraph", line: 0 },
          block: { kind: "heading", depth: 2 },
        },
        planNode(2, "Prose before the questions section."),
        openQuestion(0, "Which option?"),
        answeredQuestion(1, "Already settled"),
        planNode(10, "A trailing paragraph after both sections."),
      ],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const openHeading = canvas.getByText("Open Questions")
    const prose = canvas.getByText("Prose before the questions section.")
    const answeredHeading = canvas.getByText("Already answered")
    const trailing = canvas.getByText("A trailing paragraph after both sections.")

    // Open question section above the prose.
    expect(
      openHeading.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // Answered section below the prose.
    expect(
      prose.compareDocumentPosition(answeredHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // The trailing paragraph stays after the preceding prose, not hoisted before it.
    expect(prose.compareDocumentPosition(trailing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

/**
 * Package 03 Task 3's own inversion, verbatim: an UNSAVED free-text draft
 * dies with the component — `selected` survives paging (the story above),
 * but a typed-and-never-saved free-text box comes back EMPTY, because the
 * draft lives in `Question`'s own local `useState`, seeded fresh from
 * `defaultAnswerFor` every time `Deck` remounts a new `Question` for this
 * index.
 */
export const AnUnsavedFreeTextDraftDoesNotSurvivePagingAwayAndBack: Story = {
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
    await fireEvent.change(canvas.getByTestId("free-text-input"), {
      target: { value: "typed but never saved" },
    })
    await expect(canvas.getByTestId("free-text-input")).toHaveValue("typed but never saved")

    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByTestId("question-screen")).toHaveTextContent("Second?")

    await fireEvent.click(canvas.getByTestId("deck-prev"))
    await expect(canvas.getByTestId("question-screen")).toHaveTextContent("First?")
    await expect(canvas.getByTestId("free-text-input")).toHaveValue("")
  },
}

/** Package 03 Task 3: tapping the free-text Save button does not navigate — ending a view is Done's job, not Save's. */
export const TappingFreeTextSaveStaysOnTheQuestionScreen: Story = {
  args: {
    contentHash: "qa-sample-hash",
    isLoading: false,
    view: {
      nodes: [openQuestion(0, "First?")],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("question-card-0"))
    await expect(canvas.getByTestId("question-screen")).toHaveTextContent("First?")
    await fireEvent.change(canvas.getByTestId("free-text-input"), {
      target: { value: "an answer worth saving" },
    })
    await fireEvent.click(canvas.getByTestId("free-text-save"))
    await expect(canvas.getByTestId("question-screen")).toBeInTheDocument()
    await expect(canvas.getByTestId("question-screen")).toHaveTextContent("First?")
  },
}

/**
 * package 02, T2: the card-index invariant holds through the layout move —
 * a card's start index must stay its position in the SAME open-question
 * list `Deck` is fed (`openQuestionNodesOf`), regardless of where an
 * answered question sorts among the questions or where the section itself
 * now renders on screen. Tapping the LAST open card on a plan that also
 * carries an answered question must open the deck on THAT question, not
 * another — and the deck's own progress indicator counts only the two open
 * questions, never the answered one sitting alongside them.
 */
export const TappingTheLastOpenQuestionCardOpensTheDeckOnThatQuestion: Story = {
  args: {
    contentHash: "qa-sample-hash",
    isLoading: false,
    view: {
      nodes: [
        openQuestion(0, "First open"),
        answeredQuestion(1, "Settled"),
        openQuestion(2, "Second open"),
      ],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("question-card-2"))
    await expect(canvas.getByTestId("question-screen")).toHaveTextContent("Second open")
    // Only the two open questions counted — never the answered one.
    await expect(canvas.getByTestId("deck-progress")).toHaveTextContent("2 / 2")
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

/** A prose-only `view` — every node `paragraph`-anchored at its real, server-computed start line (`OpenQuestions.ts#blockNodesOf`), no `status` at all — the exact shape `PlanBody` uses to decide "no question-shaped nodes, render prose". */
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

/**
 * package 02, T4's own criterion: a heading, a nested list, a fenced code
 * block and a paragraph AFTER the questions section, all on screen — proving
 * `ProseBlock`'s switch renders every `block.kind`, not just `paragraph`.
 */
export const PlanRendersEveryBlockKindWithStructureIntact: Story = {
  args: {
    contentHash: "structured-plan-hash",
    isLoading: false,
    view: {
      nodes: [
        {
          title: "A heading",
          anchor: { kind: "paragraph", line: 0 },
          block: { kind: "heading", depth: 3 },
        },
        {
          title: "Top item Nested item",
          anchor: { kind: "paragraph", line: 2 },
          block: {
            kind: "list",
            ordered: false,
            items: [{ text: "Top item", items: [{ text: "Nested item" }] }],
          },
        },
        {
          title: "const x = 1",
          anchor: { kind: "paragraph", line: 6 },
          block: { kind: "code", language: "ts", text: "  const x = 1\nconst y = 2" },
        },
        openQuestion(0, "Which option?"),
        planNode(20, "Paragraph after the questions section."),
      ],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByText("A heading")
    expect(heading.tagName).toBe("H3")
    await expect(canvas.getByText("Top item")).toBeInTheDocument()
    await expect(canvas.getByText("Nested item")).toBeInTheDocument()
    const code = canvas.getByText((_, element) => element?.tagName === "CODE")
    expect(code.textContent).toBe("  const x = 1\nconst y = 2")
    await expect(canvas.getByText("Paragraph after the questions section.")).toBeInTheDocument()
  },
}

/** A note attaches to a heading and lands on that heading's own line — its note seam behaves exactly like a paragraph's. */
/**
 * A note attaches to a heading and lands on that heading's own ANCHOR LINE —
 * asserted on the real `writeNote` call's `anchor`, the way
 * `RealContainerWriteThroughsAParagraphNoteViaWriteNote` does, never on the
 * `paragraph-note-N`/`note-seam-N` testid alone: those are keyed by ARRAY
 * index, so a heading sitting at array index 1 but a stale/wrong anchor line
 * would still render under the SAME testid and pass a testid-only assertion.
 * The heading sits behind a preceding paragraph and at a non-zero line
 * (`line: 4`, distinct from both its own array index `1` and from `0`), so a
 * regression that anchors the note at the array index or at line 0 instead of
 * the heading's real line fails this test.
 */
export const NoteAttachesToAHeadingOnItsOwnLine: StoryObj<typeof Plan> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: "Intro paragraph.\n\n\n\n## A heading\n",
            headSha: "abc123",
            contentHash: "heading-note-hash",
            view: {
              nodes: [
                { title: "Intro paragraph.", anchor: { kind: "paragraph", line: 0 } },
                {
                  title: "A heading",
                  anchor: { kind: "paragraph", line: 4 },
                  block: { kind: "heading", depth: 2 },
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
    await waitFor(() => expect(canvas.getByTestId("note-seam-1")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("note-seam-1"))
    await expect(canvas.getByTestId("note-sheet")).toBeInTheDocument()
    await expect(canvas.getByText("Note on this block")).toBeInTheDocument()
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "note on the heading" },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() =>
      expect(canvas.getByTestId("write-calls")).toHaveTextContent("note on the heading"),
    )
    // The real anchor sent to `writeNote` is the heading's own LINE (4) —
    // neither its array index (1) nor the preceding paragraph's line (0).
    await expect(canvas.getByTestId("write-calls")).toHaveTextContent(
      JSON.stringify({ anchor: { kind: "paragraph", line: 4 } }).slice(1, -1),
    )
    await expect(canvas.getByTestId("paragraph-note-1")).toHaveTextContent("note on the heading")
  },
}

/** Every block kind except `code` shows a note seam; the code block shows neither a seam nor an inline note row (T3/T4's own reason: a marker there would corrupt the fence). */
export const CodeBlockShowsNoNoteSeamEveryOtherKindDoes: Story = {
  args: {
    contentHash: "code-seam-hash",
    isLoading: false,
    view: {
      nodes: [
        {
          title: "A heading",
          anchor: { kind: "paragraph", line: 0 },
          block: { kind: "heading", depth: 2 },
        },
        {
          title: "code",
          anchor: { kind: "paragraph", line: 2 },
          block: { kind: "code", text: "code" },
          note: "should never show",
        },
        paragraphNode(5, "A trailing paragraph."),
      ],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("note-seam-0")).toBeInTheDocument()
    await expect(canvas.queryByTestId("note-seam-1")).not.toBeInTheDocument()
    await expect(canvas.queryByTestId("paragraph-note-1")).not.toBeInTheDocument()
    await expect(canvas.getByTestId("note-seam-2")).toBeInTheDocument()
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
    await expect(canvas.getByText("Note on this block")).toBeInTheDocument()
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

/** Task 01's own trigger: a linked worktree where `liveHeadSha` can't resolve — `readSteeringFile` refuses `head-unresolved` rather than handing out an empty token. The real `Plan` container renders the named sentence, with no retry control anywhere on screen. */
export const RealContainerRendersHeadUnresolvedWithNoRetry: StoryObj<typeof Plan> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => {
          throw {
            error: {
              message: "gtd ui: read refused (head-unresolved)",
              code: -32600,
              data: { code: "BAD_REQUEST", readRefusal: { reason: "head-unresolved" } },
            },
          }
        },
      }}
    >
      <Plan {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByText(/Can't read this repository's current commit/)).toBeInTheDocument(),
    )
    expect(canvas.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument()
  },
}

/** A `file-vanished` read refusal renders its own named sentence — never the generic "Could not load the plan." fallback a plain fetch failure would show. */
export const RealContainerRendersFileVanishedByName: StoryObj<typeof Plan> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => {
          throw {
            error: {
              message: "gtd ui: read refused (file-vanished)",
              code: -32600,
              data: { code: "NOT_FOUND", readRefusal: { reason: "file-vanished" } },
            },
          }
        },
      }}
    >
      <Plan {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText(/no longer being served/)).toBeInTheDocument())
    expect(canvas.queryByText("Could not load the plan.")).not.toBeInTheDocument()
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

/**
 * Task 01's own in-place recovery: `writeNote` refuses `moved: "sha"` on its
 * first call — exactly what a linked worktree crossing a human gate looks
 * like, per the package's own root-cause writeup — and `readSteeringFile`
 * hands back a NEW `headSha` on the refetch `withStaleShaRetry` triggers.
 * The write must land on the silent retry with no banner ever appearing.
 */
export const RealContainerRecoversInPlaceFromAStaleShaRefusal: StoryObj<typeof Plan> = {
  render: (args) => {
    let readCalls = 0
    let writeCalls = 0
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => {
            readCalls += 1
            return {
              ok: true,
              content: "A paragraph worth commenting on.",
              headSha: readCalls === 1 ? "abc123" : "def456",
              contentHash: "deadbeef",
              view: {
                nodes: [
                  {
                    title: "A paragraph worth commenting on.",
                    anchor: { kind: "paragraph", line: 0 },
                  },
                ],
              },
            }
          },
          writeNote: (input) => {
            writeCalls += 1
            if (writeCalls === 1) {
              throw {
                error: {
                  message: "gtd ui: write refused (stale-token)",
                  code: -32600,
                  data: { code: "CONFLICT", writeRefusal: { reason: "stale-token", moved: "sha" } },
                },
              }
            }
            expect((input as { expectedHeadSha: string }).expectedHeadSha).toBe("def456")
            return { ok: true }
          },
        }}
      >
        <Plan {...args} />
      </TrpcTestProvider>
    )
  },
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openNoteSeamAndType(canvas, "worth flagging")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() =>
      expect(canvas.getByTestId("paragraph-note-0")).toHaveTextContent("worth flagging"),
    )
    // The silent retry must never surface the refusal banner — a "Saved"
    // status label (Task 3's own affordance) is fine, since the write DID
    // eventually land; only the refusal sentence itself must never show.
    expect(canvas.queryByText(/committed a change underneath you/)).not.toBeInTheDocument()
  },
}

/**
 * Task 01's Task 5: a `content-hash` refusal (an actual concurrent edit,
 * never auto-retried by `withStaleShaRetry`) shows the banner WITH its new,
 * "reload"-free sentence and a `Try again` control. Pressing it re-runs the
 * exact same write path; a `writeNote` resolver that succeeds on its second
 * call proves the retry actually re-fires the write, landing the note and
 * dismissing the banner.
 */
export const RealContainerTryAgainRerunsTheWriteAndDismissesOnSuccess: StoryObj<typeof Plan> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    let writeCalls = 0
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
            writeCalls += 1
            record(input)
            if (writeCalls === 1) {
              throw {
                error: {
                  message: "gtd ui: write refused (stale-token)",
                  code: -32600,
                  data: {
                    code: "CONFLICT",
                    writeRefusal: { reason: "stale-token", moved: "content-hash" },
                  },
                },
              }
            }
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
      expect(canvas.getByTestId("refusal-message")).toHaveTextContent(
        "The file's content changed underneath you",
      ),
    )
    expect(canvas.getByTestId("refusal-message")).not.toHaveTextContent("reload")
    await fireEvent.click(canvas.getByTestId("refusal-retry"))
    // The refusal itself (and its `Try again` control) clears on a
    // successful retry — the banner element can still exist showing Task
    // 3's own "Saved" status label, which is a genuine, different success.
    await waitFor(() => expect(canvas.queryByTestId("refusal-retry")).not.toBeInTheDocument())
    expect(canvas.queryByText(/content changed underneath you/)).not.toBeInTheDocument()
    // `writeNote` fired exactly twice: the original write that refused, and
    // `Try again`'s own re-run of the SAME write path — proof this is a real
    // retry, not a silent no-op the banner just happened to clear on.
    await expect(canvas.getByTestId("write-calls")).toHaveTextContent("worth flagging")
    const calls = JSON.parse(canvas.getByTestId("write-calls").textContent ?? "[]") as unknown[]
    expect(calls).toHaveLength(2)
  },
}

/**
 * package 02 Task 7's own criterion: "The refusal banner and the `Saved`
 * label are visually distinct — different tone, asserted on a computed
 * style, not by eye." `RefusalBanner` renders through `Notice`, whose two
 * tones differ only in border (`error` adds `border border-accent`,
 * `info` has none) — this proves that difference on the REAL computed
 * style, not by reading source. First save succeeds (tone `info`, "Saved"),
 * second save on the same note is rejected (tone `error`) — same banner
 * element, two different renders of it.
 */
export const RefusalBannerIsVisuallyDistinctFromTheSavedLabel: StoryObj<typeof Plan> = {
  render: (args) => {
    let callCount = 0
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
          writeNote: () => {
            callCount += 1
            if (callCount === 1) return { ok: true }
            throw {
              error: {
                message: "gtd ui: write refused (stale-token)",
                code: -32600,
                data: {
                  code: "CONFLICT",
                  writeRefusal: { reason: "stale-token", moved: "content-hash" },
                },
              },
            }
          },
        }}
      >
        <Plan {...args} />
      </TrpcTestProvider>
    )
  },
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await openNoteSeamAndType(canvas, "first note")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() => expect(canvas.getByTestId("refusal-message")).toHaveTextContent("Saved"))
    const savedBorder = getComputedStyle(canvas.getByTestId("refusal-banner")).borderWidth

    await openNoteSeamAndType(canvas, "second note")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() =>
      expect(canvas.getByTestId("refusal-message")).toHaveTextContent(
        "The file's content changed underneath you",
      ),
    )
    const refusalBorder = getComputedStyle(canvas.getByTestId("refusal-banner")).borderWidth

    expect(refusalBorder).not.toBe(savedBorder)
    expect(savedBorder).toBe("0px")
    expect(refusalBorder).not.toBe("0px")
  },
}

/** Pressing `Try again` on a refusal that fails AGAIN must leave the banner up, with the refusal's own message — never silently dismiss on a second failure. */
export const RealContainerTryAgainOnASecondRefusalLeavesTheBannerUp: StoryObj<typeof Plan> = {
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
          throw {
            error: {
              message: "gtd ui: write refused (stale-token)",
              code: -32600,
              data: {
                code: "CONFLICT",
                writeRefusal: { reason: "stale-token", moved: "content-hash" },
              },
            },
          }
        },
      }}
    >
      <Plan {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openNoteSeamAndType(canvas, "worth flagging")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() => expect(canvas.getByTestId("refusal-banner")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("refusal-retry"))
    await waitFor(() =>
      expect(canvas.getByTestId("refusal-message")).toHaveTextContent(
        "The file's content changed underneath you",
      ),
    )
    expect(canvas.getByTestId("refusal-banner")).toBeInTheDocument()
  },
}

/**
 * Package 05 Task 1: tapping the `plan-done` footer row on a prose-only plan
 * (no question nodes at all, so the deck never renders) fires the same
 * empty-input `done` the deck's own Done control fires — the ONLY way this
 * shape of document could otherwise hand the turn back at all.
 */
/** Records `onDone` calls as `PlanDoneCallRecorder` records `trpc.done` calls — a `useState`-backed array so the tap actually re-renders, keeping `plan-done` PlanView stories consistent with the real-container ones below. */
const PlanDoneCallCounter = ({ view }: { readonly view: SteeringView }) => {
  const [calls, setCalls] = useState<readonly Record<string, never>[]>([])
  return (
    <>
      <div data-testid="on-done-calls">{JSON.stringify(calls)}</div>
      <PlanView
        contentHash="prose-hash-done"
        isLoading={false}
        view={view}
        onDone={() => {
          setCalls((prev) => [...prev, {}])
          return Promise.resolve()
        }}
      />
    </>
  )
}

export const TappingPlanDoneOnAProseOnlyPlanEndsTheTurnWithNoNote: Story = {
  render: () => <PlanDoneCallCounter view={{ nodes: [paragraphNode(0, "A prose-only plan.")] }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("plan-done")).toBeInTheDocument()
    await fireEvent.click(canvas.getByTestId("plan-done"))
    await waitFor(() => expect(canvas.getByTestId("on-done-calls")).toHaveTextContent("[{}]"))
  },
}

/**
 * Same control, on a document carrying an unticked open question — the
 * requirement's own "unguarded" clause: one tap ends the turn with no
 * confirmation element rendered in between, whether or not questions are
 * still open. Asserts the empty-input `done` actually fires exactly once,
 * not just that no dialog appears.
 */
export const TappingPlanDoneWithAnUnansweredOpenQuestionEndsTheTurnOnOneTap: Story = {
  render: () => <PlanDoneCallCounter view={{ nodes: [openQuestion(0, "Which option?")] }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("plan-done"))
    await waitFor(() => expect(canvas.getByTestId("on-done-calls")).toHaveTextContent("[{}]"))
    // No confirmation dialog/element renders in between.
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument()
  },
}

/** `deck-done` is untouched by this package — still renders inside the deck with its existing label, and the deck's last-item advance button still reads "Back to list". */
export const DeckDoneStillRendersInsideTheDeckUnaffectedByPlanDone: Story = {
  args: {
    contentHash: "qa-sample-hash",
    isLoading: false,
    view: { nodes: [openQuestion(0, "Which option?")] } satisfies SteeringView,
    onDone: () => Promise.resolve(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("question-card-0"))
    await expect(canvas.getByTestId("deck-done")).toHaveTextContent("Done")
    await expect(canvas.getByTestId("deck-next")).toHaveTextContent("Back to list")
    await expect(canvas.queryByTestId("plan-done")).not.toBeInTheDocument()
  },
}

/** A story with no `onDone` prop at all renders no `plan-done` control — matching every other optional callback on `PlanViewProps`. */
export const NoOnDonePropRendersNoPlanDoneControl: Story = {
  args: {
    contentHash: "prose-hash-no-done",
    isLoading: false,
    view: { nodes: [paragraphNode(0, "A prose-only plan.")] } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByTestId("plan-done")).not.toBeInTheDocument()
  },
}

/**
 * The real `Plan` container, tapping `plan-done` straight from the plan
 * screen (never opening the note sheet or the deck): `done` fires with an
 * empty request body (no `note` key, matching the deck's own no-note path),
 * and the terminal `HandedBackPanel` renders once it resolves.
 */
export const RealContainerTapsPlanDoneFromTheListRendersHandedBackPanel: StoryObj<typeof Plan> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    let recordWriteOrSet: (input: unknown) => void = () => {}
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: "A prose-only plan.",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: {
              nodes: [{ title: "A prose-only plan.", anchor: { kind: "paragraph", line: 0 } }],
            },
          }),
          done: (input) => {
            record(input)
            return { ok: true }
          },
          // `plan-done` writes no note and answers no question, so neither
          // of these mutations should ever fire — recorded (never thrown)
          // so a stray call is asserted `0`, not just swallowed by
          // `PlanView`'s own `.catch` into an unrelated refusal banner
          // (criterion 3 in the spec review).
          writeNote: (input) => {
            recordWriteOrSet(input)
            return { ok: true }
          },
          setValue: (input) => {
            recordWriteOrSet(input)
            return { ok: true }
          },
        }}
      >
        <PlanDoneCallRecorder
          args={args}
          onRegisterDone={(fn) => (record = fn)}
          onRegisterWriteOrSet={(fn) => (recordWriteOrSet = fn)}
        />
      </TrpcTestProvider>
    )
  },
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("plan-done")).toBeInTheDocument())
    expect(canvas.queryByTestId("refusal-banner")).not.toBeInTheDocument()
    await fireEvent.click(canvas.getByTestId("plan-done"))
    await waitFor(() => expect(canvas.getByTestId("handed-back-panel")).toBeInTheDocument())
    await expect(canvas.getByTestId("done-calls")).toHaveTextContent(JSON.stringify({}))
    expect(canvas.getByTestId("write-or-set-calls")).toHaveTextContent("[]")
    expect(canvas.queryByTestId("refusal-banner")).not.toBeInTheDocument()
  },
}

/**
 * A refused `done` from the plan screen's own Done control surfaces through
 * the existing refusal banner, leaves the plan screen rendered and editable,
 * and never renders `HandedBackPanel` — no different from the deck's own
 * refused-Done path.
 */
export const RealContainerRefusedPlanDoneShowsRefusalBannerNotHandedBack: StoryObj<typeof Plan> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: "A prose-only plan.",
          headSha: "abc123",
          contentHash: "deadbeef",
          view: {
            nodes: [{ title: "A prose-only plan.", anchor: { kind: "paragraph", line: 0 } }],
          },
        }),
        done: () => {
          throw {
            error: {
              message: "gtd ui: write refused (stale-token)",
              code: -32600,
              data: { code: "CONFLICT", writeRefusal: { reason: "stale-token", moved: "sha" } },
            },
          }
        },
      }}
    >
      <Plan {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("plan-done")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("plan-done"))
    await waitFor(() =>
      expect(canvas.getByText(/committed a change underneath you/)).toBeInTheDocument(),
    )
    expect(canvas.queryByTestId("handed-back-panel")).not.toBeInTheDocument()
    await expect(canvas.getByTestId("plan-screen")).toBeInTheDocument()
  },
}

/**
 * A `useState`-backed recorder for the `done` mutation's input — mirrors
 * `PlanWriteCallRecorder`'s identical reasoning. `onRegisterWriteOrSet` is
 * optional: only the plan-done "must never write" story (criterion 3, spec
 * review) needs a second recorder proving `writeNote`/`setValue` fired zero
 * times — every other call site leaves it unset.
 */
const PlanDoneCallRecorder = ({
  args,
  onRegisterDone,
  onRegisterWriteOrSet,
}: {
  readonly args: { readonly filePath: string; readonly mode: string }
  readonly onRegisterDone: (record: (input: unknown) => void) => void
  readonly onRegisterWriteOrSet?: (record: (input: unknown) => void) => void
}) => {
  const [calls, setCalls] = useState<readonly unknown[]>([])
  const [writeOrSetCalls, setWriteOrSetCalls] = useState<readonly unknown[]>([])
  onRegisterDone((input) => setCalls((prev) => [...prev, input]))
  onRegisterWriteOrSet?.((input) => setWriteOrSetCalls((prev) => [...prev, input]))
  return (
    <>
      <div data-testid="done-calls">{JSON.stringify(calls)}</div>
      {onRegisterWriteOrSet !== undefined && (
        <div data-testid="write-or-set-calls">{JSON.stringify(writeOrSetCalls)}</div>
      )}
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
        note: {
          filePath: ".gtd/PLAN.md",
          expectedHeadSha: "abc123",
          expectedContentHash: "deadbeef",
          mode: "qa",
          anchor: { kind: "paragraph", line: 0 },
          text: "handing back now",
        },
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
        readSteeringFile: sampleOpenQuestionRead,
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
    await openFirstQuestionCard(canvas)
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
 * Package 04 Task 2: the Q&A deck's own "Done" control ends the turn with
 * NO note at all, straight from the question deck — no note sheet ever
 * opens. `done` resolves with an empty request (`{}` — no `note` key), and
 * the SAME `HandedBackPanel` `RealContainerRendersHandedBackPanelAfterDone`
 * exercises for the note-carrying path renders here too.
 */
export const RealContainerTapsDoneFromTheDeckWithNoNoteRendersHandedBackPanel: StoryObj<
  typeof Plan
> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: sampleOpenQuestionRead,
          done: (input) => {
            record(input)
            return { ok: true }
          },
          writeNote: () => {
            throw new Error("writeNote must never be called by a note-less Done")
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
    await openFirstQuestionCard(canvas)
    await expect(canvas.getByTestId("deck-next")).toHaveTextContent("Back to list")
    await fireEvent.click(canvas.getByTestId("deck-done"))
    await waitFor(() => expect(canvas.getByTestId("handed-back-panel")).toBeInTheDocument())
    // The request itself carried no `note` — proves the client sent `{}`,
    // never a synthesized empty-string note.
    await expect(canvas.getByTestId("done-calls")).toHaveTextContent(JSON.stringify({}))
  },
}

/**
 * Tapping "Back to list" (the deck's own advance button past the last open
 * question, package 04 Task 2) returns to the question list and writes
 * nothing at all — neither `writeNote` nor `done` is ever called.
 */
export const BackToListFromTheDeckReturnsToTheListAndWritesNothing: Story = {
  args: {
    contentHash: "qa-sample-hash",
    isLoading: false,
    view: { nodes: [openQuestion(0, "Which option?")] } satisfies SteeringView,
    onDone: () => {
      throw new Error("onDone must never be called by Back to list")
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("question-card-0"))
    await expect(canvas.getByTestId("deck-next")).toHaveTextContent("Back to list")
    await expect(canvas.getByTestId("deck-done")).toHaveTextContent("Done")
    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByTestId("question-card-0")).toBeInTheDocument()
  },
}

/**
 * A refused `done` (the same `CONFLICT`/`WriteNoteRefusal` shape every other
 * write refusal takes) must show the refusal banner and must NOT render
 * `HandedBackPanel` — the deck's own Done control fails no differently than
 * `Save & Done` does.
 */
export const RealContainerRefusedDoneFromTheDeckShowsRefusalBannerNotHandedBack: StoryObj<
  typeof Plan
> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: sampleOpenQuestionRead,
        done: () => {
          throw {
            error: {
              message: "gtd ui: write refused (stale-token)",
              code: -32600,
              data: { code: "CONFLICT", writeRefusal: { reason: "stale-token", moved: "sha" } },
            },
          }
        },
      }}
    >
      <Plan {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_PLAN_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openFirstQuestionCard(canvas)
    await fireEvent.click(canvas.getByTestId("deck-done"))
    await waitFor(() =>
      expect(canvas.getByText(/committed a change underneath you/)).toBeInTheDocument(),
    )
    expect(canvas.queryByTestId("handed-back-panel")).not.toBeInTheDocument()
  },
}

/**
 * A FRESH mount of the real `Plan` container — never `PlanView` driven by
 * hand-built `answer` state — against a `readSteeringFile` resolver whose
 * option is already `checked: true`, the exact byte state a real `setValue`
 * write leaves on disk. No interaction happens before the assertion, so
 * `Question.tsx`'s local `answers`/`QuestionAnswer` map is still empty —
 * `defaultAnswerFor` seeding straight off `node.children`'s own `checked` is
 * what must be reading true here, not an optimistic override left by a prior
 * tap. This proves only that a fresh mount re-reads server state, NOT that a
 * reload survives — package 03's real reload acceptance is
 * `ui-lifecycle.feature`'s `@live` "a page reload does not kill gtd ui"
 * scenario, which exercises the actual process across a real reload; nothing
 * here can, since Storybook never tears down and remounts the page.
 */
export const RealContainerReadsAnAlreadyAnsweredOptionOnFreshMount: StoryObj<typeof Plan> = {
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
