import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import type { SteeringView } from "../../steering/index.js"
import { trpc } from "../api.js"
import { TrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { FreeForm, FreeFormView } from "./FreeForm.js"

const meta: Meta<typeof FreeFormView> = {
  component: FreeFormView,
  // Every story in this file mounts `FreeFormView`/`FreeForm`, both of which
  // read/write real `localStorage` drafts (Task 3) — Storybook runs every
  // story in this file in ONE headless Chromium, one origin, one
  // `localStorage`. Several "real container" stories below share
  // `REAL_FREEFORM_ARGS`'s own `filePath` and the same served block text, so
  // without this they'd share one draft key and leak an abandoned draft from
  // one story's rejected/never-cleared edit into the next story's initial
  // textarea value.
  beforeEach: () => {
    localStorage.clear()
  },
}

export default meta

type Story = StoryObj<typeof FreeFormView>

/** The real `FreeForm` container's args shared by every "real container" story below. */
const REAL_FREEFORM_ARGS = { filePath: ".gtd/TODO.md", mode: undefined }

const paragraphNode = (
  line: number,
  title: string,
  note?: string,
): SteeringView["nodes"][number] => ({
  title,
  anchor: { kind: "paragraph", line },
  block: { kind: "paragraph", text: title },
  ...(note !== undefined ? { note } : {}),
})

export const RendersHeadingListCodeParagraphAndLinkStructureNeverARawTextarea: Story = {
  args: {
    filePath: "/tmp/structured.md",
    isLoading: false,
    view: {
      nodes: [
        {
          title: "A heading",
          anchor: { kind: "paragraph", line: 0 },
          block: { kind: "heading", depth: 2, text: "## A heading" },
        },
        {
          title: "Top item",
          anchor: { kind: "paragraph", line: 2 },
          block: {
            kind: "list",
            ordered: false,
            items: [{ text: "Top item" }],
            text: "- Top item",
          },
        },
        {
          title: "const x = 1",
          anchor: { kind: "paragraph", line: 4 },
          block: { kind: "code", language: "ts", text: "const x = 1" },
        },
        paragraphNode(6, "A trailing paragraph."),
        paragraphNode(8, "See the [docs](https://example.com/x) for more."),
      ],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByText("A heading")
    expect(heading.tagName).toBe("H2")
    await expect(canvas.getByText("Top item")).toBeInTheDocument()
    const code = canvas.getByText((_, element) => element?.tagName === "CODE")
    expect(code.textContent).toBe("const x = 1")
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

export const EachBlockGetsItsOwnEditAffordanceOpeningATextareaWithRawSource: Story = {
  args: {
    filePath: "/tmp/edit.md",
    isLoading: false,
    view: {
      nodes: [
        {
          title: "const x = 1",
          anchor: { kind: "paragraph", line: 0 },
          block: { kind: "code", language: "ts", text: "const x = 1\nconst y = 2" },
        },
      ],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await expect(canvas.getByTestId("freeform-edit-textarea-0")).toHaveValue(
      "const x = 1\nconst y = 2",
    )
  },
}

export const AppendRowSitsAtTheFootAndOpensATextarea: Story = {
  args: {
    filePath: "/tmp/append.md",
    isLoading: false,
    view: { nodes: [paragraphNode(0, "First paragraph.")] } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const openButton = canvas.getByTestId("freeform-append-open")
    await expect(openButton).toBeInTheDocument()
    const paragraph = canvas.getByText("First paragraph.")
    expect(
      paragraph.compareDocumentPosition(openButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // Requirement B: reachable "without scrolling the whole document
    // first" — the append affordance sits OUTSIDE the scrollable block
    // list (`freeform-scroll`), never buried at the bottom of a long
    // scroll region.
    expect(canvas.getByTestId("freeform-scroll").contains(openButton)).toBe(false)
    await fireEvent.click(openButton)
    await expect(canvas.getByTestId("freeform-append-textarea")).toBeInTheDocument()
  },
}

export const NoFindingsSurfaceRendersAnywhereOnThisScreen: Story = {
  args: {
    filePath: "/tmp/no-findings.md",
    isLoading: false,
    view: { nodes: [paragraphNode(0, "Some prose.")] } satisfies SteeringView,
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
    view: { nodes: [paragraphNode(0, "Some prose.")] } satisfies SteeringView,
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
    view: { nodes: [paragraphNode(0, "Some prose.")] } satisfies SteeringView,
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
    view: { nodes: [paragraphNode(0, "Some prose.")] } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByTestId("freeform-fallback-notice")).not.toBeInTheDocument()
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

/** Proves the REAL `FreeForm` container writes an edit through `setValue` at the block's own `paragraph` anchor. */
export const RealContainerSavesAnEditThroughSetValueAtTheBlocksAnchor: StoryObj<typeof FreeForm> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: "A paragraph worth editing.",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: {
              nodes: [
                {
                  title: "A paragraph worth editing.",
                  anchor: { kind: "paragraph", line: 0 },
                  block: { kind: "paragraph", text: "A paragraph worth editing." },
                },
              ],
            },
          }),
          setValue: (input) => {
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
    await waitFor(() => expect(canvas.getByTestId("freeform-edit-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-0"), {
      target: { value: "A rewritten paragraph." },
    })
    await fireEvent.click(canvas.getByTestId("freeform-save-0"))
    await waitFor(() =>
      expect(canvas.getByTestId("set-value-calls")).toHaveTextContent("A rewritten paragraph."),
    )
    await expect(canvas.getByTestId("set-value-calls")).toHaveTextContent(
      JSON.stringify({
        filePath: ".gtd/TODO.md",
        expectedHeadSha: "abc123",
        expectedContentHash: "deadbeef",
        anchor: { kind: "paragraph", line: 0 },
        text: "A rewritten paragraph.",
      }).slice(1, -1),
    )
  },
}

/** Deleting a block writes `text: ""` through the same `setValue` path. */
export const RealContainerDeletesABlockByWritingEmptyText: StoryObj<typeof FreeForm> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: "A paragraph worth deleting.",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: {
              nodes: [
                {
                  title: "A paragraph worth deleting.",
                  anchor: { kind: "paragraph", line: 0 },
                  block: { kind: "paragraph", text: "A paragraph worth deleting." },
                },
              ],
            },
          }),
          setValue: (input) => {
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
    await waitFor(() => expect(canvas.getByTestId("freeform-delete-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("freeform-delete-0"))
    await waitFor(() =>
      expect(canvas.getByTestId("set-value-calls")).toHaveTextContent(
        JSON.stringify({ anchor: { kind: "paragraph", line: 0 }, text: "" }).slice(1, -1),
      ),
    )
  },
}

/**
 * Task 6's own client-side proof: `readSteeringFile`'s mock ALWAYS resolves
 * the same pre-write `contentHash` ("deadbeef") — standing in for the query
 * cache not having caught up yet, exactly the gap between a successful write
 * and its `onSettled` invalidate/refetch landing. The mock `setValue`
 * resolver plays the real server's own role: it accepts a request carrying
 * the PREVIOUS response's own `contentHash` and refuses (`stale-token`/
 * `moved:"content-hash"`, real `Write.ts#verifyForWrite`'s exact shape) any
 * other value. A second edit fired right after the first succeeding — with
 * no refetch resolving in between — only succeeds if `FreeForm` swapped its
 * own compare-and-swap token for the hash the FIRST `setValue` call actually
 * returned, never the stale one still sitting in the query cache.
 */
export const RealContainerReusesThePostFormatHashForItsNextWriteNoRefetchNeeded: StoryObj<
  typeof FreeForm
> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    let expectedHash = "deadbeef"
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: "A paragraph worth editing.",
            headSha: "abc123",
            // Deliberately fixed, never advancing — the query cache's own
            // stale view of the file, standing in for "before invalidate's
            // refetch has landed".
            contentHash: "deadbeef",
            view: {
              nodes: [
                {
                  title: "A paragraph worth editing.",
                  anchor: { kind: "paragraph", line: 0 },
                  block: { kind: "paragraph", text: "A paragraph worth editing." },
                },
              ],
            },
          }),
          setValue: (input) => {
            record(input)
            const { expectedContentHash } = input as { readonly expectedContentHash: string }
            if (expectedContentHash !== expectedHash) {
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
            expectedHash = expectedHash === "deadbeef" ? "deadbeef2" : "deadbeef3"
            return { ok: true, contentHash: expectedHash }
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
    await waitFor(() => expect(canvas.getByTestId("freeform-edit-0")).toBeInTheDocument())

    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-0"), {
      target: { value: "First edit." },
    })
    await fireEvent.click(canvas.getByTestId("freeform-save-0"))
    await waitFor(() =>
      expect(canvas.getByTestId("set-value-calls")).toHaveTextContent("First edit."),
    )

    // A second edit, fired immediately — the mock `readSteeringFile` still
    // answers with the ORIGINAL "deadbeef", so this only succeeds off
    // `FreeForm`'s own local token override, never the query cache.
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-0"), {
      target: { value: "Second edit." },
    })
    await fireEvent.click(canvas.getByTestId("freeform-save-0"))
    await waitFor(() =>
      expect(canvas.getByTestId("set-value-calls")).toHaveTextContent("Second edit."),
    )
    await expect(canvas.queryByTestId("refusal-dismiss")).not.toBeInTheDocument()
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
          content: "A paragraph worth editing.",
          headSha: "abc123",
          contentHash: "deadbeef",
          view: {
            nodes: [
              {
                title: "A paragraph worth editing.",
                anchor: { kind: "paragraph", line: 0 },
                block: { kind: "paragraph", text: "A paragraph worth editing." },
              },
            ],
          },
        }),
        setValue: () => ({
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
    await waitFor(() => expect(canvas.getByTestId("freeform-edit-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-0"), {
      target: { value: "changed" },
    })
    await fireEvent.click(canvas.getByTestId("freeform-save-0"))
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
            view: {
              nodes: [
                {
                  title: "A paragraph worth commenting on.",
                  anchor: { kind: "paragraph", line: 0 },
                  block: { kind: "paragraph", text: "A paragraph worth commenting on." },
                },
              ],
            },
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
          view: {
            nodes: [
              {
                title: "A prose-only file.",
                anchor: { kind: "paragraph", line: 0 },
                block: { kind: "paragraph", text: "A prose-only file." },
              },
            ],
          },
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

/** Every write refusal renders as its own specific sentence through `RefusalBanner`, never a generic error. */
export const RealContainerRefusedEditShowsItsOwnNamedRefusalSentence: StoryObj<typeof FreeForm> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: "A paragraph worth editing.",
          headSha: "abc123",
          contentHash: "deadbeef",
          view: {
            nodes: [
              {
                title: "A paragraph worth editing.",
                anchor: { kind: "paragraph", line: 0 },
                block: { kind: "paragraph", text: "A paragraph worth editing." },
              },
            ],
          },
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
    await waitFor(() => expect(canvas.getByTestId("freeform-edit-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-0"), {
      target: { value: "changed" },
    })
    await fireEvent.click(canvas.getByTestId("freeform-save-0"))
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
 * forever.
 */
export const RealContainerRecoversAfterAContentHashRefusalRatherThanWedging: StoryObj<
  typeof FreeForm
> = {
  render: (args) => {
    let setValueCallCount = 0
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: "A paragraph worth editing.",
            headSha: "abc123",
            contentHash: "deadbeef",
            view: {
              nodes: [
                {
                  title: "A paragraph worth editing.",
                  anchor: { kind: "paragraph", line: 0 },
                  block: { kind: "paragraph", text: "A paragraph worth editing." },
                },
              ],
            },
          }),
          setValue: (input) => {
            setValueCallCount += 1
            const { expectedContentHash } = input as { readonly expectedContentHash: string }
            if (setValueCallCount === 1) {
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
            if (setValueCallCount === 2) {
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
    await waitFor(() => expect(canvas.getByTestId("freeform-edit-0")).toBeInTheDocument())

    // First save: succeeds, sets the local override.
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-0"), {
      target: { value: "First edit." },
    })
    await fireEvent.click(canvas.getByTestId("freeform-save-0"))
    await waitFor(() =>
      expect(canvas.queryByTestId("freeform-edit-textarea-0")).not.toBeInTheDocument(),
    )

    // Second save: refused content-hash — the banner shows, and the override
    // must be dropped rather than reused.
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-0"), {
      target: { value: "Second edit." },
    })
    await fireEvent.click(canvas.getByTestId("freeform-save-0"))
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

/**
 * Task 8: an in-progress edit survives a background `readSteeringFile`
 * refetch — every mutation's `onSettled` fires `invalidate`, which this story
 * triggers directly via a sibling save (on a DIFFERENT block) while block 0's
 * edit stays open, proving `openLine`/the draft `useState` never resets off
 * the query result.
 */
/**
 * Fires a `readSteeringFile.invalidate` straight off `trpc.useUtils()` on a
 * button click — the exact background refetch every mutation's own
 * `onSettled` triggers (`useFreeFormMutations`'s `setValue`/`writeNote`
 * `onSettled`), decoupled from this screen's own single-open-editor UI so the
 * story can trigger it while block 0's edit stays open, without needing a
 * second editor open at the same time.
 */
const BackgroundInvalidateButton = ({
  filePath,
  mode,
}: {
  readonly filePath: string
  readonly mode: string | undefined
}) => {
  const utils = trpc.useUtils()
  return (
    <button
      type="button"
      data-testid="trigger-background-invalidate"
      onClick={() => {
        utils.readSteeringFile.invalidate({ filePath, mode })
      }}
    >
      Trigger background invalidate
    </button>
  )
}

export const AnOpenEditSurvivesABackgroundInvalidate: StoryObj<typeof FreeForm> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: "First paragraph.",
          headSha: "abc123",
          contentHash: "task8-hash",
          view: {
            nodes: [
              {
                title: "First paragraph.",
                anchor: { kind: "paragraph", line: 0 },
                block: { kind: "paragraph", text: "First paragraph." },
              },
            ],
          },
        }),
      }}
    >
      <BackgroundInvalidateButton filePath={args.filePath} mode={args.mode} />
      <FreeForm {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_FREEFORM_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("freeform-edit-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-0"), {
      target: { value: "typed but not yet saved" },
    })

    await fireEvent.click(canvas.getByTestId("trigger-background-invalidate"))
    // Give the refetch a tick to land before asserting nothing moved.
    await waitFor(() => expect(canvas.getByTestId("freeform-edit-textarea-0")).toBeInTheDocument())

    await expect(canvas.getByTestId("freeform-edit-textarea-0")).toHaveValue(
      "typed but not yet saved",
    )
  },
}

