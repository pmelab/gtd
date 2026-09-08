# Spec feedback — 01-gtd-ui-command

One gap. Everything else in the package checks out: the `git mv` to `src/ui/`
with all importers followed, `needsOf("ui") === "state"`, the six-entry
`standaloneKinds` pin, every flag `scope`/`scopeError`, the reworded `--port`
help, the `ui:` config key and types, `schema.json` carrying `ui` and no
`serve`, both docs pins, the inverted non-repo scenario, and a green `npm test`.

## The `serve:` → `ui:` rejection pair is untested

The spec asks for it twice — once as a task checkbox ("A config file carrying
`serve:` fails to decode at exit 2, and the same file under `ui:` decodes") and
once in Acceptance ("a config file with `serve:` fails to decode where `ui:`
succeeds"). No test asserts it.

What exists instead:

- `src/Config.test.ts:390` pins unknown-top-level-key rejection generically,
  using `testCommand`, not `serve`
- `src/Config.test.ts:185`/`:209`/`:224`/`:243` and
  `src/ConfigSchema.test.ts:126`+ cover `ui:` decoding, but never the paired
  refusal of the old key

The behaviour holds today by the generic excess-property path, so this is a
missing regression guard, not a live bug: nothing reds if someone later
re-admits `serve:` as an accepted alias.

Fix: one test writing `.gtdrc.yaml` with `serve:` and the same body under `ui:`,
asserting the first fails (exit 2 / decode error naming `serve`) and the second
decodes. `src/Config.test.ts` is the natural home — it already writes real
`.gtdrc.yaml` files and asserts `GtdError.detail`.
