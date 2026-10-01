import { createContext, createElement, useContext, useEffect, useRef, type ReactNode } from "react"
import { createStore, useStore, type StoreApi } from "zustand"
import type { SteeringAnchor } from "../steering/index.js"
import { writeRefusalFrom, type WriteRefusalInfo } from "./api.js"
import { withStaleShaRetry, type CasTokens } from "./staleRetry.js"

/** Every shape a failed write's own refusal can hold. */
export type RefusalState = WriteRefusalInfo | { readonly reason: "unknown" }

export type SaveStatus = "idle" | "saving" | "saved"

/** How long a settled "Saved" label lingers before clearing. */
const SAVED_LINGER_MS = 1_500
/** How long an expanded refusal message stays readable before collapsing to the failed marker. */
const EXPANDED_REFUSAL_MS = 5_000

const anchorKeyOf = (anchor: SteeringAnchor): string => {
  switch (anchor.kind) {
    case "chunk":
      return `chunk:${anchor.index}`
    case "hunk":
      return `hunk:${anchor.chunkIndex}:${anchor.index}`
    case "question":
      return `question:${anchor.index}`
    case "option":
      return `option:${anchor.questionIndex}:${anchor.index}`
    case "paragraph":
      return `paragraph:${anchor.line}`
  }
}

/**
 * The store's own key — explicit per `SteeringAnchor` kind (never
 * `Object.values(rest)`, the old `queueTarget`'s own fragility), so adding a
 * field to one kind fails `writeStore.test.ts` instead of silently reshaping
 * an existing key. `field` separates two values that can share one anchor
 * (a free-text option's own tick vs its text) and names the Done action's
 * own cell: `<filePath>/done` with no anchor, an anchor's cell plus
 * `/done` with one — two distinct keys, never the old shared `"done"`
 * sentinel that collided `onDone` and `onDoneNote` failures together.
 */
export const cellKey = (filePath: string, anchor?: SteeringAnchor, field?: string): string => {
  const base = anchor === undefined ? filePath : `${filePath}:${anchorKeyOf(anchor)}`
  return field === undefined ? base : `${base}/${field}`
}

export interface OverlayEntry {
  readonly gen: number
  readonly value: unknown
}

/** The entry carrying the LATEST `gen` among `cells` — used where one anchor's displayed value can come from either of two cells (a plain note save, or that same anchor's own Done-with-note), since only one of the two is ever written per interaction but a renderer doesn't know which. `undefined` once none of `cells` has ever been touched. */
export const latestOverlayValue = (
  overlay: Readonly<Record<string, OverlayEntry>>,
  cells: readonly string[],
): unknown => {
  let best: OverlayEntry | undefined
  for (const cell of cells) {
    const entry = overlay[cell]
    if (entry !== undefined && (best === undefined || entry.gen > best.gen)) best = entry
  }
  return best?.value
}

/** `SaveIndicator`'s own two counts, pinned here (not just in `Refusal.tsx`) so the off-by-one in `otherFailedCount` fails a store-level test, not just a component one. */
export const indicatorCounts = (
  failed: ReadonlyMap<string, RefusalState>,
): { readonly failedCount: number; readonly otherFailedCount: number } => {
  const failedCount = failed.size
  return { failedCount, otherFailedCount: failedCount > 0 ? failedCount - 1 : 0 }
}

export interface SaveArgs {
  readonly cell: string
  /** The value shown immediately, before the write settles — applied synchronously, outside the drain queue. */
  readonly optimistic: unknown
  /**
   * A write needing no compare-and-swap tokens at all (the Done control —
   * "no anchor/text, no tokens: there is nothing to compare-and-swap when
   * there's nothing to write"). Mutually exclusive with `write`; absent
   * (and `write` absent) settles as an immediate success with nothing sent.
   */
  readonly mutate?: (() => Promise<unknown>) | undefined
  /**
   * A write guarded by the store's own compare-and-swap retry. Tokens are
   * supplied by the STORE, read from its own `WriteStoreProvider`-configured
   * `tokens`/`refetchTokens` at DEQUEUE time — never by the caller, and
   * never cached at call time. A successful result carrying a `contentHash`
   * field swaps the store's own override for it; a `stale-token` refusal
   * retries once against freshly-refetched tokens before giving up.
   */
  readonly write?: ((tokens: CasTokens) => Promise<unknown>) | undefined
}

