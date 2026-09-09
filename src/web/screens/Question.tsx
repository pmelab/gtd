import { useEffect, useId, useRef } from "react"
import { FREE_TEXT_PLACEHOLDER, isAnswered } from "../../OpenQuestions.js"
import type { SteeringAnchor, SteeringViewNode } from "../../SteeringFormat.js"
import { Button } from "../Button.js"
import { Mic } from "../Mic.js"

/** `""` for an untouched/placeholder-only answer (case-insensitive) — the SAME sentinel and the SAME normalization the completeness gate and the open-questions check both apply server-side (`OpenQuestions.ts#FREE_TEXT_PLACEHOLDER`), redone here so the client never has to round-trip through a write to know if it's answered. Comparing against a client-invented hint string here would be a second, divergent copy of that predicate — see T5's own "already exists and is the single one enforced" acceptance bullet. */
const normalizeAnswerText = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.toLowerCase() === FREE_TEXT_PLACEHOLDER.toLowerCase() ? "" : trimmed
}

/** One question's own in-progress radio/free-text state — never derived fresh from `node.children` after the first touch (see `defaultAnswerFor`'s own doc comment for why that matters). */
export interface QuestionAnswer {
  readonly selected: number | undefined
  readonly freeText: string
}

/**
 * Exactly one ticked option seeds a real selection; ZERO or TWO-OR-MORE both
 * seed `undefined` — never "pick the first one" for the multi-tick case,
 * which would render "answered" for a document the server's own
 * `isAnswered`/landing gate both read as unanswered (`ticked.length !== 1`
 * fails immediately). A stale/malformed `node.children` snapshot with two
 * `- [x]` options is the one shape this guards against; the radio UI itself
 * can never produce it once a human is driving the screen.
 */
const singleCheckedIndex = (options: readonly SteeringViewNode[]): number | undefined => {
  const checkedIndices = options
    .map((option, index) => (option.checked === true ? index : undefined))
    .filter((index): index is number => index !== undefined)
  return checkedIndices.length === 1 ? checkedIndices[0] : undefined
}

/** The answer a question STARTS at, read off `node.children`'s own `checked`/`title` fields — used ONLY to seed state the first time a question is ever shown; a caller must persist edits itself from then on (`Plan.tsx`'s own `answers` map), never re-derive this on every render, or an in-progress edit would reset the moment the node prop happens to re-render. */
export const defaultAnswerFor = (node: SteeringViewNode): QuestionAnswer => {
  const options = node.children ?? []
  const lastOption = options[options.length - 1]
  const freeText = lastOption?.checked === true ? lastOption.title : ""
  return { selected: singleCheckedIndex(options), freeText }
}

export interface QuestionProps {
  /** One `qa`-view question node — `children` are its options, the LAST one (by array position, never by label) the free-text slot. */
  readonly node: SteeringViewNode
  /**
   * Fully CONTROLLED: the caller (`Plan.tsx`'s `PlanView`, or a story's own
   * harness) owns this state, keyed per-question, so it survives `Deck`
   * navigating away and back — this component holds no `useState` of its
   * own for the answer. Without this, paging next-then-back through the
   * deck silently discarded whatever the human had just answered, since
   * `Deck`'s `renderItem` remounts a fresh `Question` per index.
   *
   * Accepts a FUNCTIONAL updater as well as a plain value — the same shape
   * React's own `setState` offers, and for the same reason: `Mic` binds its
   * `onAttach` handler once, inside `start()`, so a dictation session ending
   * later calls back into a closure captured at tap-time. A plain value
   * computed from that stale closure's own `answer.freeText` would silently
   * drop anything typed meanwhile; a functional updater instead defers the
   * read of "current text" to WHEN the caller's own `setState` applies it,
   * which sees the true latest state no matter how old the closure calling
   * it is.
   */
  readonly answer: QuestionAnswer
  readonly onAnswerChange: (
    update: QuestionAnswer | ((prev: QuestionAnswer) => QuestionAnswer),
  ) => void
  /**
   * Write-through to the steering file (package 03): the real `Plan`
   * container wires this to `trpc.setValue.mutateAsync` followed by a
   * `readSteeringFile` invalidation, mirroring `Plan.tsx`'s own
   * `onSaveNote`/`onDoneNote` pattern — fired ALONGSIDE `onAnswerChange`
   * (never instead of it), so the controlled local state above still gives
   * instant tap feedback regardless of the write's own latency or outcome.
   * Absent in `Question.stories.tsx`'s/`Plan.stories.tsx`'s pure-data
   * stories, exactly like those two.
   */
  readonly onCommitAnswer?: (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ) => Promise<unknown>
  /** Fires on every refusal a `commitAnchor`-issued write surfaces (package 03's Task 1) — alongside the revert, never instead of it. Absent exactly where `onCommitAnswer` is absent (`Question.stories.tsx`'s pure-data stories). */
  readonly onRefusal?: (error: unknown) => void
}

