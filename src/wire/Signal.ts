/** A delivered signal as `.gtd/SIGNAL.json` holds it. */
export interface SignalDocument {
  readonly kind: string
  readonly fingerprint: string
  readonly at: string
  readonly data: unknown
}

/** The signal in `text`, or `undefined` when it is no signal document. */
export const parseSignal = (text: string | undefined): SignalDocument | undefined => {
  if (text === undefined) return undefined
  try {
    const v = JSON.parse(text) as Record<string, unknown>
    return typeof v.kind === "string" &&
      typeof v.fingerprint === "string" &&
      typeof v.at === "string"
      ? { kind: v.kind, fingerprint: v.fingerprint, at: v.at, data: v.data }
      : undefined
  } catch {
    return undefined
  }
}
