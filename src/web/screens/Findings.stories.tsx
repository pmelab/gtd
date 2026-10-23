import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import { applySteeringEdits, steeringFormatFor } from "../../steering/index.js"
import type { SteeringAnchor } from "../../steering/index.js"
import { TrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { Findings } from "./Findings.js"

const format = steeringFormatFor("findings")!

const GATE = `# Quality

## AC-1 ignores floating point

_From lens correctness._

Should subtract round? The criterion does not say.

- [ ] fix

# Dropped as noise

## add could be a method

_From lens correctness. The judge called it noise (p=0.85)._

A class would read better.

- [ ] fix
`

interface SetValueInput {
  readonly anchor: SteeringAnchor
  readonly checked?: boolean
  readonly text?: string
}

/** The real container over a mock server that applies each write with the real format. */
const withServer = (initial: string) => {
  let content = initial
  const Story = () => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content,
          headSha: "abc123",
          contentHash: `hash-${content.length}`,
          view: format.view(content),
        }),
        setValue: (input) => {
          const { anchor, checked, text } = input as SetValueInput
          const opts = {
            ...(checked === undefined ? {} : { checked }),
            ...(text === undefined ? {} : { text }),
          }
          const result = format.apply(content, anchor, opts)
          if (result.ok) content = applySteeringEdits(content, result.edits)
          return { ok: true, contentHash: `hash-${content.length}` }
        },
      }}
    >
      <div className="h-[600px]">
        <Findings filePath=".gtd/QUALITY.md" />
      </div>
    </TrpcTestProvider>
  )
  return { Story, read: () => content }
}

const meta: Meta<typeof Findings> = { component: Findings }

export default meta

type Story = StoryObj<typeof Findings>

const untouched = withServer(GATE)

export const ListsOpenFindingsThenNoiseEachUnticked: Story = {
  render: untouched.Story,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("finding-0")).toBeInTheDocument())
    const groups = canvas.getAllByRole("region")
    await expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Open",
      "Dropped as noise",
    ])
    await expect(within(groups[0]!).getByText("AC-1 ignores floating point")).toBeInTheDocument()
    await expect(within(groups[1]!).getByText("add could be a method")).toBeInTheDocument()
    await expect(canvas.getByTestId("finding-checkbox-0")).not.toBeChecked()
    await expect(canvas.getByTestId("findings-summary")).toHaveTextContent("0 to fix, 2 to drop")
    await expect(canvas.queryByTestId("finding-guidance-0")).not.toBeInTheDocument()
  },
}

const ticking = withServer(GATE)

export const TickingAFindingWritesItsBoxAndOffersGuidance: Story = {
  render: ticking.Story,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("finding-checkbox-1")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("finding-checkbox-1"))
    await waitFor(() => expect(ticking.read()).toContain("A class would read better.\n\n- [x] fix"))
    await expect(canvas.getByTestId("findings-summary")).toHaveTextContent("1 to fix, 1 to drop")
    await fireEvent.click(canvas.getByTestId("finding-guidance-1"))
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "Keep the function." },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() => expect(ticking.read()).toContain("- [x] fix\n\nKeep the function.\n"))
    await expect(format.validate(ticking.read())).toEqual([])
    await waitFor(() =>
      expect(canvas.getByTestId("finding-guidance-1")).toHaveTextContent("Keep the function."),
    )
  },
}

const unticking = withServer(
  GATE.replace("- [ ] fix\n\n# Dropped", "- [x] fix\n\nRound half up.\n\n# Dropped"),
)

export const UntickingAFindingDropsItsGuidanceSoTheFileStaysValid: Story = {
  render: unticking.Story,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByTestId("finding-guidance-0")).toHaveTextContent("Round half up."),
    )
    await fireEvent.click(canvas.getByTestId("finding-checkbox-0"))
    await waitFor(() => expect(unticking.read()).not.toContain("Round half up."))
    await expect(format.validate(unticking.read())).toEqual([])
  },
}

const invalid = withServer(
  GATE.replace("does not say.\n\n- [ ] fix\n", "does not say.\n\n- [ ] fix\n\nRound half up.\n"),
)

export const AFileTheValidatorRefusesNamesTheProblemAndHoldsDone: Story = {
  render: invalid.Story,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByTestId("findings-problems")).toHaveTextContent(
        "guidance under an unticked box",
      ),
    )
    await expect(canvas.getByTestId("findings-done")).toBeDisabled()
  },
}
