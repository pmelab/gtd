import { FREE_TEXT_PLACEHOLDER, isAnswered } from "../../OpenQuestions.js"
import type { SteeringViewNode } from "../../SteeringFormat.js"
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
}: {
  readonly freeText: string
  readonly onFocus: () => void
  readonly onFreeTextChange: (text: string) => void
  readonly onDictate: (text: string) => void
}) => (
  <div style={{ marginTop: 8 }}>
    <textarea
      data-testid="free-text-input"
      placeholder={FREE_TEXT_PLACEHOLDER}
      value={freeText}
      onFocus={onFocus}
      onChange={(event) => {
        onFreeTextChange(event.target.value)
        onFocus()
      }}
      style={{ width: "100%", minHeight: 60 }}
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
            <button type="button" data-testid="mic-toggle" onClick={state.toggle}>
              {state.recording ? "Stop" : "Dictate"}
            </button>
          ) : (
            <p data-testid="mic-hint" style={{ fontSize: 12, opacity: 0.7 }}>
              Use your keyboard's mic key to dictate
            </p>
          )}
          {state.interim.length > 0 && (
            <p
              data-testid="mic-interim"
              style={{ fontSize: 12, opacity: 0.6, fontStyle: "italic" }}
            >
              {state.interim}
            </p>
          )}
        </>
      )}
    </Mic>
  </div>
)

/** One option row — a radio, its label, and (only for the free-text slot) the textarea+mic. */
const OptionRow = ({
  option,
  index,
  questionTitle,
  isFreeText,
  isSelected,
  freeText,
  onSelect,
  onFreeTextChange,
  onDictate,
}: {
  readonly option: SteeringViewNode
  readonly index: number
  readonly questionTitle: string
  readonly isFreeText: boolean
  readonly isSelected: boolean
  readonly freeText: string
  readonly onSelect: () => void
  readonly onFreeTextChange: (text: string) => void
  readonly onDictate: (text: string) => void
}) => (
  <div data-testid={`option-${index}`} style={{ padding: "8px 0", borderBottom: "1px solid #333" }}>
    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
        onFocus={onSelect}
        onFreeTextChange={onFreeTextChange}
        onDictate={onDictate}
      />
    )}
  </div>
)

/**
 * One question, one screen — `Plan.tsx`'s `Deck` `renderItem`. Radio
 * semantics enforced client-side: `selected` holds at most one option index,
 * so picking a new one always replaces rather than adds to it. The free-text
 * option is identified by array position (`options.length - 1`), never by
 * matching its label, so a free-text option with an ordinary-looking label
 * is still treated as the free-text slot. Exercised by `Question.stories.tsx`'s
 * `play()` interaction tests — fallow's static CRAP estimate only sees real
 * coverage reports, not Storybook/vitest-browser runs, so it scores this as
 * untested regardless.
 */
// fallow-ignore-next-line complexity
export const Question = ({ node, answer, onAnswerChange }: QuestionProps) => {
  const options = node.children ?? []
  const lastIndex = options.length - 1
  const { selected, freeText } = answer

  const setSelected = (index: number) => onAnswerChange((prev) => ({ ...prev, selected: index }))

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
  const onDictate = (text: string) =>
    onAnswerChange((prev) => ({
      ...prev,
      freeText: prev.freeText.length > 0 ? `${prev.freeText} ${text}` : text,
    }))

  const setFreeText = (text: string) => onAnswerChange((prev) => ({ ...prev, freeText: text }))

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
      <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>{node.title}</h2>
      <div data-testid="question-status" style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
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
          onFreeTextChange={setFreeText}
          onDictate={onDictate}
        />
      ))}
    </div>
  )
}
