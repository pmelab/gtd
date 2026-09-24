import { useRef, useState } from "react"
import { FREE_TEXT_PLACEHOLDER, isAnswered } from "../../steering/index.js"
import type { SteeringAnchor, SteeringViewNode } from "../../steering/index.js"
import { Button } from "../Button.js"
import { NoteSheet } from "../NoteSheet.js"
import { ProseBlocks } from "./ProseBlock.js"

/** `""` for an untouched/placeholder-only answer (case-insensitive) — the SAME sentinel and the SAME normalization the completeness gate and the open-questions check both apply server-side (`OpenQuestions.ts#FREE_TEXT_PLACEHOLDER`), redone here so the client never has to round-trip through a write to know if it's answered. Comparing against a client-invented hint string here would be a second, divergent copy of that predicate — see T5's own "already exists and is the single one enforced" acceptance bullet. */
const normalizeAnswerText = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.toLowerCase() === FREE_TEXT_PLACEHOLDER.toLowerCase() ? "" : trimmed
}

/** One question's own in-progress radio selection — never derived fresh from `node.children` after the first touch (see `defaultAnswerFor`'s own doc comment for why that matters). The free-text draft is NOT part of this (package 03 Task 3): it lives in `Question`'s own local `useState`, so it dies with the component instead of surviving in the parent's `answers` map. */
export interface QuestionAnswer {
  readonly selected: number | undefined
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

/** The answer a question STARTS at, read off `node.children`'s own `checked`/`title` fields — used ONLY to seed state the first time a question is ever shown; a caller must persist `selected` edits itself from then on (`Plan.tsx`'s own `answers` map), never re-derive this on every render, or an in-progress edit would reset the moment the node prop happens to re-render. Returns `freeText` too (beyond `QuestionAnswer`'s own shape) — `Question`'s own local draft state (package 03 Task 3) seeds from it directly. */
export const defaultAnswerFor = (
  node: SteeringViewNode,
): { readonly selected: number | undefined; readonly freeText: string } => {
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
   * React's own `setState` offers, and for the same reason: the
   * refusal-revert sequence (`commitAnchor`'s `.catch`, below) fires after an
   * awaited write, so it must read "current answer" no earlier than the
   * moment it actually applies — a plain value computed at commit time would
   * silently clobber whatever was typed while that write was in flight. A
   * functional updater instead defers the read of "current text" to WHEN the
   * caller's own `setState` applies it, which sees the true latest state no
   * matter how old the closure calling it is.
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
  /**
   * The question's own body's note overrides, keyed by each body block's
   * `paragraph` anchor line — the SAME shape `Plan.tsx#PlanView` already
   * keeps for the list screen's own prose (`noteOverrides`), threaded down
   * here so a note saved on a body block while drilled into this question
   * shows up immediately, without waiting on a `readSteeringFile` refetch.
   * Defaults to `{}` so `Question.stories.tsx`'s pure-data stories (and any
   * question with no body) never have to pass one.
   */
  readonly noteOverrides?: Readonly<Record<number, string>>
  /**
   * Opens the note sheet for one of this question's own body blocks —
   * `ProseBlocks`' own `onOpenNote` prop, passed straight through. Absent
   * exactly where `onCommitAnswer` is (`Question.stories.tsx`'s pure-data
   * stories): with no write path, there's nothing for a saved note to write
   * through to either.
   */
  readonly onOpenNote?: (node: SteeringViewNode) => void
}

/**
 * The free-text slot's own row. It carries NO field of its own: selecting it
 * opens the same sheet a note uses, and the saved answer then reads back
 * here as the option's value. A textarea living inline under one radio in a
 * list of radios competed with the options it belonged to, and its own Save
 * button was a second, differently-shaped commit beside a list where every
 * other choice commits on tap.
 */
const FreeTextOption = ({
  freeText,
  onOpenSheet,
}: {
  readonly freeText: string
  readonly onOpenSheet: () => void
}) => (
  <div className="pb-1 pl-8">
    <Button
      variant="ghost"
      data-testid="free-text-value"
      onClick={onOpenSheet}
      className="w-full px-0 text-left text-small font-normal text-muted"
    >
      {freeText.trim().length > 0 ? freeText : "Tap to write your answer"}
    </Button>
  </div>
)

/** One option row — a radio, its label, and (only for the free-text slot) the textarea. */
const OptionRow = ({
  option,
  index,
  questionTitle,
  isFreeText,
  isSelected,
  freeText,
  onSelect,
  onOpenSheet,
}: {
  readonly option: SteeringViewNode
  readonly index: number
  readonly questionTitle: string
  readonly isFreeText: boolean
  readonly isSelected: boolean
  readonly freeText: string
  /** The radio's own click/change — writes through immediately (T4's "selecting an option calls setValue"), except for the free-text slot, whose answer is not known until the sheet it opens is saved. */
  readonly onSelect: () => void
  /** Opens the answer sheet — fired both by selecting the free-text slot and by tapping its value to edit it. */
  readonly onOpenSheet: () => void
}) => (
  <div
    data-testid={`option-${index}`}
    className={`mx-3 rounded border px-3 py-1 transition-[background-color,border-color] duration-150 ease-out ${
      isSelected ? "border-accent bg-surface" : "border-transparent"
    }`}
  >
    {/* The chosen option is marked by the radio AND by this row's own
        surface + accent boundary — a filled radio dot alone is a ~6px cue
        on a phone held at arm's length. */}
    <label className="flex min-h-11 items-center gap-3">
      <input
        type="radio"
        name={`question-${questionTitle}`}
        data-testid={`option-radio-${index}`}
        checked={isSelected}
        onChange={onSelect}
      />
      <span className={isSelected ? "font-medium" : undefined}>{option.title}</span>
    </label>
    {isFreeText && <FreeTextOption freeText={freeText} onOpenSheet={onOpenSheet} />}
  </div>
)

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
  noteOverrides,
  onOpenNote,
}: QuestionProps) => {
  const options = node.children ?? []
  const lastIndex = options.length - 1
  const { selected } = answer

  /**
   * The free-text draft (package 03 Task 3) — NOT in the caller's `answer`
   * map: seeded once from this question's own starting text and otherwise
   * untouched by any prop, so it dies the moment `Deck` remounts a fresh
   * `Question` for a different index, rather than surviving navigation like
   * `selected` does. This inverts the fully-controlled design `QuestionAnswer`
   * otherwise keeps — deliberately, since "types, navigates away, returns,
   * box is empty" is only true if the draft dies with the component.
   */
  const [freeText, setFreeTextState] = useState(() => defaultAnswerFor(node).freeText)
  const [answerSheetOpen, setAnswerSheetOpen] = useState(false)

  /** Updates `selected` LOCALLY only — never a write. Used for the free-text slot's own focus/keystroke tracking (`onFocusFreeText` below), so merely tapping into (or typing in) the textarea never itself reaches the network: a stray focus-then-blur with nothing typed must change nothing, neither on disk nor in this local state. */
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

  /**
   * The one write-through both `setSelected` and `commitFreeText` fire —
   * split out so neither caller's own branching (an out-of-range index) also
   * carries the anchor-resolved / anchor-missing split here. A rejection (a
   * `CONFLICT` refusal, a network failure, …) surfaces via `onRefusal` AND
   * reverts ONLY the fields `reverts` names — each gated by ITS OWN
   * field-level seq, so a stale rejection can never clobber a field a newer
   * write (to any anchor) already changed. `selected` reverts through the
   * caller-owned `answer` map; `freeText` reverts through this component's
   * own local state (package 03 Task 3 moved it out of `answer`). A no-op
   * when `anchor` is `undefined` (an out-of-range index).
   */
  const commitAnchor = (
    anchor: SteeringAnchor | undefined,
    opts: { readonly checked?: boolean; readonly text?: string },
    reverts: ReadonlyArray<
      | { readonly field: "selected"; readonly seq: number; readonly value: number | undefined }
      | { readonly field: "freeText"; readonly seq: number; readonly value: string }
    >,
  ): Promise<unknown> | undefined => {
    if (anchor === undefined) return undefined
    // fallow-ignore-next-line complexity
    return onCommitAnswer?.(anchor, opts)?.catch((error: unknown) => {
      onRefusal?.(error)
      for (const revert of reverts) {
        if (revert.field === "selected") {
          if (selectedSeqRef.current !== revert.seq) continue
          onAnswerChange((prev) => ({ ...prev, selected: revert.value }))
        } else {
          if (freeTextSeqRef.current !== revert.seq) continue
          setFreeTextState(revert.value)
        }
      }
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

  /**
   * Selecting the free-text slot writes nothing and ticks nothing — there is
   * no answer yet to write, and a radio left ticked after the sheet is
   * cancelled would claim an answer that does not exist. It only opens the
   * sheet; saving there is what ticks the slot and writes (`commitFreeText`),
   * and an empty save unticks it again. Tapping the value shown on the slot
   * reopens the same sheet for editing.
   */
  const openAnswerSheet = () => setAnswerSheetOpen(true)

  /** The free-text slot's own anchor, when there is one. */
  const freeTextAnchor = (): SteeringAnchor | undefined =>
    lastIndex >= 0 ? options[lastIndex]?.anchor : undefined
  const freeTextOptionAnchor = freeTextAnchor()

  /**
   * The free-text slot's own commit point — fired ONLY by a deliberate tap
   * on the Save button (package 03 Task 3), never on type, blur, or unmount.
   * Writes the CURRENT `freeText` state in one call, never split into a
   * separate tick-then-text pair (T3's "both fields together" bullet). An
   * explicit tap always writes — there is no changed-since-last-commit guard
   * to skip a no-op save. Touches BOTH `selected` and `freeText`, each
   * reverted only against its OWN field-level seq — a plain option tap
   * landing/failing independently in between can never be undone by this
   * write's own rejection, and vice versa.
   */
  const commitFreeText = (text: string = freeText): Promise<unknown> | undefined => {
    const current = normalizeAnswerText(text)
    const previousSelected = selected
    const previousFreeText = freeText
    const anchor = freeTextAnchor()
    const freeTextSeq = bumpFreeTextSeq()
    const selectedSeq = bumpSelectedSeq()
    const reverts = [
      { field: "freeText" as const, seq: freeTextSeq, value: previousFreeText },
      { field: "selected" as const, seq: selectedSeq, value: previousSelected },
    ]
    if (current.length === 0) {
      onAnswerChange((prev) => ({ ...prev, selected: undefined }))
      return commitAnchor(anchor, { checked: false, text: "" }, reverts)
    }
    selectLocally(lastIndex)
    return commitAnchor(anchor, { checked: true, text }, reverts)
  }

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
    <div data-testid="question-screen" className="flex flex-col gap-1 py-3">
      {/* This screen renders inside `Deck`'s own unpadded scroll container,
          so its gutter has to come from here — without it every line of the
          question ran to the bezel. */}
      <div
        data-testid="question-status"
        className={`px-3 text-small font-medium ${answered ? "text-heading-c" : "text-warning"}`}
      >
        {answered ? "✓ Answered" : "● Not answered yet"}
      </div>
      <h2 className="m-0 mb-2 px-3 text-large font-semibold">{node.title}</h2>
      {node.body !== undefined && node.body.length > 0 && (
        <ProseBlocks
          nodes={node.body}
          noteOverrides={noteOverrides ?? {}}
          onOpenNote={onOpenNote ?? (() => {})}
        />
      )}
      {options.map((option, index) => (
        <OptionRow
          key={index}
          option={option}
          index={index}
          questionTitle={node.title}
          isFreeText={index === lastIndex}
          isSelected={selected === index}
          freeText={freeText}
          onSelect={() => (index === lastIndex ? openAnswerSheet() : setSelected(index))}
          onOpenSheet={openAnswerSheet}
        />
      ))}
      {answerSheetOpen && freeTextOptionAnchor !== undefined && (
        <NoteSheet
          anchor={freeTextOptionAnchor}
          title="Your answer"
          label="Answer text"
          note={freeText}
          onSave={(_anchor, text) => {
            setFreeTextState(text)
            setAnswerSheetOpen(false)
            commitFreeText(text)
          }}
          onDismiss={() => setAnswerSheetOpen(false)}
        />
      )}
    </div>
  )
}
