# Spec feedback — 04 steering screens and dictation

## The question deck can advance into an answered question, which then renders as "unanswered"

`src/web/screens/Plan.tsx`'s deck is fed `view.nodes.filter(isQuestionNode)` —
open AND answered questions, in document order. Only the CARD path is guarded:
`QuestionSection` passes no `onOpen` for the answered section, and
`QuestionCard`'s doc comment states exactly why ("drilling into `Question.tsx`
for one renders zero options, an empty `lastIndex`, and — worse — recomputes
'unanswered' from that empty state, contradicting the very section the card came
from"). The deck path defeats that guard.

Reproduction with a real `qa` document that has one open and one answered
question: tap the open question's card, then tap `deck-next`. `Deck.tsx`
advances to index 1, which is the answered node.
`src/OpenQuestions.ts#parseQuestionBlock` gives every answered question
`options: []` (`status === "open" ? parseOptions(...) : []`), so `Question.tsx`
renders `options.length - 1 === -1`, no option rows at all, and `isAnswered([])`
returns `false` (`ticked.length !== 1`) — the screen prints
`question-status: unanswered` for a question the list just showed under "Already
answered".

Fix direction (pick one, not both): feed the deck only the open questions and
map the card index into that filtered list, or have `Question.tsx` render an
answered, option-less node as its own read-only summary instead of recomputing
the predicate from an empty option list.

No story covers deck navigation past the last OPEN question —
`AnAnsweredCardIsNotDrillable` only covers the card path. A fix needs one that
does.
