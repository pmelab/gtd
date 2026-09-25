import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import { freeFormFormat } from "../../steering/index.js"
import { TrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { FreeForm, FreeFormView } from "./FreeForm.js"

const meta: Meta<typeof FreeFormView> = {
  component: FreeFormView,
}

export default meta

type Story = StoryObj<typeof FreeFormView>

/** The real `FreeForm` container's args shared by every "real container" story below. */
const REAL_FREEFORM_ARGS = { filePath: ".gtd/TODO.md", mode: undefined }

export const RendersHeadingListCodeParagraphAndLinkStructureNeverARawTextarea: Story = {
  args: {
    filePath: "/tmp/structured.md",
    isLoading: false,
    view: freeFormFormat.view(
      [
        "## A heading",
        "",
        "- Top item",
        "",
        "```ts",
        "const x = 1",
        "```",
        "",
        "> Quoted line one.",
        "> Quoted line two.",
        "",
        "A trailing paragraph.",
        "",
        "See the [docs](https://example.com/x) for more.",
        "",
      ].join("\n"),
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByText("A heading")
    expect(heading.tagName).toBe("H2")
    await expect(canvas.getByText("Top item")).toBeInTheDocument()
    const code = canvas.getByText((_, element) => element?.tagName === "CODE")
    expect(code.textContent).toBe("const x = 1")
    // Requirement 1: no fence lines painted inside the code block.
    expect(code.textContent).not.toContain("```")
    // Requirement 1: no '>' marker painted inside the blockquote.
    const quote = canvas.getByText("Quoted line one. Quoted line two.")
    expect(quote.textContent).not.toContain(">")
    await expect(canvas.getByText("A trailing paragraph.")).toBeInTheDocument()
    // A markdown link renders as a real anchor, never the literal
    // `[docs](https://example.com/x)` source.
    const link = canvas.getByText("docs")
    expect(link.tagName).toBe("A")
    expect(link.getAttribute("href")).toBe("https://example.com/x")
    expect(canvas.queryByText(/\[docs\]/)).not.toBeInTheDocument()
    // Never a raw whole-file textarea in the read-only view.
    expect(canvas.queryByRole("textbox")).not.toBeInTheDocument()
  },
}

export const NoFindingsSurfaceRendersAnywhereOnThisScreen: Story = {
  args: {
    filePath: "/tmp/no-findings.md",
    isLoading: false,
    view: freeFormFormat.view("Some prose.\n"),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText(/finding/i)).not.toBeInTheDocument()
  },
}

export const UnregisteredModeNamesItselfInTheHeader: Story = {
  args: {
    filePath: "/tmp/unregistered-mode.md",
    isLoading: false,
    mode: "qq",
    view: freeFormFormat.view("Some prose.\n"),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('"qq" has no screen — editing as plain markdown'),
    ).toBeInTheDocument()
  },
}

export const ModeLessFileShowsNoFallbackNotice: Story = {
  args: {
    filePath: "/tmp/modeless.md",
    isLoading: false,
    view: freeFormFormat.view("Some prose.\n"),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByTestId("freeform-fallback-notice")).not.toBeInTheDocument()
  },
}

/**
 * A REGISTERED mode (not just "review"/"qa" by name — `steeringFormatFor`
 * itself, the same registry `App.tsx`'s own dispatch reads) never gets the
 * "no screen" notice, even though `FreeForm` never normally renders for one
 * in practice (`App.tsx` routes `"qa"`/`"review"` to their own screens
 * first) — a future third registered format routed here by mistake, or a
 * direct `FreeFormView` render like this story, must not claim a real format
 * "has no screen".
 */
export const ARegisteredModeNeverGetsTheNoScreenNotice: Story = {
  args: {
    filePath: "/tmp/registered-mode.md",
    isLoading: false,
    mode: "qa",
    view: freeFormFormat.view("Some prose.\n"),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByTestId("freeform-fallback-notice")).not.toBeInTheDocument()
  },
}

/** An empty view (a missing file, a zero-byte file, and a whitespace-only file all parse to zero top-level nodes) renders a bare textfield — no "+ Add content" button, no note-gesture hint. */
export const EmptyDocumentRendersABareTextfield: Story = {
  args: {
    filePath: "/tmp/empty.md",
    isLoading: false,
    view: freeFormFormat.view(""),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("freeform-empty-textarea")).toBeInTheDocument()
    await expect(canvas.getByTestId("freeform-empty-save")).toBeInTheDocument()
    expect(canvas.queryByText("+ Add content")).not.toBeInTheDocument()
    expect(canvas.queryByTestId("note-gesture-hint")).not.toBeInTheDocument()
  },
}