/**
 * The free-text slot's own textarea plus its embedded `Mic` — dictation
 * writes through to `onDictate` only on a final result, never on interim.
 * `onDictate` (not a `freeText`-closing concatenation here) is what makes
 * this safe against typing DURING an active dictation session: `Mic` binds
 * `onAttach` once, inside `start()`, capturing whatever this component's
 * props were AT THAT RENDER — reading the `freeText` prop directly in the
 * handler below would still see the value from when Dictate was tapped, not
 * whatever was typed since. `onDictate` instead defers the read of "current
 * text" to the PARENT's own functional `setState` updater (`Question.tsx`'s
 * `onDictate`), which always sees the latest state no matter when it fires.
 */
const FreeTextOption = ({
  freeText,
  onFocus,
  onFreeTextChange,
  onDictate,
  onCommit,
}: {
  readonly freeText: string
  readonly onFocus: () => void
  readonly onFreeTextChange: (text: string) => void
  readonly onDictate: (text: string) => void
  /** Fires on blur — the natural "the human is done typing" moment for a textarea — carrying the CURRENT `freeText` prop, never a stale closure: a blur event always fires on a later render than the keystroke that produced the text it commits. */
  readonly onCommit: () => void
}) => {
  const textareaId = useId()
  return (
    <div className="mt-2">
      <label htmlFor={textareaId} className="block text-small text-muted">
        Your answer
      </label>
      <textarea
        id={textareaId}
        data-testid="free-text-input"
        placeholder={FREE_TEXT_PLACEHOLDER}
        value={freeText}
        onFocus={onFocus}
        onChange={(event) => {
          onFreeTextChange(event.target.value)
          onFocus()
        }}
        onBlur={onCommit}
        className="min-h-[60px] w-full"
      />
      <Mic
        onAttach={(text) => {
          onFocus()
          onDictate(text)
        }}
      >
        {(state) => (
          <>
            {state.available ? (
              <Button variant="secondary" data-testid="mic-toggle" onClick={state.toggle}>
                {state.recording ? "Stop" : "Dictate"}
              </Button>
            ) : (
              <p data-testid="mic-hint" className="text-small text-muted">
                Use your keyboard's mic key to dictate
              </p>
            )}
            {state.interim.length > 0 && (
              <p data-testid="mic-interim" className="text-small italic text-muted">
                {state.interim}
              </p>
            )}
          </>
        )}
      </Mic>
    </div>
  )
}

/** One option row — a radio, its label, and (only for the free-text slot) the textarea+mic. */
const OptionRow = ({
  option,
  index,
  questionTitle,
  isFreeText,
  isSelected,
  freeText,
  onSelect,
  onFocusFreeText,
  onFreeTextChange,
  onDictate,
  onCommitFreeText,
}: {
  readonly option: SteeringViewNode
  readonly index: number
  readonly questionTitle: string
  readonly isFreeText: boolean
  readonly isSelected: boolean
  readonly freeText: string
  /** The radio's own click/change — writes through immediately (T4's "selecting an option calls setValue"). */
  readonly onSelect: () => void
  /** The free-text slot's focus/keystroke tracking — LOCAL selection only, never a write; see `Question.tsx#Question`'s `selectLocally` doc comment for why. */
  readonly onFocusFreeText: () => void
  readonly onFreeTextChange: (text: string) => void
  readonly onDictate: (text: string) => void
  readonly onCommitFreeText: () => void
}) => (
  <div data-testid={`option-${index}`} className="border-b border-border py-2">
    <label className="flex items-center gap-2">
      <input
        type="radio"
        name={`question-${questionTitle}`}
        data-testid={`option-radio-${index}`}
        checked={isSelected}
        onChange={onSelect}
      />
      <span>{option.title}</span>
    </label>
    {isFreeText && (
      <FreeTextOption
        freeText={freeText}
        onFocus={onFocusFreeText}
        onFreeTextChange={onFreeTextChange}
        onDictate={onDictate}
        onCommit={onCommitFreeText}
      />
    )}
  </div>
)