/** The draft is restored on mount (a re-render / remount of the same block after closing and reopening its own edit) from `localStorage`, keyed on `filePath`/the block's own text discriminator. */
export const ADraftIsRestoredFromLocalStorageWhenReopeningTheSameBlock: Story = {
  args: {
    filePath: "/tmp/restore-draft.md",
    isLoading: false,
    view: {
      nodes: [
        {
          title: "Original text.",
          anchor: { kind: "paragraph", line: 0 },
          block: { kind: "paragraph", text: "Original text." },
        },
      ],
    } satisfies SteeringView,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-0"), {
      target: { value: "a draft in progress" },
    })
    await fireEvent.click(canvas.getByTestId("freeform-cancel-0"))
    await expect(canvas.queryByTestId("freeform-edit-textarea-0")).not.toBeInTheDocument()

    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await expect(canvas.getByTestId("freeform-edit-textarea-0")).toHaveValue("a draft in progress")
  },
}

/**
 * Task 8's other own bullet: a draft is CLEARED on a successful write, not
 * just restored on reopen — the gap the spec review's own item 9 flagged
 * (deleting the `clearDraft` call failed nothing, since no story exercised
 * it). Types a draft, saves (a stub `onSave` that resolves), reopens the
 * SAME block, and asserts the textarea shows the block's own current text —
 * never the stale draft `localStorage` would otherwise still be holding.
 */