/** A `useState`-backed recorder — mirrors `Plan.stories.tsx#PlanWriteCallRecorder`'s identical reasoning (a plain mutated array wouldn't trigger the re-render the assertions below need). */
const FreeFormWriteCallRecorder = ({
  args,
  onRegisterSetValue,
}: {
  readonly args: { readonly filePath: string; readonly mode: string | undefined }
  readonly onRegisterSetValue: (record: (input: unknown) => void) => void
}) => {
  const [calls, setCalls] = useState<readonly unknown[]>([])
  onRegisterSetValue((input) => setCalls((prev) => [...prev, input]))
  return (
    <>
      <div data-testid="set-value-calls">{JSON.stringify(calls)}</div>
      <FreeForm {...args} />
    </>
  )
}

/** Proves the REAL `FreeForm` container writes an empty-document save through `setValue`, anchored at `Number.MAX_SAFE_INTEGER`, and flips to `prose-paragraphs` once the refetched view has a node. */
export const RealContainerSavesTheEmptyDocumentTextfieldThroughSetValue: StoryObj<typeof FreeForm> =
  {
    render: (args) => {
      let record: (input: unknown) => void = () => {}
      let content = ""
      return (
        <TrpcTestProvider
          resolvers={{
            readSteeringFile: () => ({
              ok: true,
              content,
              headSha: "abc123",
              contentHash: "deadbeef",
              view: freeFormFormat.view(content),
            }),
            setValue: (input) => {
              record(input)
              const { text } = input as { readonly text: string }
              content = `${text}\n`
              return { ok: true, contentHash: "deadbeef2" }
            },
          }}
        >
          <FreeFormWriteCallRecorder args={args} onRegisterSetValue={(fn) => (record = fn)} />
        </TrpcTestProvider>
      )
    },
    args: REAL_FREEFORM_ARGS,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      await waitFor(() => expect(canvas.getByTestId("freeform-empty-textarea")).toBeInTheDocument())
      await fireEvent.change(canvas.getByTestId("freeform-empty-textarea"), {
        target: { value: "First captured note." },
      })
      await fireEvent.click(canvas.getByTestId("freeform-empty-save"))
      await waitFor(() =>
        expect(canvas.getByTestId("set-value-calls")).toHaveTextContent(
          JSON.stringify({
            filePath: ".gtd/TODO.md",
            expectedHeadSha: "abc123",
            expectedContentHash: "deadbeef",
            anchor: { kind: "paragraph", line: Number.MAX_SAFE_INTEGER },
            text: "First captured note.",
          }).slice(1, -1),
        ),
      )
      await waitFor(() => expect(canvas.getByTestId("prose-paragraphs")).toBeInTheDocument())
      await expect(canvas.getByText("First captured note.")).toBeInTheDocument()
    },
  }

/**
 * Task 5's own client-side proof: a `ui.format` command that fails is
 * reported as a notice naming the command and its exit code — the write
 * itself still succeeds (no refusal banner), matching `Write.ts#finishWrite`'s
 * own "never a refusal, never a revert" contract.
 */
export const RealContainerNamesAFailedFormatCommandAsANotice: StoryObj<typeof FreeForm> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: "A paragraph worth commenting on.",
          headSha: "abc123",
          contentHash: "deadbeef",
          view: freeFormFormat.view("A paragraph worth commenting on.\n"),
        }),
        writeNote: () => ({
          ok: true,
          contentHash: "deadbeef2",
          formatNotice: { command: "npx oxfmt --write '<file>'", exitCode: 127 },
        }),
      }}
    >
      <FreeForm {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_FREEFORM_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("note-target-0")).toBeInTheDocument())
    await fireEvent.doubleClick(canvas.getByTestId("note-target-0"))
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "changed" },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() =>
      expect(canvas.getByTestId("format-notice")).toHaveTextContent(
        "ui.format failed (exit 127): npx oxfmt --write '<file>'",
      ),
    )
    await expect(canvas.queryByTestId("refusal-dismiss")).not.toBeInTheDocument()
  },
}

/** The existing note seam still works over a mode-less file: opens the note sheet and writes through `writeNote`. */
export const RealContainerNoteSeamWriteThroughsAParagraphNoteViaWriteNote: StoryObj<
  typeof FreeForm
> = {
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
            view: freeFormFormat.view("A paragraph worth commenting on.\n"),
          }),
          writeNote: (input) => {
            record(input)
            return { ok: true, contentHash: "deadbeef2" }
          },
        }}
      >
        <FreeFormWriteCallRecorder args={args} onRegisterSetValue={(fn) => (record = fn)} />
      </TrpcTestProvider>
    )
  },
  args: REAL_FREEFORM_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("note-target-0")).toBeInTheDocument())
    await fireEvent.doubleClick(canvas.getByTestId("note-target-0"))
    await expect(canvas.getByTestId("note-sheet")).toBeInTheDocument()
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "worth flagging" },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() =>
      expect(canvas.getByTestId("set-value-calls")).toHaveTextContent("worth flagging"),
    )
    await expect(canvas.getByTestId("paragraph-note-0")).toHaveTextContent("worth flagging")
  },
}

