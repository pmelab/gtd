# Spec feedback — 01-serve-and-client-harness

Fresh pass over `64dd325f` → working tree, verified live, not by reading tests.

Last round's item is genuinely fixed. `.gtdrc` =
`serve:\n  bogus: 1\n  port: 9443` now prints exactly one clause
(`Invalid gtd config: serve.bogus: is unexpected, expected: "roots" | "port" | …`)
and `serve:\n  port: "nope"` prints exactly one
(`serve.port: Expected number, actual "nope"`); no `Expected undefined` in
either, and `src/Config.test.ts` now pins the whole message plus a
`not.toContain("Expected undefined")` guard, so the noise cannot return
silently.

Also verified this round: `npm test` fully green (10/10 turbo tasks);
`npx vitest run --project storybook` really launches headless chromium and runs
`src/web/App.stories.tsx` (1 test, 43 ms); `test:web` has all three of a script,
a `turbo.json` task with `inputs` = `src/web/**` + `.storybook/**` +
`vitest.config.ts`, and its name in `test`'s list, and re-runs FULL TURBO
cached; `storybook dev --host 0.0.0.0` is the script, so the catalog is
phone-reachable; CI installs chromium explicitly; no client file is in
`stryker.config.json`'s `mutate`; `scripts/generate-schema.ts` is unchanged and
`schema.json` carries a `serve` object with a non-empty description;
`ConfigSchema.ts` imports only `effect` and `./StateFields.js` — no `.yaml`
asset; `@trpc/server` is the lone new `dependencies` entry. Live from a
**non-repository** temp dir: bad config exits 1, `serve --bogus` exits 2, bare
`serve` with no tailnet exits 1 naming both remedies;
`serve --host 127.0.0.1 --port 18651 --self-signed --dev` printed the `https://`
URL on its own line then the QR code, served 200, and after `sed`-editing
`src/web/App.tsx` the very next request returned the edited text with **no
rebuild** — T5's last criterion, confirmed.

One problem, a one-line edit.

## 1. `src/Config.ts:312` — two stacked doc comments, both now on the wrong symbol

The fix turn inserted its new JSDoc block between the pre-existing
`formatSchemaError` doc comment and the code, leaving this at lines 312–328:

```
/**
 * The offending top-level key(s) plus which config LAYER last set each one.
 * `keyOrigin` maps a key to the innermost level's `filepath` that declared it …
 */
/**
 * `Schema.optional(SomeStruct)` decodes as a union with `undefined` … (12 lines)
 */
const isOptionalUndefinedArtifact = …
```

Both blocks now attach to `isOptionalUndefinedArtifact`, a two-line predicate
that has nothing to do with `keyOrigin` or config layers, and
`formatSchemaError` — the function the first block describes, 20 lines below —
is left undocumented. A reader (and any JSDoc-consuming tooling) is told the
opposite of the truth about both symbols.

Fix: move the `keyOrigin`/config-LAYER block back down to immediately above
`const formatSchemaError`, leaving the `Schema.optional` block above
`isOptionalUndefinedArtifact`. While there, cut the `Schema.optional` block to
the decision and its reason — 12 lines for a two-line
`message.startsWith("Expected undefined, actual")` predicate is longer than the
fact allows, and its last sentence ("keeps this filter honest for a nested
optional struct this repo doesn't have yet") documents a case that does not
exist.

Nothing else. No test, no behavior, no doc, no spec criterion is affected.
