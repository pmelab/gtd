import { useState } from "react"
import { FREE_TEXT_PLACEHOLDER } from "../../OpenQuestions.js"
import type { SteeringViewNode } from "../../SteeringFormat.js"
import { Mic } from "../Mic.js"

/** `""` for an untouched/placeholder-only answer (case-insensitive) — the SAME sentinel and the SAME normalization the completeness gate and the open-questions check both apply server-side (`OpenQuestions.ts#FREE_TEXT_PLACEHOLDER`), redone here so the client never has to round-trip through a write to know if it's answered. Comparing against a client-invented hint string here would be a second, divergent copy of that predicate — see T5's own "already exists and is the single one enforced" acceptance bullet. */
const normalizeAnswerText = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.toLowerCase() === FREE_TEXT_PLACEHOLDER.toLowerCase() ? "" : trimmed
}

export interface QuestionProps {
  /** One `qa`-view question node — `children` are its options, the LAST one (by array position, never by label) the free-text slot. */
  readonly node: SteeringViewNode
}

/** The free-text slot's own textarea plus its embedded `Mic` — dictation writes through to `onFreeTextChange` only on a final result, never on interim. */
const FreeTextOption = ({
  freeText,
  onFocus,
  onFreeTextChange,
}: {
  readonly freeText: string
  readonly onFocus: () => void
  readonly onFreeTextChange: (text: string) => void
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
        onFreeTextChange(freeText.length > 0 ? `${freeText} ${text}` : text)
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
}: {
  readonly option: SteeringViewNode
  readonly index: number
  readonly questionTitle: string
  readonly isFreeText: boolean
  readonly isSelected: boolean
  readonly freeText: string
  readonly onSelect: () => void
  readonly onFreeTextChange: (text: string) => void
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
      <FreeTextOption freeText={freeText} onFocus={onSelect} onFreeTextChange={onFreeTextChange} />
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
 * `play()` tests; see `Fleet.tsx#FleetView`'s note on why fallow's static
 * CRAP estimate scores it as untested regardless.
 */
// fallow-ignore-next-line complexity
export const Question = ({ node }: QuestionProps) => {
  const options = node.children ?? []
  const lastIndex = options.length - 1

  const [selected, setSelected] = useState<number | undefined>(() => {
    const checkedIndex = options.findIndex((option) => option.checked === true)
    return checkedIndex === -1 ? undefined : checkedIndex
  })
  const [freeText, setFreeText] = useState<string>(() => {
    const option = options[lastIndex]
    return option?.checked === true ? option.title : ""
  })

  const answered =
    selected !== undefined && (selected !== lastIndex || normalizeAnswerText(freeText).length > 0)

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
        />
      ))}
    </div>
  )
}
