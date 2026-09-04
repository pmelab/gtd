# Spec feedback — 01-serve-and-client-harness

Range re-inspected: `64dd325f` → working tree, fresh pass. The previous round's
four problems are all fixed: `.storybook/**` is in `lint`'s `inputs`,
`serve.feature` is `@inmem` with `pickBindHostFromSystem` mocked in a shared
setup file, `tests/vitest.ensureWebClient.ts` builds the generated HTML on first
resolution (covering `test:mutation` and a bare `test:unit`), and the
`serve.loop` schema description no longer promises Eta.

Verified green here:
`npx turbo run format:check typecheck lint lint:sh test:unit test:e2e:inmem test:e2e:live test:web deadcode --force`
(10/10, no cache), `turbo run test:web` a second time is FULL TURBO, a node-side
file using `document` fails `tsc --noEmit` while the same file under `src/web/`
passes `-p src/web/tsconfig.json`, `fallow` reports 0 dead of 169, and a real
`gtd serve` from a non-repo `/tmp` dir refuses with both remedies at exit 1.

Four problems remain — all narrower than the last round's.

## 1. T1's "exit 2" criterion is not met: an unknown `serve:` sub-key exits 1

T1's second criterion: "an unknown sub-key under `serve:` is a decode failure at
**exit 2**". Measured on the built bundle:

```
cd /tmp/sv && printf 'serve:\n  bogus: true\n' > .gtdrc.yaml
node dist/gtd.bundle.mjs serve   # -> exit 1
```

The decode failure itself is correct
(`serve.bogus: is unexpected, expected: "roots" | "port" | ...`), and 1 is what
every other invalid-config error in this repo already exits with — an unknown
TOP-level key exits 1 too. So the code is consistent and the criterion is the
odd one out; T9's own criterion ("a bad flag is exit 2") lists no config-decode
case at 2 either.

Resolve it deliberately, not silently: either route `serve:` decode failures to
`EXIT_USAGE_ERROR` (and accept that it diverges from every other config error),
or record the deviation at the code the way `ServeSchema`'s
`Struct`-instead-of-`Unknown` deviation already is. Right now a reader comparing
spec to behaviour finds an unexplained mismatch.

## 2. The QR code is never asserted to encode the printed URL — the test's name claims it does

T4's criterion: "start prints the `https://` URL on its own line, then a QR code
**encoding that exact URL**". `src/serve/Server.test.ts:260` is titled "prints
the https:// URL on its own line, then a QR code encoding that exact URL", but
its only QR assertion is:

```
expect(written[1]).toContain("\n")
```

That passes for ANY multi-line string. Swap `renderQrCode(url)` in `Server.ts`
for `renderQrCode(host)`, or for a hardcoded
`renderQrCode("https://example.com/")`, and both this test and
`src/serve/Qr.test.ts` (which only checks non-empty and
different-input-different-output) stay green. The encoded-payload half of the
criterion has no coverage at all, and the test name asserting otherwise is worse
than no test.

No QR decoder is needed to close it: pin the block against the renderer's own
output for the same URL, e.g.
`expect(written[1]).toBe(renderQrCode( "https://100.90.1.2:4443/") + "\n")` —
deterministic, and it fails the moment the URL handed to `renderQrCode` stops
matching the URL printed above it.

## 3. Nothing pins `test:web`'s `inputs` or `lint`'s `.storybook/**` — the stale green can silently return

T7's third criterion is that `test:web`'s `inputs` "covers both the client
directory and `.storybook/`". It does today
(`["src/web/**", ".storybook/**", "vitest.config.ts"]`), and `lint` now carries
`.storybook/**` as well — but `tests/tooling/turbo.test.ts` is UNCHANGED in this
range and pins neither. Its generic tests only check that each task has SOME
explicit `inputs` array, so deleting either entry replays a cached green and no
test reds.

That file already pins exactly this class of hazard for the analogous cases —
`docs/**` on `test:unit`/both e2e tasks, `evals/**` on typecheck/lint/deadcode —
each with a comment naming the stale green it prevents. Add the two matching
assertions: `.storybook/**` in `lint`'s `inputs`, and both `src/web/**` and
`.storybook/**` in `test:web`'s. T7 names `tests/tooling/turbo.test.ts` in its
Paths list precisely because a new check is supposed to land its pins with it.

## 4. `tests/vitest.ensureWebClient.ts`'s doc comment states a `dependsOn` that `turbo.json` does not declare

The comment reads: "Turbo's `test:unit`/`test:e2e:*`/`test:web` tasks **all**
declare `dependsOn: ["build"]`". `turbo.json`'s `test:web` declares no
`dependsOn` at all — only the three others do. Harmless in effect (the storybook
project loads `App.stories.tsx` → `App.tsx`, never `src/serve/Server.ts`, so it
needs no generated HTML), but the comment is the only place the build-dependency
invariant is written down, and it is wrong about one of the four tasks it
enumerates. Drop `test:web` from the list, or say why it is the one task that
needs no build.