/** A `plan-done` footer hands off through `trpc.done`, followed by the handed-back panel — mirrors `Plan.stories.tsx`'s identical story for this shared control. */
export const RealContainerTapsPlanDoneRendersHandedBackPanel: StoryObj<typeof FreeForm> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: "A prose-only file.",
          headSha: "abc123",
          contentHash: "deadbeef",
          view: freeFormFormat.view("A prose-only file.\n"),
        }),
        done: () => ({ ok: true }),
      }}
    >
      <FreeForm {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_FREEFORM_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("plan-done")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("plan-done"))
    await waitFor(() => expect(canvas.getByTestId("handed-back-panel")).toBeInTheDocument())
  },
}

/** Every write refusal renders as its own specific sentence through `RefusalBanner`, never a generic error — now driven through the empty-document save, the only write path left on this screen besides a note. */
export const RealContainerRefusedEditShowsItsOwnNamedRefusalSentence: StoryObj<typeof FreeForm> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: "",
          headSha: "abc123",
          contentHash: "deadbeef",
          view: freeFormFormat.view(""),
        }),
        setValue: () => {
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
      <FreeForm {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_FREEFORM_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("freeform-empty-textarea")).toBeInTheDocument())
    await fireEvent.change(canvas.getByTestId("freeform-empty-textarea"), {
      target: { value: "changed" },
    })
    await fireEvent.click(canvas.getByTestId("freeform-empty-save"))
    await waitFor(() =>
      expect(canvas.getByTestId("refusal-message")).toHaveTextContent(
        "The file's content changed underneath you",
      ),
    )
  },
}

/**
 * Spec review item 3: a genuine `content-hash` refusal (a second tab, an
 * external edit) must not wedge the screen behind its own now-stale token
 * override forever. The mock `readSteeringFile` deliberately NEVER advances
 * its own `contentHash` ("deadbeef", fixed) — standing in for "the query
 * cache's own last-known value", so this story never depends on a
 * background refetch's own timing to land before the retry fires (unlike a
 * real server, whose bytes really did move). Sequence: a first save
 * SUCCEEDS, setting the local override to `"deadbeef2"`; a second save is
 * refused `content-hash` regardless of what it sends (a stand-in for "the
 * real file moved underneath this client"); a THIRD save — retried via the
 * refusal banner's own "Try again", re-entering the exact same `onSave`
 * path — must succeed by falling back to the STILL-cached `"deadbeef"`,
 * proving the wedged `"deadbeef2"` override was dropped rather than reused
 * forever. Driven through the note seam, the only repeatable write path
 * left on a non-empty document.
 */
export const RealContainerRecoversAfterAContentHashRefusalRatherThanWedging: StoryObj<
  typeof FreeForm
> = {
  render: (args) => {
    let writeNoteCallCount = 0
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: "A paragraph worth commenting on.",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: freeFormFormat.view("A paragraph worth commenting on.\n"),
          }),
          writeNote: (input) => {
            writeNoteCallCount += 1
            const { expectedContentHash } = input as { readonly expectedContentHash: string }
            if (writeNoteCallCount === 1) {
              return { ok: true, contentHash: "deadbeef2" }
            }
            const refuseContentHash = () => {
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
            if (writeNoteCallCount === 2) {
              // Simulates a genuine concurrent edit — refused regardless of
              // what hash this attempt sent (it's the override, "deadbeef2").
              return refuseContentHash()
            }
            // Third attempt: succeeds ONLY if the wedged "deadbeef2" override
            // was dropped in favor of the still-cached "deadbeef".
            if (expectedContentHash !== "deadbeef") return refuseContentHash()
            return { ok: true, contentHash: "deadbeef3" }
          },
        }}
      >
        <FreeForm {...args} />
      </TrpcTestProvider>
    )
  },
  args: REAL_FREEFORM_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("note-target-0")).toBeInTheDocument())

    // First save: succeeds, sets the local override.
    await fireEvent.doubleClick(canvas.getByTestId("note-target-0"))
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "First note." },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() => expect(canvas.queryByTestId("note-sheet")).not.toBeInTheDocument())

    // Second save: refused content-hash — the banner shows, and the override
    // must be dropped rather than reused.
    await fireEvent.doubleClick(canvas.getByTestId("note-target-0"))
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "Second note." },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() =>
      expect(canvas.getByTestId("refusal-message")).toHaveTextContent(
        "The file's content changed underneath you",
      ),
    )

    // Retrying (the SAME save, re-entered) now succeeds — proving the next
    // attempt fell back to the cached hash, not the wedged override.
    await fireEvent.click(canvas.getByTestId("refusal-retry"))
    // `refusal-dismiss`/`refusal-retry` render ONLY while an actual refusal
    // is showing — `refusal-message` itself is reused for the transient
    // "Saved" status text a successful retry also produces, so THAT testid
    // alone can't tell "cleared" from "still refused" apart.
    await waitFor(() => expect(canvas.queryByTestId("refusal-dismiss")).not.toBeInTheDocument())
  },
}