export const ADraftIsClearedFromLocalStorageAfterASuccessfulSave: Story = {
  args: {
    filePath: "/tmp/clear-draft.md",
    isLoading: false,
    view: {
      nodes: [
        {
          title: "Original text.",
          anchor: { kind: "paragraph", line: 0 },
          block: { kind: "paragraph", text: "Original text." },
        },
      ],
    } satisfies SteeringView,
    onSave: () => Promise.resolve(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-0"), {
      target: { value: "a draft about to be saved" },
    })
    await fireEvent.click(canvas.getByTestId("freeform-save-0"))
    await waitFor(() =>
      expect(canvas.queryByTestId("freeform-edit-textarea-0")).not.toBeInTheDocument(),
    )

    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    // The saved draft is gone — reopening falls back to the block's own
    // current source text, not the cleared localStorage entry.
    await expect(canvas.getByTestId("freeform-edit-textarea-0")).toHaveValue("Original text.")
  },
}

/**
 * A tiny harness for Requirement B's three "the draft key names the file and
 * the block, never the file's `contentHash`/the block's line" stories below —
 * each swaps ONE prop (`filePath` or `view`) mid-story via a button, well
 * after a draft was typed and the block's editor closed, standing in for "the
 * SAME running `gtd ui` process now serves a different file" or "the file
 * changed underneath this open tab" without ever remounting `FreeFormView`
 * itself (a remount would trivially "work" for the wrong reason — a fresh
 * `useState` lazy initializer re-reading `localStorage` on MOUNT, not a real
 * re-read triggered by reopening the row).
 */
