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

/**
 * An answered question's own `view` node carries no options at all
 * (`OpenQuestions.ts`'s answered section never has checkboxes to answer),
 * so drilling into one would render `Question.tsx` with nothing to show and
 * a status line that CONTRADICTS the section the card came from
 * ("unanswered" on a card that's already resolved). The card renders as an
 * inert summary row instead — no button semantics, no drill-in.
 */
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
    await expect(canvas.getByTestId("note-seam-0")).toHaveTextContent("Add note")
    expect(canvas.getByTestId("note-seam-0").getBoundingClientRect().height).toBeGreaterThanOrEqual(
      44,
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
  readonly args: { readonly worktreePath: string; readonly filePath: string; readonly mode: string }
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
  args: { worktreePath: "/repo", filePath: ".gtd/PLAN.md", mode: "qa" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("note-seam-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("note-seam-0"))
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "worth flagging" },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() =>
      expect(canvas.getByTestId("write-calls")).toHaveTextContent("worth flagging"),
    )
    await expect(canvas.getByTestId("write-calls")).toHaveTextContent(
      JSON.stringify({
        worktreePath: "/repo",
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
  args: { worktreePath: "/repo", filePath: ".gtd/PLAN.md", mode: "qa" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("note-seam-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("note-seam-0"))
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "This never actually lands." },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() => expect(canvas.queryByTestId("paragraph-note-0")).not.toBeInTheDocument())
    await expect(canvas.getByTestId("note-seam-0")).toHaveTextContent("Add note")
  },
}