export interface WriteStoreApi {
  readonly pendingCount: number
  readonly saveStatus: SaveStatus
  readonly expanded: boolean
  readonly failed: ReadonlyMap<string, RefusalState>
  /** Every cell ever touched this session, each with its own generation counter — read this (rather than `overlayValue` alone) when a component needs to re-render off the WHOLE overlay changing, e.g. deriving several cells' values from one `view`. */
  readonly overlay: Readonly<Record<string, OverlayEntry>>

  /** `save`'s one write entry point — see its own module-level doc comment. */
  readonly save: (args: SaveArgs) => Promise<unknown>
  /**
   * Mirrors ANOTHER cell's own in-flight write, for a single physical
   * request that several cells optimistically represent at once (ticking a
   * chunk's "check all" shows every one of its hunks ticked, but writes
   * through ONE `setValue` call) — sets `cell`'s own optimistic value now,
   * and rolls it back if `follow` rejects, WITHOUT filing a `failed` entry
   * or touching `pendingCount`/`saveStatus` of its own: the cell whose
   * `save` call produced `follow` already owns both. A refusal shared by N
   * shadowed cells is still exactly one dot, not N.
   */
  readonly shadow: (cell: string, optimistic: unknown, follow: Promise<unknown>) => void
  /** The cell's current optimistic value, `undefined` once nothing has ever touched it (or after a rollback deleted it). */
  readonly overlayValue: (cell: string) => unknown
  /** Collapses the message and empties the WHOLE failed map in one tap. */
  readonly dismiss: () => void
  /** Re-expands the current failed map's latest message for another `EXPANDED_REFUSAL_MS`. */
  readonly reExpand: () => void
}

interface InternalState extends WriteStoreApi {
  /** ONE global counter, not per-cell — `latestOverlayValue` compares `gen` ACROSS different cells (a note cell vs that same anchor's done cell), which only holds a meaningful order when every cell shares one sequence. Still works as the per-cell rollback guard (`save`'s own `current?.gen === gen` check): a global sequence is unique per call exactly like a per-cell one would be. */
  readonly nextGen: number
  readonly contentHashOverride: string | undefined
  /** This screen's own best-known compare-and-swap tokens — synced in by `WriteStoreProvider`'s own props on every render, read fresh at dequeue time by a `write` thunk, never cached at call time. */
  readonly tokens: { readonly headSha: string; readonly contentHash: string } | undefined
  readonly refetchTokens: (() => Promise<CasTokens>) | undefined
  readonly queue: ReadonlyArray<() => Promise<void>>
  readonly draining: boolean
  readonly collapseTimer: ReturnType<typeof setTimeout> | undefined
  readonly savedTimer: ReturnType<typeof setTimeout> | undefined
}

const hasContentHash = (value: unknown): value is { readonly contentHash: string } =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { contentHash?: unknown }).contentHash === "string"

/**
 * One write store per mounted screen (`WriteStoreProvider`, never a
 * module-level singleton) — every write-side concern lives here: the FIFO
 * queue, the compare-and-swap retry and its token override, the optimistic
 * overlay and its one rollback, the save status, and the ordered map of
 * failed cells. The UI supplies only a `trpc` call and (for a token-guarded
 * write) a way to refetch fresh tokens — the retry, the dequeue-time token
 * read, the success swap, and the stale-token drop all live here, not in a
 * container.
 */
