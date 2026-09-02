# Spec feedback — 03 `gtd lsp` writes and navigates footnotes

Two unmet items. Everything else in the spec checks out: the seam widening, the
marker-column rule, name generation, placement in all three block kinds,
resolution order, orphan handling, the integration scenarios, `npm test`, and
`npm run format:check`.

## 1. Only one jump direction is covered in `src/Lsp.test.ts`

`src/Lsp.test.ts` adds exactly one `service.definition` footnote test
("definition on a footnote marker jumps within the SAME document"), i.e. marker
→ definition. There is no fake-environment test for definition → first marker,
and none for an orphan marker or orphan definition returning `[]`.

The direction and the orphan cases ARE covered — but only at the
`footnotePointerAt` unit level (`src/Footnotes.test.ts`) and over real stdio
(`tests/integration/features/lsp.feature`). Neither is the fake environment the
criterion names, and neither exercises the `pointer.character` →
`Location.range.start.character` hand-off through `makeSteeringLanguageService`.

Add to `src/Lsp.test.ts`, against the existing `fakeEnv`:

- cursor on a definition line → a `Location` in the same document's URI at the
  first marker's line AND its exact non-zero column
- an orphan marker and an orphan definition → `[]`, no throw

## 2. `SteeringFormat.ts`'s `pointerAt` doc is now false

`src/SteeringFormat.ts`, the `SteeringFormat` interface doc comment:

> `pointerAt` is absent for a format with nothing to jump to (`qa` has none;
> `review` does).

`QA_FORMAT` now sets `pointerAt` (Task 3: "`qa` gains a `pointerAt` it never
had"). The parenthetical is wrong as written, in a file Task 1 already touches.
Restate it as: absent for a format with nothing to jump to, and both built-ins
now have one — `qa` for footnotes only, `review` for footnotes plus its hunk
jump.
