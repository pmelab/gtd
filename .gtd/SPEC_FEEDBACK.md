# Spec feedback — 04 steering screens and dictation

T2, T5, T6, T7 hold. The problems below are in T3, T4, T8, T1 and the task
graph.

## 1. `src/serve/Diff.ts:146` diffs `base..HEAD`; T3 says base against the working tree

```
git diff ${base} HEAD -- ${quotedPath}
```

T3 says "run a diff of the review base against the working tree for that one
path". Requirement 3 in the same package says "diff of `base..HEAD`". The spec
contradicts itself and nothing in the repo records a decision. Pick one, state
it, and fix whichever side loses.

Independent of that choice, two comments already disagree with each other and
one of them is false today:

- `src/serve/Router.ts:296` — "a `git diff` of that base against the working
  tree". False against the code as written.
- `src/serve/Diff.ts:116` — "diffs it against `HEAD` — never the working tree".

Under `base..HEAD`, a hunk pointer at a file the human has edited but not
committed resolves against stale content. Say so in the comment if that is the
accepted trade.

## 2. `src/serve/Diff.ts:95-97` selects a hunk for a line that hunk does not contain

```ts
if (hunk.newLines === 0) return line === hunk.newStart
```

A count of 0 means the post-image range is empty. Verified against real git: a
mid-file deletion emits `@@ -5,2 +4,0 @@`, and post-image line 4 is an untouched
line _before_ the deletion. Pointing at it returns `kind: "hunk"` for a hunk
whose range is empty, where T3 mandates the whole-file fallback and its banner.

`src/serve/Diff.test.ts:238-251` pins the wrong behaviour as intended.
`src/serve/Diff.ts:163-169`'s `line === 0` short-circuit exists only to paper
over the deleted-whole-file instance of the same bug; drop the `newLines === 0`
branch and that workaround goes with it.

Reachability is low under default `-U3` context — but the branch is wrong and
the test locks it in.

## 3. `src/serve/Diff.ts:174-177` — a stale pointer renders the empty screen T3 forbids

`git diff <base> HEAD -- 'old/path.ts'` exits 0 with empty stdout when the path
carries no change in the range (stale pointer, renamed or moved file).
`parseUnifiedDiff` yields `hunks: []`, `resolveDiff` returns `whole-file` with
nothing in it, and `src/web/screens/Hunk.tsx:104-113` paints the banner over
zero lines — banner plus blank body.

T3's own words: "the screen shows that path's whole diff behind a banner ...
rather than an empty deck". There is no whole diff to show here. This case needs
its own stated result ("this path has no changes in the range"), and a test —
neither `Diff.test.ts` nor `Hunk.stories.tsx` covers an empty diff.

Finding 1 widens this: under `base..HEAD` an uncommitted edit lands here too.

## 4. `src/serve/Diff.test.ts` — the omitted-count hunk header is untested

`src/serve/Diff.ts:50` correctly defaults `newLines` to 1 for the `@@ -1 +5 @@`
form, but every fixture uses explicit counts. Regressing that ternary to
`Number(match[2])` yields `NaN`, turns every such pointer into a silent
whole-file fallback, and the suite stays green.

## 5. `src/web/screens/Review.tsx:38-46, 245-247` — dead `diffs` seam with a false comment

The JSDoc claims "`Review.stories.tsx` drives every diff shape (whole-file
banner, binary, refused) with plain pre-resolved data". No story passes `diffs`
(grep across `src/web`, `src/serve` finds only the declaration and its
plumbing). Those shapes are covered in `Hunk.stories.tsx:154,176,203,221`
instead, and `Review.stories.tsx:284` says so in its own comment. So
`if (diffs !== undefined)` is unexercised code kept alive by a comment
describing tests that do not exist — delete the prop and the comment.

Related: the Review stories pass neither `diffs` nor `worktreePath`, so they
fall to `Review.tsx:251` and render "Loading diff…" forever. That is the seam
actually in use; nothing says so.

## 6. `src/web/Deck.stories.tsx:34-49` — T1's defining bullet is unpinned

"the deck shows exactly one item per screen" has no assertion.
`AdvancingThroughItems` only does `getByText("two")` / `getByText("three")`
after each click; it never asserts the previous item is gone. A mutant that
renders `items.map(renderItem)` — every item stacked — passes this story and
passes the `3 / 3` progress check too. No other story covers it.

## 7. `src/web/Highlight.test.ts:63-66` — "visually distinguishable" tested as three strings

The assertion is
`new Set([lineKind("+a"), lineKind("-a"), lineKind(" a")]).size === 3` — three
distinct kind _strings_. The paint lives in `src/web/screens/Hunk.tsx:26-35`'s
`LINE_BACKGROUND`, and nothing asserts its values differ: setting
`add: "transparent"` (identical to `context`) keeps the suite green.
`Hunk.stories.tsx:239-262` already proves token colors are really painted; do
the same for line kinds.

## 8. `src/web/Highlight.test.ts:100-112` — the escaping property rests on nothing

The test asserts markup survives **unescaped** in token text, which correctly
describes the design (React escapes text nodes on render). But that makes the
whole safety property depend on `src/web/screens/Hunk.tsx:64-74` rendering
`{token.text}` as a child, and nothing pins that. Swapping in
`dangerouslySetInnerHTML={{__html: token.text}}` is a live XSS and passes every
test in the repo. Add a story that puts markup in a diff line and asserts it
renders as inert text.

## 9. `src/web/Card.stories.tsx:98-106` — the 390 px check is close to tautological

The harness at `Card.stories.tsx:46` hardcodes `style={{ maxWidth: 390 }}` on
the very element whose `scrollWidth <= 390` is then asserted, over three short
words that could not overflow. The deck — the other half of "the shell" T1 names
— is never measured at 390 px at all.

## 10. `turbo.json:84` — `test:web` inputs are under-declared, so a stale green is cacheable

```json
"inputs": ["src/web/**", ".storybook/**", "vitest.config.ts"]
```

`src/web` value-imports runtime code from outside that glob:

- `src/web/screens/Question.tsx:1` — `isAnswered`, `FREE_TEXT_PLACEHOLDER` from
  `src/OpenQuestions.ts`
- `src/web/screens/Hunk.tsx`, `Review.tsx` — `src/serve/Diff.ts`
- `src/web/screens/Fleet.tsx` — `src/serve/Fleet.ts`, `src/serve/Beat.ts`
- several files — `src/SteeringFormat.ts`

Change the answeredness predicate and `test:web` replays a cached green. This is
exactly the failure AGENTS.md names under "Task graph and caching".

Also note `src/web/generated.html` is a `build` output (`turbo.json:9`) that
sits inside `test:web`'s own input glob, so every build busts that cache
spuriously.

## 11. `src/web/screens/Review.stories.tsx:135-138` — un-tick at depth is not asserted (minor)

The un-tick story asserts only the two depth-1 hunks; the nested hunk at deck
position 3 is never checked. "un-ticking a chunk un-ticks every hunk in it" is
implied by shared code with the tick path, not asserted.
