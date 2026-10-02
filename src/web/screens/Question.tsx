import { useState } from "react"
import { FREE_TEXT_PLACEHOLDER, isAnswered } from "../../steering/index.js"
import type { SteeringAnchor, SteeringViewNode } from "../../steering/index.js"
import { Button } from "../Button.js"
import { NoteSheet } from "../NoteSheet.js"
import type { CasTokens } from "../staleRetry.js"
import { Thread } from "../Thread.js"
import { cellKey, useWriteStore } from "../writeStore.js"
import { ProseBlocks } from "./ProseBlock.js"

/** `""` for an untouched/placeholder-only answer (case-insensitive) — the SAME sentinel and the SAME normalization the completeness gate and the open-questions check both apply server-side (`OpenQuestions.ts#FREE_TEXT_PLACEHOLDER`), redone here so the client never has to round-trip through a write to know if it's answered. */
const normalizeAnswerText = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.toLowerCase() === FREE_TEXT_PLACEHOLDER.toLowerCase() ? "" : trimmed
}

/** The question's own answer shape — one overlay cell holds both halves together (`writeStore.ts#cellKey`'s own "answer" field), so a rollback deletes the pair as one unit, never a tick without its text or vice versa. */
interface QuestionAnswer {
  readonly selected: number | undefined
  readonly freeText: string
}

/**
 * Exactly one ticked option seeds a selection; zero or two-or-more both seed
 * `undefined` — never "pick the first", which would render "answered" for a
 * document the server's own gate reads as unanswered.
 */
const singleCheckedIndex = (options: readonly SteeringViewNode[]): number | undefined => {
  const checkedIndices = options
    .map((option, index) => (option.checked === true ? index : undefined))
    .filter((index): index is number => index !== undefined)
  return checkedIndices.length === 1 ? checkedIndices[0] : undefined
}

/** The answer a question STARTS at, read off `node.children`'s own `checked`/`title` fields — the store's own overlay cell takes over once anything has written through it; this is "the last server-confirmed value" a rollback falls back to. */
const defaultAnswerFor = (node: SteeringViewNode): QuestionAnswer => {
  const options = node.children ?? []
  const lastOption = options[options.length - 1]
  const freeText = lastOption?.checked === true ? lastOption.title : ""
  return { selected: singleCheckedIndex(options), freeText }
}

export interface QuestionProps {
  /** One `qa`-view question node — `children` are its options, the LAST one (by array position, never by label) the free-text slot. */
  readonly node: SteeringViewNode
  /** The file this question's writes target — threads into `writeStore.ts#cellKey` so this question's own answer cell survives `Deck` remounting it on navigation (the store sits above `Deck`, not inside it). */
  readonly filePath: string
  /** Write-through to the steering file — fired alongside the store's own optimistic overlay update, never instead of it. Returns a token-guarded thunk, never a bare promise: the store itself supplies the compare-and-swap tokens at dequeue time. */
  readonly onCommitAnswer?: (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ) => (tokens: CasTokens) => Promise<unknown>
  /** Note overrides keyed by body-block anchor line, so a note saved while drilled into this question shows immediately rather than waiting on a refetch. */
  readonly noteOverrides?: Readonly<Record<number, string>>
  /** Opens the note sheet for one of this question's own body blocks — `ProseBlocks`' own `onOpenNote` prop, passed straight through. */
  readonly onOpenNote?: (node: SteeringViewNode) => void
}

/**
 * The free-text slot's own row. It carries NO field of its own: selecting it
 * opens the same sheet a note uses, and the saved answer then reads back
 * here as the option's value.
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

/** One option's own impacts, rendered under its radio, always. */
const OptionImpacts = ({
  body,
  index,
}: {
  readonly body: readonly SteeringViewNode[] | undefined
  readonly index: number
}) =>
  body !== undefined && body.length > 0 ? (
    <div data-testid={`option-impacts-${index}`} className="pl-8">
      <ProseBlocks nodes={body} noteOverrides={{}} onOpenNote={() => {}} readOnly />
    </div>
  ) : null

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
  readonly onSelect: () => void
  readonly onOpenSheet: () => void
}) => (
  <div
    data-testid={`option-${index}`}
    className={`mx-3 rounded border px-3 py-1 transition-[background-color,border-color] duration-150 ease-out ${
      isSelected ? "border-accent bg-surface" : "border-transparent"
    }`}
  >
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
    <OptionImpacts body={option.body} index={index} />
    {isFreeText && <FreeTextOption freeText={freeText} onOpenSheet={onOpenSheet} />}
  </div>
)

