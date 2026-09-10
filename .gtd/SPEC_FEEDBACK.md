# Spec feedback — 03 Description channels in the review view

Everything in Tasks 1, 2 and 4 conforms; `npm test` and `npm run test:web` are
green; `src/web/screens/Review.tsx` is untouched in this package's range
(`f6769fb9..HEAD`), so the byte-identical criteria hold.

One Task 3 criterion is not met.

## Task 3, criterion 1 — no test pins "description-only hunk has no `note`"

> a `reviewView` unit test asserts a hunk node carries the author's explanation
> in `detail` and has no `note`, and it fails today

No test in `src/ReviewDoc.test.ts` asserts both halves for a hunk with a
description and NO attached footnote. What exists:

- `#2128`/`#2129` and `#2148`/`#2149` — assert `detail` AND a present `note` (a
  footnote is attached in both fixtures).
- `#2183`/`#2184` — the two-footnote join; `note` is present.
- `#2203` — `note` undefined, but only for the missing-definition case (a marker
  exists), and it asserts nothing about `detail`.

The behaviour the package exists to guarantee — the note textbox opens EMPTY for
a hunk that only carries the author's prose — has no test.

Add a `REVIEW_FORMAT.view` test over a document such as
`- [ ] ./src/calc.ts#1 what this hunk does` with no footnote anywhere, asserting
`children[0].detail === "what this hunk does"` and
`children[0].note === undefined`. It fails against the pre-package code, where
that text landed in `note` and `detail` was absent.