export const createWriteStore = (): StoreApi<InternalState> =>
  createStore<InternalState>((set, get) => {
    const restartCollapseTimer = (): void => {
      clearTimeout(get().collapseTimer)
      const timer = setTimeout(() => set({ expanded: false }), EXPANDED_REFUSAL_MS)
      set({ collapseTimer: timer })
    }

    /** Settles `saveStatus` only once `pendingCount` reaches zero — the LAST entry to settle decides `saved` vs `idle`, never an earlier one a later write has already superseded. */
    const settleSaveStatus = (ok: boolean): void => {
      set((s) => {
        const pendingCount = s.pendingCount - 1
        if (pendingCount > 0) return { pendingCount }
        clearTimeout(s.savedTimer)
        if (!ok) return { pendingCount: 0, saveStatus: "idle", savedTimer: undefined }
        const timer = setTimeout(() => {
          set((cur) => (cur.saveStatus === "saved" ? { saveStatus: "idle" } : {}))
        }, SAVED_LINGER_MS)
        return { pendingCount: 0, saveStatus: "saved", savedTimer: timer }
      })
    }

    const drain = (): void => {
      if (get().draining) return
      const next = get().queue[0]
      if (next === undefined) return
      set((s) => ({ draining: true, queue: s.queue.slice(1) }))
      void next().finally(() => {
        set({ draining: false })
        drain()
      })
    }

    const enqueue = (run: () => Promise<void>): void => {
      set((s) => ({ queue: [...s.queue, run] }))
      drain()
    }

    /**
     * `contentHashOverride ?? tokens.contentHash`, read fresh on every call,
     * never cached. A write's own `onSettled` refetch of `readSteeringFile`
     * is asynchronous, so a second write fired before it lands would
     * otherwise send the PRE-write `contentHash` as its compare-and-swap
     * token and get refused as stale. `ui.format` rewriting the file on
     * every save makes this the ROUTINE case, not an edge case — two writes
     * in a row is normal usage. The override remembers the last write's own
     * post-format hash and prefers it until either a fresh fetch lands
     * (`refetchAndClearOverride`) or a `stale-token` refusal proves it wrong.
     */
    const resolveCasTokens = (): CasTokens | undefined => {
      const tokens = get().tokens
      return tokens === undefined
        ? undefined
        : {
            expectedHeadSha: tokens.headSha,
            expectedContentHash: get().contentHashOverride ?? tokens.contentHash,
          }
    }

    /** `withStaleShaRetry`'s own `refetch` — clears the override once fresh tokens are in hand, so a retry already in flight isn't wedged behind a now-redundant one. */
    const refetchAndClearOverride = async (): Promise<CasTokens> => {
      const refetchTokens = get().refetchTokens
      if (refetchTokens === undefined) {
        throw new Error(
          "writeStore: no refetchTokens configured on WriteStoreProvider for a stale-token retry",
        )
      }
      const fresh = await refetchTokens()
      set({ contentHashOverride: undefined })
      return fresh
    }

    /** Wraps a token-guarded `write` into a zero-arg thunk `save` can drain like any other — the compare-and-swap token read happens INSIDE this thunk, so it only ever runs at dequeue time. */
    const wrapWrite = (
      write: (tokens: CasTokens) => Promise<unknown>,
    ): (() => Promise<unknown>) => {
      return () => {
        const tokens = resolveCasTokens()
        if (tokens === undefined) return Promise.reject(new Error("no steering file loaded yet"))
        return withStaleShaRetry(write, tokens, refetchAndClearOverride).then(
          (result) => {
            if (hasContentHash(result)) set({ contentHashOverride: result.contentHash })
            return result
          },
          (error: unknown) => {
            if (writeRefusalFrom(error)?.reason === "stale-token") {
              set({ contentHashOverride: undefined })
            }
            throw error
          },
        )
      }
    }

    const save = ({ cell, optimistic, mutate, write }: SaveArgs): Promise<unknown> => {
      const gen = get().nextGen
      set((s) => ({
        nextGen: s.nextGen + 1,
        overlay: { ...s.overlay, [cell]: { gen, value: optimistic } },
        pendingCount: s.pendingCount + 1,
        saveStatus: "saving",
      }))
      const run = write !== undefined ? wrapWrite(write) : mutate

      return new Promise((resolve, reject) => {
        enqueue(() => {
          // `run` is only ever invoked once this entry reaches the front of
          // the queue, after every earlier write has already settled and
          // swapped the token — never at `save`'s own call time.
          const settled =
            run === undefined
              ? (() => {
                  // `tsdown.config.ts`'s `web` entry defines
                  // `process.env.NODE_ENV` as the literal `"production"`, so
                  // the bundler's own dead-code elimination drops this
                  // branch entirely from the shipped browser build — this is
                  // not a runtime check the browser evaluates, it never
                  // survives to run there at all.
                  if (process.env.NODE_ENV !== "production") {
                    console.warn(
                      `writeStore: no mutation wired up for cell "${cell}" — nothing was sent`,
                    )
                  }
                  return Promise.resolve(undefined)
                })()
              : run()

          return settled.then(
            (value) => {
              set((s) => {
                const failed = new Map(s.failed)
                failed.delete(cell)
                return { failed }
              })
              settleSaveStatus(true)
              resolve(value)
            },
            (error: unknown) => {
              set((s) => {
                // A failed write rolls back ONLY while it's still the latest
                // write for this cell — a newer write has already replaced
                // the overlay entry, and that one owns the slot now.
                const current = s.overlay[cell]
                const overlay = { ...s.overlay }
                if (current?.gen === gen) delete overlay[cell]
                const failed = new Map(s.failed)
                failed.delete(cell)
                failed.set(cell, writeRefusalFrom(error) ?? { reason: "unknown" })
                return { overlay, failed, expanded: true }
              })
              restartCollapseTimer()
              settleSaveStatus(false)
              reject(error)
            },
          )
        })
      })
    }

    /** See `WriteStoreApi.shadow`'s own doc comment. */
    const shadow = (cell: string, optimistic: unknown, follow: Promise<unknown>): void => {
      const gen = get().nextGen
      set((s) => ({
        nextGen: s.nextGen + 1,
        overlay: { ...s.overlay, [cell]: { gen, value: optimistic } },
      }))
      follow.catch(() => {
        set((s) => {
          const current = s.overlay[cell]
          if (current?.gen !== gen) return {}
          const overlay = { ...s.overlay }
          delete overlay[cell]
          return { overlay }
        })
      })
    }

    return {
      pendingCount: 0,
      saveStatus: "idle",
      expanded: false,
      failed: new Map(),
      overlay: {},
      nextGen: 1,
      contentHashOverride: undefined,
      tokens: undefined,
      refetchTokens: undefined,
      queue: [],
      draining: false,
      collapseTimer: undefined,
      savedTimer: undefined,

      save,
      shadow,
      overlayValue: (cell) => get().overlay[cell]?.value,
      dismiss: () => {
        clearTimeout(get().collapseTimer)
        set({ failed: new Map(), expanded: false })
      },
      reExpand: () => {
        set({ expanded: true })
        restartCollapseTimer()
      },
    }
  })

