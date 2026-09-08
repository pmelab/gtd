import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fireEvent, fn, waitFor, within } from "storybook/test"
import { vi } from "vitest"
import { Mic, type MicRenderState } from "./Mic.js"

const meta: Meta<typeof Mic> = {
  component: Mic,
}

export default meta

type Story = StoryObj<typeof Mic>

/** Mirrors the real `SpeechRecognitionResult` shape: array-like over alternatives, `isFinal` alongside. */
interface FakeResult {
  readonly isFinal: boolean
  readonly 0: { readonly transcript: string }
}

const fakeResult = (transcript: string, isFinal: boolean): FakeResult => ({
  isFinal,
  0: { transcript },
})

/**
 * Stands in for the browser's `SpeechRecognition`/`webkitSpeechRecognition`
 * — neither exists in this test runner, so `Mic` must feature-detect rather
 * than assume, and this fake is what a story installs in its place. Each
 * instance records itself on `instances` so a `play()` function can reach
 * in and fire `onresult`/`onerror`/`onend` the way the real API would.
 */
class FakeSpeechRecognition extends EventTarget {
  static instances: FakeSpeechRecognition[] = []
  continuous = false
  interimResults = false
  onresult: ((event: { resultIndex: number; results: FakeResult[] }) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false

  constructor() {
    super()
    FakeSpeechRecognition.instances.push(this)
  }

  start() {
    this.started = true
  }

  stop() {
    this.onend?.()
  }

  emitResult(results: FakeResult[], resultIndex = 0) {
    this.onresult?.({ resultIndex, results })
  }

  emitError(error: string) {
    this.onerror?.({ error })
  }
}

const withApi = () => {
  FakeSpeechRecognition.instances = []
  window.SpeechRecognition = FakeSpeechRecognition as unknown as NonNullable<
    typeof window.SpeechRecognition
  >
}

const withoutApi = () => {
  delete window.SpeechRecognition
  delete window.webkitSpeechRecognition
}

/** The demo a consumer would actually compose: mic button when available, one-line hint naming the keyboard's mic key otherwise, plus a live view of interim text and the attached transcripts. */
const MicDemo = ({ onAttach }: { readonly onAttach: (text: string) => void }) => {
  const [attached, setAttached] = useState<string[]>([])
  return (
    <Mic
      onAttach={(text) => {
        setAttached((prev) => [...prev, text])
        onAttach(text)
      }}
    >
      {(state: MicRenderState) => (
        <div>
          {state.available ? (
            <button type="button" data-testid="mic-button" onClick={state.toggle}>
              {state.recording ? "Stop" : "Dictate"}
            </button>
          ) : (
            <p data-testid="mic-hint">Use your keyboard's mic key to dictate</p>
          )}
          <div data-testid="mic-interim">{state.interim}</div>
          <div data-testid="mic-attached">{attached.join(" | ")}</div>
        </div>
      )}
    </Mic>
  )
}

export const MicAvailable: Story = {
  render: () => <MicDemo onAttach={fn()} />,
  beforeEach: () => {
    withApi()
    return withoutApi
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("mic-button")).toBeInTheDocument()
    await expect(canvas.queryByTestId("mic-hint")).not.toBeInTheDocument()
  },
}

export const NoSpeechApiShowsHint: Story = {
  render: () => <MicDemo onAttach={fn()} />,
  beforeEach: () => {
    withoutApi()
    return () => {}
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByTestId("mic-button")).not.toBeInTheDocument()
    await expect(canvas.getByTestId("mic-hint")).toHaveTextContent(
      "Use your keyboard's mic key to dictate",
    )
  },
}

export const DeniedPermissionFallsBackToTheHint: Story = {
  render: () => <MicDemo onAttach={fn()} />,
  beforeEach: () => {
    withApi()
    return withoutApi
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("mic-button"))
    const recognition = FakeSpeechRecognition.instances.at(-1)
    recognition?.emitError("not-allowed")
    await waitFor(() => expect(canvas.getByTestId("mic-hint")).toBeInTheDocument())
    await expect(canvas.queryByTestId("mic-button")).not.toBeInTheDocument()
  },
}

