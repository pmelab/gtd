import { useEffect, useRef, useState } from "react"

/**
 * The Web Speech API isn't in lib.dom.ts. Only the bits this file touches —
 * anything else on the real object is left untyped.
 */
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly [index: number]: { readonly transcript: string }
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

/**
 * Feature-detected at call time (not module load) so stories/tests can
 * install and remove `window.SpeechRecognition`/`webkitSpeechRecognition`
 * per-case. Also silently unavailable over plain http — the Web Speech API
 * is secure-context-only and the constructor is simply absent there, which
 * this same feature-detect already handles.
 */
const getSpeechRecognitionCtor = (): SpeechRecognitionCtor | undefined =>
  window.SpeechRecognition ?? window.webkitSpeechRecognition

/** Splits one recognition event's newly-available results into this call's interim text (for display) and the text to append to the accumulated final transcript — pulled out of the `onresult` handler so that callback stays a plain two-line dispatch. */
// fallow-ignore-next-line complexity
const splitResults = (event: SpeechRecognitionEventLike): { interim: string; final: string } => {
  let interim = ""
  let final = ""
  for (let i = event.resultIndex; i < event.results.length; i++) {
    const result = event.results[i]
    if (result === undefined) continue
    const transcript = result[0]?.transcript ?? ""
    if (result.isFinal) final += transcript
    else interim += transcript
  }
  return { interim, final }
}

export interface MicRenderState {
  /** `false` when the API is missing, or a `"not-allowed"` error has been seen — both take this one fallback path. */
  readonly available: boolean
  readonly recording: boolean
  /** Live text for display only — never written through `onAttach`. */
  readonly interim: string
  readonly toggle: () => void
}

export interface MicProps {
  /** Called once, with the accumulated final transcript, when recognition ends. Never called with interim text. */
  readonly onAttach: (text: string) => void
  /** Optional live-display hook — fired on every interim result, purely for UI, never used for the write-through. */
  readonly onInterim?: (text: string) => void
  readonly children: (state: MicRenderState) => React.ReactNode
}

/**
 * A standalone dictation control: render-prop only, so a consumer decides
 * what the button and the no-mic hint look like. Renders nothing itself —
 * no audio or transcript this component handles ever leaves the browser;
 * `onAttach`/`onInterim` are the only calls it makes with recognized text.
 */
export const Mic = ({ onAttach, onInterim, children }: MicProps) => {
  const [available, setAvailable] = useState(false)
  const [recording, setRecording] = useState(false)
  const [interim, setInterim] = useState("")
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const finalRef = useRef("")
  /** Set in `onerror`, checked in `onend` — an errored session (e.g. `not-allowed`) must never attach whatever partial transcript it collected. */
  const erroredRef = useRef(false)

  useEffect(() => {
    setAvailable(getSpeechRecognitionCtor() !== undefined)
  }, [])

  const stop = () => {
    recognitionRef.current?.stop()
  }

  const start = () => {
    const Ctor = getSpeechRecognitionCtor()
    if (Ctor === undefined) {
      setAvailable(false)
      return
    }
    try {
      const recognition = new Ctor()
      recognition.continuous = true
      recognition.interimResults = true
      finalRef.current = ""
      erroredRef.current = false
      recognition.onresult = (event) => {
        const { interim, final } = splitResults(event)
        finalRef.current += final
        setInterim(interim)
        onInterim?.(interim)
      }
      recognition.onerror = (event) => {
        erroredRef.current = true
        if (event.error === "not-allowed") {
          setAvailable(false)
        }
      }
      recognition.onend = () => {
        setRecording(false)
        setInterim("")
        // Skip the write-through on an errored session (e.g. `not-allowed`) or
        // when the session produced no final text at all — a stop with no
        // speech must never tick/select the free-text option it's embedded in.
        if (!erroredRef.current && finalRef.current.length > 0) {
          onAttach(finalRef.current)
        }
      }
      recognitionRef.current = recognition
      recognition.start()
      setRecording(true)
    } catch {
      setAvailable(false)
    }
  }

  const toggle = () => {
    if (recording) {
      stop()
    } else {
      start()
    }
  }

  return <>{children({ available, recording, interim, toggle })}</>
}