const WriteStoreContext = createContext<StoreApi<InternalState> | undefined>(undefined)

export interface WriteStoreProviderProps {
  readonly children: ReactNode
  /** This screen's own best-known compare-and-swap tokens — re-synced into the store on every render a new value arrives. Absent (`FreeFormView`/`PlanView`/`ReviewView`'s own pure-data stories) means no token-guarded `write` can ever resolve a token, so `save` rejects any `write` with "no steering file loaded yet". */
  readonly tokens?: { readonly headSha: string; readonly contentHash: string } | undefined
  readonly refetchTokens?: (() => Promise<CasTokens>) | undefined
}

/** One store per mount — clears both its own timers on unmount, since nothing else owns their lifetime. */
export const WriteStoreProvider = ({
  children,
  tokens,
  refetchTokens,
}: WriteStoreProviderProps) => {
  const storeRef = useRef<StoreApi<InternalState> | undefined>(undefined)
  storeRef.current ??= createWriteStore()
  const store = storeRef.current

  // Keeps the store's own copy in sync with the latest render's props — a
  // `write` thunk reads THIS via `get()` at its own dequeue time, never a
  // value closed over when the thunk was built. An EFFECT, never a
  // render-phase call: `setState` notifies subscribers synchronously, and
  // calling it while this component's own render is still in progress is a
  // write to an already-rendering child (React's own "Cannot update a
  // component while rendering a different component"). No deps array —
  // `refetchTokens` is a fresh closure every render, so this has to re-sync
  // every render anyway, exactly like a ref write would.
  useEffect(() => {
    store.setState({ tokens, refetchTokens })
  })

  useEffect(
    () => () => {
      const state = store.getState()
      clearTimeout(state.collapseTimer)
      clearTimeout(state.savedTimer)
    },
    [store],
  )

  return createElement(WriteStoreContext.Provider, { value: store }, children)
}

const useWriteStoreInstance = (): StoreApi<InternalState> => {
  const store = useContext(WriteStoreContext)
  if (store === undefined) throw new Error("useWriteStore must be used within a WriteStoreProvider")
  return store
}

/** Reads a selected slice of the nearest `WriteStoreProvider`'s store — throws a named error with no provider above it, rather than falling back to a shared store. */
export const useWriteStore = <T>(selector: (state: WriteStoreApi) => T): T =>
  useStore(useWriteStoreInstance(), selector)
