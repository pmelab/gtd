# Spec feedback — package 1

One blocking defect. Everything else in the package checks out: `--json`'s
optional arity, the `JsonMode` dispatch, the present-with-`undefined` refactor,
the prose default, the e2e feature and the parity re-expression all match the
spec, and the full suite (including the new `@live`
`gtd land --json=script | sh` scenario) is green.

## Blocking — `selectPath` resolves INHERITED and array-builtin keys as values, so an unknown selector can exit 0 with garbage

`src/Select.ts`'s `resolveSegment` tests key presence with the `in` operator,
which walks the prototype chain, and for arrays it only rejects all-digit
segments. Every non-document key that happens to exist on
`Object.prototype`/`Array.prototype` therefore resolves to a `value` instead of
`unknown`.

Verified against the real `selectPath` with
`fields = { kind: "message", changes: [{ path: "a" }] }`:

- `constructor` → `value` `function Object() { [native code] }`
- `toString` → `value` `function toString() { [native code] }`
- `hasOwnProperty` → `value` `function hasOwnProperty() { [native code] }`
- `valueOf` → `value` `function valueOf() { [native code] }`
- `changes.length` → `value` `1`
- `changes.map` → `value` `function map() { [native code] }`

So `gtd next --json=constructor` prints a JS function body to stdout and exits
**0**. This violates three settled points of the spec at once:

- Task 1: "`selectPath` returns `unknown` for a key that is missing from the
  object" — `constructor` is missing from the document; it is inherited, not
  own.
- Settled decisions: "The grammar is a dotted key path using the document's own
  key names verbatim" and "An unknown selector is a usage error, exit 2."
- The driver-facing point of the exit-2 rule: a driver's typo must fail loudly.
  Today a typo landing on any prototype member silently yields a value, and a
  driver consuming it can't tell it from a real field.

Fix direction: make presence an **own-property** test —
`Object.prototype.hasOwnProperty.call(record, segment)` for the object branch,
and in the array branch return `NOT_FOUND` for every segment (all-digit ones are
already rejected, and there is no non-index array key the document declares).
Add `src/Select.test.ts` cases pinning `unknown` for at least `constructor`,
`toString`, `changes.length` and `changes.map` — otherwise the next reader
reintroduces `in`.

## Minor — the select branch is duplicated verbatim in `program.ts`

`runNextCommand` and `runLandCommand` each carry the same 11-line `selectPath` →
`value`/`unknown` block, including the same
`gtd: unknown --json selector "..." — see \`gtd
--help\``message literal in two places. Nothing in the spec forbids it, but the message is a driver-visible string and two copies drift. Consider one small local helper (e.g.`writeSelection(out,
built, path)`) returning the effect both call. Optional — fold it in only while
fixing the blocker above.