/**
 * One question, one screen — `Plan.tsx`'s `Deck` `renderItem`. The answer
 * (`selected` plus `freeText`) is read straight off the write store's own
 * overlay, keyed by this question's own anchor — no controlled prop, no
 * local `useState`: the store outlives `Deck` remounting this component on
 * navigation, which is the only reason the old controlled-prop design
 * existed at all.
 */
// fallow-ignore-next-line complexity
export const Question = ({
  node,
  filePath,
  onCommitAnswer,
  noteOverrides,
  onOpenNote,
}: QuestionProps) => {
  const options = node.children ?? []
  const lastIndex = options.length - 1
  const answerCell = cellKey(filePath, node.anchor, "answer")

  const overlayAnswer = useWriteStore((s) => s.overlayValue(answerCell)) as
    | QuestionAnswer
    | undefined
  const { selected, freeText } = overlayAnswer ?? defaultAnswerFor(node)
  const save = useWriteStore((s) => s.save)

  const [answerSheetOpen, setAnswerSheetOpen] = useState(false)

  /** The free-text slot's own anchor, when there is one. */
  const freeTextAnchor = (): SteeringAnchor | undefined =>
    lastIndex >= 0 ? options[lastIndex]?.anchor : undefined

  /** An ordinary option's own click: immediate write-through, one cell for the whole question's answer. */
  const setSelected = (index: number) => {
    const anchor = options[index]?.anchor
    if (anchor === undefined) return
    save({
      cell: answerCell,
      optimistic: { selected: index, freeText },
      write: onCommitAnswer === undefined ? undefined : onCommitAnswer(anchor, { checked: true }),
      // The store already files the refusal; nothing else here awaits this.
    }).catch(() => {})
  }

  const openAnswerSheet = () => setAnswerSheetOpen(true)

  /** Fired only by a deliberate Save tap — both fields go in one write, one cell. */
  // fallow-ignore-next-line complexity
  const commitFreeText = (text: string): void => {
    const current = normalizeAnswerText(text)
    const anchor = freeTextAnchor()
    if (anchor === undefined) return
    const checked = current.length > 0
    save({
      cell: answerCell,
      optimistic: { selected: checked ? lastIndex : undefined, freeText: text },
      write:
        onCommitAnswer === undefined
          ? undefined
          : onCommitAnswer(
              anchor,
              checked ? { checked: true, text: current } : { checked: false, text: "" },
            ),
    }).catch(() => {})
  }

  const answered = isAnswered(
    options.map((option, index) => ({
      checked: selected === index,
      text: index === lastIndex ? normalizeAnswerText(freeText) : option.title,
      freeText: index === lastIndex,
    })),
  )

  const freeTextOptionAnchor = freeTextAnchor()

  return (
    <div data-testid="question-screen" className="flex flex-col gap-1 py-3">
      <div
        data-testid="question-status"
        className={`px-3 text-small font-medium ${answered ? "text-heading-c" : "text-warning"}`}
      >
        {answered ? "✓ Answered" : "● Not answered yet"}
      </div>
      <h2 className="m-0 mb-2 px-3 text-large font-semibold">{node.title}</h2>
      {node.thread !== undefined && (
        <div className="px-3 pb-2">
          {onOpenNote !== undefined ? (
            <button
              type="button"
              data-testid="question-thread-open"
              onClick={() => onOpenNote(node)}
              className="w-full rounded border border-divider bg-transparent p-2 text-left text-inherit"
            >
              <Thread thread={node.thread} testId="question-thread" />
            </button>
          ) : (
            <Thread thread={node.thread} testId="question-thread" />
          )}
        </div>
      )}
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
            setAnswerSheetOpen(false)
            commitFreeText(text)
          }}
          onDismiss={() => setAnswerSheetOpen(false)}
        />
      )}
    </div>
  )
}