/** Debounce delay for the free-text slot's own write-through-without-a-blur (Task 5) — long enough that a fast typist produces one write per pause, not one per keystroke. */
const FREE_TEXT_DEBOUNCE_MS = 800

/**
 * One question, one screen — `Plan.tsx`'s `Deck` `renderItem`. Radio
 * semantics enforced client-side: `selected` holds at most one option index,
 * so picking a new one always replaces rather than adds to it. The free-text
 * option is identified by array position (`options.length - 1`), never by
 * matching its label, so a free-text option with an ordinary-looking label
 * is still treated as the free-text slot.
 */
// fallow-ignore-next-line complexity
export const Question = ({
  node,
  answer,
  onAnswerChange,
  onCommitAnswer,
  onRefusal,
}: QuestionProps) => {
  const options = node.children ?? []
  const lastIndex = options.length - 1
  const { selected, freeText } = answer

  /** Updates `selected` LOCALLY only — never a write. Used for the free-text slot's own focus/keystroke tracking (`onFocusFreeText` below), so merely tapping into (or typing in) the textarea never itself reaches the network: a stray focus-then-blur with nothing typed must change nothing, neither on disk nor in this local state (see `commitFreeText`'s own guard for the write half of that same guarantee). */
  const selectLocally = (index: number) => onAnswerChange((prev) => ({ ...prev, selected: index }))

  /**
   * Per-FIELD write sequence numbers (Task 7) — NOT per-anchor: `selected`
   * is one shared radio slot across every option's own anchor (ticking
   * option 1 supersedes option 0's own in-flight write even though they're
   * different anchors), so keying a revert guard by anchor JSON — the
   * previous scheme — let a stale rejection for option 0 clobber option 1's
   * already-landed tick, exactly the "tick A, tick B, A's write fails, B's
   * tick vanishes too" failure the spec calls out. A REJECTED write now only
   * reverts a FIELD (`selected` or `freeText`) when it's still the latest
   * write that touched that field, whichever anchor issued it. Held in refs
   * (never `useState`): bumping either must never itself trigger a render.
   */
  const selectedSeqRef = useRef(0)
  const freeTextSeqRef = useRef(0)
  const bumpSelectedSeq = (): number => ++selectedSeqRef.current
  const bumpFreeTextSeq = (): number => ++freeTextSeqRef.current

  /** What `commitFreeText` last actually wrote (package 03's Task 6) — seeded from the answer this question STARTS at, so a bare focus-then-blur (nothing typed) still compares equal and writes nothing. Updated to the JUST-COMMITTED text the moment a commit fires (optimistically, like the local state update alongside it), never re-derived from a fresh read. Rolled BACK to its OWN prior value by `commitAnchor`'s own rejection handler (see its doc comment) whenever the `freeText` field's write is refused — otherwise a refused write leaves this ref pointing at text that was never actually written, poisoning the very next retry: Task 6's changed-since-last-commit guard would then compare the retyped text against that never-written value, see no change, and silently skip the write. */
  const lastCommittedFreeTextRef = useRef(freeText)

  /**
   * The one write-through both `setSelected` and `commitFreeText` fire —
   * split out so neither caller's own branching (an out-of-range index, an
   * empty-text guard) also carries the anchor-resolved / anchor-missing
   * split here. Fire-and-forget from the CALLER's perspective, but returns
   * the promise so `commitFreeText`'s own debounce/unmount serialization can
   * track completion. A rejection (a `CONFLICT` refusal, a network failure,
   * …) surfaces via `onRefusal` AND reverts ONLY the fields `reverts` names —
   * each gated by ITS OWN field-level seq, so a stale rejection can never
   * clobber a field a newer write (to any anchor) already changed. Each
   * revert entry's own optional `onReverted` fires in the SAME seq-gated
   * branch as its state update — `commitFreeText` uses it to roll
   * `lastCommittedFreeTextRef` back to its OWN prior value (never the same
   * value as the state field's own revert target, which is the just-typed
   * text itself — see that call site's doc comment). A no-op when `anchor`
   * is `undefined` (an out-of-range index).
   */
  const commitAnchor = (
    anchor: SteeringAnchor | undefined,
    opts: { readonly checked?: boolean; readonly text?: string },
    reverts: ReadonlyArray<{
      readonly field: "selected" | "freeText"
      readonly seq: number
      readonly value: number | string | undefined
      readonly onReverted?: () => void
    }>,
  ): Promise<unknown> | undefined => {
    if (anchor === undefined) return undefined
    return onCommitAnswer?.(anchor, opts)?.catch((error: unknown) => {
      onRefusal?.(error)
      // fallow-ignore-next-line complexity
      onAnswerChange((prev) => {
        let next = prev
        for (const revert of reverts) {
          const currentSeq =
            revert.field === "selected" ? selectedSeqRef.current : freeTextSeqRef.current
          if (currentSeq === revert.seq) {
            next = { ...next, [revert.field]: revert.value }
            revert.onReverted?.()
          }
        }
        return next
      })
    })
  }

  /** An ordinary option's own click: local selection AND an immediate write-through (T4's "selecting an option calls setValue") — never used for the free-text slot's focus tracking, which must stay local-only (`selectLocally`). Touches ONLY `selected` — `freeText` is never part of this write's own revert. */
  const setSelected = (index: number) => {
    const previousSelected = selected
    const seq = bumpSelectedSeq()
    selectLocally(index)
    commitAnchor(options[index]?.anchor, { checked: true }, [
      { field: "selected", seq, value: previousSelected },
    ])
  }

  /** The free-text slot's own anchor, when there is one. */
  const freeTextAnchor = (): SteeringAnchor | undefined =>
    lastIndex >= 0 ? options[lastIndex]?.anchor : undefined

  /**
   * The free-text slot's own commit point — fired on blur AND, since Task 5,
   * on its own 800ms after the last keystroke with no blur at all. Writes
   * the CURRENT `freeText` prop in one call, never split into a separate
   * tick-then-text pair (T3's "both fields together" bullet). The guard
   * moved off "is the text empty" onto "did the text change from what was
   * last committed" (Task 6): a bare focus-then-blur still writes nothing,
   * but DELETING a previously-written answer and blurring now writes the
   * erase (`checked: false, text: ""`) rather than silently leaving stale
   * text on disk while the UI shows empty. Touches BOTH `selected` and
   * `freeText`, each reverted only against its OWN field-level seq — a plain
   * option tap landing/failing independently in between can never be undone
   * by this write's own rejection, and vice versa.
   */
  const commitFreeText = (): Promise<unknown> | undefined => {
    const current = normalizeAnswerText(freeText)
    const lastCommitted = normalizeAnswerText(lastCommittedFreeTextRef.current)
    if (current === lastCommitted) return undefined
    const previousSelected = selected
    const previousFreeText = freeText
    // The ref's own PRIOR value — distinct from `previousFreeText` above
    // (the just-typed text this commit is about to send): on rejection the
    // FIELD reverts to what's already on screen (a no-op, so the human never
    // loses what they typed), but the REF must roll back to what it held
    // before this attempt, or a retry compares against text that was never
    // actually written and silently skips the write (see this ref's own
    // doc comment).
    const previousLastCommitted = lastCommittedFreeTextRef.current
    const anchor = freeTextAnchor()
    lastCommittedFreeTextRef.current = freeText
    const freeTextSeq = bumpFreeTextSeq()
    const selectedSeq = bumpSelectedSeq()
    const reverts = [
      {
        field: "freeText" as const,
        seq: freeTextSeq,
        value: previousFreeText,
        onReverted: () => {
          lastCommittedFreeTextRef.current = previousLastCommitted
        },
      },
      { field: "selected" as const, seq: selectedSeq, value: previousSelected },
    ]
    if (current.length === 0) {
      onAnswerChange((prev) => ({ ...prev, selected: undefined }))
      return commitAnchor(anchor, { checked: false, text: "" }, reverts)
    }
    selectLocally(lastIndex)
    return commitAnchor(anchor, { checked: true, text: freeText }, reverts)
  }

  /**
   * Serializes `commitFreeText` calls so never more than one of its writes is
   * in flight at once (Task 5's "never two writes in flight for one anchor")
   * — a call arriving while one is pending is dropped (not queued with its
   * own stale text): the NEXT trigger (another keystroke's debounce, or
   * blur) always re-reads the CURRENT `freeText` via `commitFreeTextRef`
   * itself, so nothing typed in between is ever lost, just coalesced into
   * one write per pause rather than one per keystroke.
   */
  const commitFreeTextRef = useRef(commitFreeText)
  commitFreeTextRef.current = commitFreeText
  const commitInFlightRef = useRef(false)
  const commitPendingRef = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const runCommitFreeText = (): void => {
    if (commitInFlightRef.current) {
      commitPendingRef.current = true
      return
    }
    commitInFlightRef.current = true
    Promise.resolve(commitFreeTextRef.current()).finally(() => {
      commitInFlightRef.current = false
      if (commitPendingRef.current) {
        commitPendingRef.current = false
        runCommitFreeText()
      }
    })
  }

  const clearDebounceTimer = (): void => {
    if (debounceTimerRef.current !== undefined) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = undefined
    }
  }

  /** Blur's own trigger: commits immediately, cancelling any pending debounce (there is nothing left to wait for). */
  const commitFreeTextOnBlur = (): void => {
    clearDebounceTimer()
    runCommitFreeText()
  }

  /** Every keystroke's own trigger (Task 5): (re)schedules a commit 800ms out, replacing whatever was previously scheduled — a fast typist's intermediate keystrokes never each fire their own write. */
  const scheduleDebouncedCommit = (): void => {
    clearDebounceTimer()
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = undefined
      runCommitFreeText()
    }, FREE_TEXT_DEBOUNCE_MS)
  }

  /**
   * Appends dictated `text` to whatever `freeText` is AT ATTACH TIME —
   * via `onAnswerChange`'s own functional-updater form, never the `answer`
   * prop closed over here. `Mic` binds `onAttach` once, inside `start()`,
   * capturing THIS closure as it existed when Dictate was tapped; if this
   * read `freeText` directly, text typed during an active session would be
   * silently clobbered the moment the session ends (`FreeTextOption`'s own
   * doc comment). The functional updater instead defers that read to
   * whenever the caller's `setState` actually applies it, which always sees
   * the true latest text.
   */
  const onDictate = (text: string) => {
    onAnswerChange((prev) => ({
      ...prev,
      freeText: prev.freeText.length > 0 ? `${prev.freeText} ${text}` : text,
    }))
    scheduleDebouncedCommit()
  }

  /** Typing itself: updates local state immediately (instant feedback) and (re)schedules the debounced write-through (Task 5) — never fires the write itself. */
  const setFreeText = (text: string) => {
    onAnswerChange((prev) => ({ ...prev, freeText: text }))
    scheduleDebouncedCommit()
  }

  /** Unmount commits (Task 5): a pending debounced write flushes immediately rather than being discarded — mirrors `NoteSheet.tsx`'s identical unmount-commit. */
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== undefined) {
        clearDebounceTimer()
        runCommitFreeText()
      }
    }
  }, [])

  /**
   * The SAME `isAnswered` predicate the server enforces (`OpenQuestions.ts`),
   * fed the client's own current radio state rather than re-deriving the
   * rule locally — T5's own "already exists and is the single one enforced"
   * bullet: taking the FIRST checked option and asking only "is it the
   * free-text slot" (this component's earlier logic) diverges from the
   * server's "exactly one ticked" rule the moment two options are ticked at
   * once, which local radio state alone can't produce, but a stale/replayed
   * `node.children` snapshot could.
   */
  const answered = isAnswered(
    options.map((option, index) => ({
      checked: selected === index,
      text: index === lastIndex ? normalizeAnswerText(freeText) : option.title,
      freeText: index === lastIndex,
    })),
  )

  return (
    <div data-testid="question-screen">
      <h2 className="m-0 mb-3 text-large font-semibold">{node.title}</h2>
      <div data-testid="question-status" className="mb-2 text-small text-muted">
        {answered ? "answered" : "unanswered"}
      </div>
      {options.map((option, index) => (
        <OptionRow
          key={index}
          option={option}
          index={index}
          questionTitle={node.title}
          isFreeText={index === lastIndex}
          isSelected={selected === index}
          freeText={freeText}
          onSelect={() => setSelected(index)}
          onFocusFreeText={() => selectLocally(index)}
          onFreeTextChange={setFreeText}
          onDictate={onDictate}
          onCommitFreeText={commitFreeTextOnBlur}
        />
      ))}
    </div>
  )
}