const FreeFormViewPropSwitcher = ({
  initialFilePath,
  initialView,
  nextFilePath,
  nextView,
}: {
  readonly initialFilePath: string
  readonly initialView: SteeringView
  readonly nextFilePath?: string
  readonly nextView?: SteeringView
}) => {
  const [filePath, setFilePath] = useState(initialFilePath)
  const [view, setView] = useState(initialView)
  return (
    <>
      <button
        type="button"
        data-testid="switch-props"
        onClick={() => {
          if (nextFilePath !== undefined) setFilePath(nextFilePath)
          if (nextView !== undefined) setView(nextView)
        }}
      >
        Switch
      </button>
      <FreeFormView view={view} filePath={filePath} isLoading={false} mode={undefined} />
    </>
  )
}

/** Requirement B's first acceptance bullet: a draft stored against one file's path does not appear when a DIFFERENT file with identical content is opened at the same line. */
export const ADraftDoesNotFollowToADifferentFileWithIdenticalContent: StoryObj<
  typeof FreeFormViewPropSwitcher
> = {
  render: (args) => <FreeFormViewPropSwitcher {...args} />,
  args: {
    initialFilePath: "/tmp/file-a.md",
    initialView: { nodes: [paragraphNode(0, "Same paragraph text.")] },
    nextFilePath: "/tmp/file-b.md",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-0"), {
      target: { value: "a draft typed against file A" },
    })
    await fireEvent.click(canvas.getByTestId("freeform-cancel-0"))

    // Same byte-identical content, same line, but a DIFFERENT served path.
    await fireEvent.click(canvas.getByTestId("switch-props"))
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await expect(canvas.getByTestId("freeform-edit-textarea-0")).toHaveValue("Same paragraph text.")
  },
}