/** Clicks the mic button and returns the `FakeSpeechRecognition` instance it just started — the click+lookup pair every story below repeats before diverging into its own `emitResult`/`emitError` sequence. */
const clickMicAndGetRecognition = async (
  canvas: ReturnType<typeof within>,
): Promise<FakeSpeechRecognition | undefined> => {
  await fireEvent.click(canvas.getByTestId("mic-button"))
  return FakeSpeechRecognition.instances.at(-1)
}

/** The `args`/`render`/`beforeEach` triple every story below this point shares verbatim — only `play` differs per story. */
const micStoryWithApi = {
  args: { onAttach: fn() },
  render: (args: { readonly onAttach: (text: string) => void }) => (
    <MicDemo onAttach={args.onAttach} />
  ),
  beforeEach: () => {
    withApi()
    return withoutApi
  },
}

export const InterimResultsDisplayButNeverWriteThrough: Story = {
  ...micStoryWithApi,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const recognition = await clickMicAndGetRecognition(canvas)
    recognition?.emitResult([fakeResult("hello wor", false)])
    await waitFor(() => expect(canvas.getByTestId("mic-interim")).toHaveTextContent("hello wor"))
    expect(canvas.getByTestId("mic-attached")).toHaveTextContent("")
    expect(args.onAttach).not.toHaveBeenCalled()
  },
}

export const FinalResultWritesThroughOnAttachStop: Story = {
  ...micStoryWithApi,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const recognition = await clickMicAndGetRecognition(canvas)
    recognition?.emitResult([fakeResult("hello world", true)])
    await fireEvent.click(canvas.getByTestId("mic-button"))
    await waitFor(() => expect(args.onAttach).toHaveBeenCalledWith("hello world"))
    await expect(canvas.getByTestId("mic-attached")).toHaveTextContent("hello world")
  },
}

/** A stop with no speech at all — `onend` fires with an empty accumulated transcript — must never call `onAttach`, so tapping Dictate then Stop with nothing said can't silently tick/select whatever it's embedded in. */
export const StoppingWithNoSpeechNeverAttaches: Story = {
  ...micStoryWithApi,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("mic-button"))
    await fireEvent.click(canvas.getByTestId("mic-button"))
    await waitFor(() => expect(canvas.getByTestId("mic-button")).toHaveTextContent("Dictate"))
    expect(args.onAttach).not.toHaveBeenCalled()
    expect(canvas.getByTestId("mic-attached")).toHaveTextContent("")
  },
}

/** A `not-allowed` error mid-session must never attach whatever partial transcript had accumulated before the denial — the errored session takes the same silent-skip path as an empty stop. */
export const DeniedPermissionMidSessionNeverAttachesPartialText: Story = {
  ...micStoryWithApi,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const recognition = await clickMicAndGetRecognition(canvas)
    recognition?.emitResult([fakeResult("partial", true)])
    recognition?.emitError("not-allowed")
    recognition?.onend?.()
    await waitFor(() => expect(canvas.getByTestId("mic-hint")).toBeInTheDocument())
    expect(args.onAttach).not.toHaveBeenCalled()
    expect(canvas.getByTestId("mic-attached")).toHaveTextContent("")
  },
}

/**
 * "No audio ever leaves the browser" — assertable for real, not just by
 * grep: spy on every network primitive a component could use to actually
 * send bytes somewhere, run a full dictate → interim → final session, and
 * assert none of them were ever called. Recognition itself is entirely
 * fake here (`FakeSpeechRecognition` never touches a real microphone or
 * network either), so this proves `Mic.tsx`'s OWN code path makes no
 * network call around a session, not that the browser API happens not to.
 */
export const NoAudioOrTranscriptEverLeavesTheBrowser: Story = {
  ...micStoryWithApi,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const fetchSpy = vi.spyOn(window, "fetch")
    const sendBeaconSpy = vi.spyOn(navigator, "sendBeacon")
    const xhrSendSpy = vi.spyOn(XMLHttpRequest.prototype, "send")

    const recognition = await clickMicAndGetRecognition(canvas)
    recognition?.emitResult([fakeResult("partial thought", false)])
    recognition?.emitResult([fakeResult("a finished thought", true)])
    await fireEvent.click(canvas.getByTestId("mic-button"))
    await waitFor(() => expect(canvas.getByTestId("mic-attached")).toHaveTextContent("finished"))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(sendBeaconSpy).not.toHaveBeenCalled()
    expect(xhrSendSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
    sendBeaconSpy.mockRestore()
    xhrSendSpy.mockRestore()
  },
}