/** Requirement B's second acceptance bullet: a draft survives the file being rewritten underneath it (a `ui.format` run, another block's save, an agent commit — modeled here as the `view` prop being swapped for a freshly-fetched one, same file, same block text). */
export const ADraftSurvivesTheFileBeingRewrittenUnderneathIt: StoryObj<
  typeof FreeFormViewPropSwitcher
> = {
  render: (args) => <FreeFormViewPropSwitcher {...args} />,
  args: {
    initialFilePath: "/tmp/rewritten.md",
    initialView: { nodes: [paragraphNode(0, "Text that survives a rewrite.")] },
    nextView: {
      // A brand new node/view object — standing in for a fresh
      // `readSteeringFile` result after the file was rewritten — but the
      // SAME block text, so the draft's own discriminator still matches.
      nodes: [paragraphNode(0, "Text that survives a rewrite.")],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-0"), {
      target: { value: "a draft typed before the rewrite" },
    })
    await fireEvent.click(canvas.getByTestId("freeform-cancel-0"))

    await fireEvent.click(canvas.getByTestId("switch-props"))
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await expect(canvas.getByTestId("freeform-edit-textarea-0")).toHaveValue(
      "a draft typed before the rewrite",
    )
  },
}

/** Requirement B's third acceptance bullet: a draft follows its own block when an EARLIER block is deleted and every other block shifts up a line — proving the key is never the block's own anchor line. */
export const ADraftFollowsItsBlockWhenAnEarlierBlockIsDeletedAndLinesShift: StoryObj<
  typeof FreeFormViewPropSwitcher
> = {
  render: (args) => <FreeFormViewPropSwitcher {...args} />,
  args: {
    initialFilePath: "/tmp/shifting-lines.md",
    initialView: {
      nodes: [paragraphNode(0, "First paragraph."), paragraphNode(2, "Second paragraph.")],
    },
    // "First paragraph." deleted — "Second paragraph." now sits at line 0.
    nextView: { nodes: [paragraphNode(0, "Second paragraph.")] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Types a draft against "Second paragraph.", which starts at index 1.
    await fireEvent.click(canvas.getByTestId("freeform-edit-1"))
    await fireEvent.change(canvas.getByTestId("freeform-edit-textarea-1"), {
      target: { value: "a draft on the second paragraph" },
    })
    await fireEvent.click(canvas.getByTestId("freeform-cancel-1"))

    await fireEvent.click(canvas.getByTestId("switch-props"))
    // "Second paragraph." is now the ONLY, first (index 0) block.
    await fireEvent.click(canvas.getByTestId("freeform-edit-0"))
    await expect(canvas.getByTestId("freeform-edit-textarea-0")).toHaveValue(
      "a draft on the second paragraph",
    )
  },
}
