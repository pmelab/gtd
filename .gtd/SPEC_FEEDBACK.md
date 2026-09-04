# Spec feedback — 01-serve-and-client-harness

Range re-inspected: `64dd325f` → working tree, fresh pass. The previous round's
four problems are all fixed: the exit-2 deviation is now recorded at
`ServeSchema`, `Server.test.ts:289` pins the QR block against
`renderQrCode("https://100.90.1.2:4443/")`, `tests/tooling/turbo.test.ts` pins
`.storybook/**` on `lint` and both entries on `test:web`, and
`vitest.ensureWebClient.ts`'s comment no longer claims `test:web` declares
`dependsOn: ["build"]`.

One blocker, plus two smaller items.

## 1. BLOCKER — the inlined client is dead on arrival: the browser bundle keeps `react`, `@trpc/*` and `@tanstack/react-query` external

T5's criteria: "`npm run build` produces one node bundle with the client
inlined" and "`gtd serve` without `--dev` serves the inlined client". The bundle
is produced and served, but the client **cannot execute in a browser**. The
`web` config in `tsdown.config.ts` sets no `noExternal`/`deps.alwaysBundle`, so
tsdown externalizes every `package.json` dependency. `src/web/generated.html` as
built today:

```
<script type="module">
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createTRPCReact } from "@trpc/react-query";
import { jsx } from "react/jsx-runtime";
```

Bare specifiers in an inline module script, with no import map and nothing
served under those paths. Every browser fails the module at resolution: nothing
renders, `#root` stays empty. Measured live against the built bundle, not
inferred:

```
node dist/gtd.bundle.mjs serve --host 127.0.0.1 --port 18443 --self-signed
curl -sk https://127.0.0.1:18443/ | grep 'from "react"'
#  -> import { StrictMode } from "react";
```

The whole point of the `.html` text-loader path — one self-contained node bundle
— is defeated: `generated.html` is 1873 bytes, i.e. the client's dependencies
are nowhere in it. `--dev` shares the same config and the same defect.

The `gtd` config already solves exactly this with
`deps: { alwaysBundle: (id) => !id.includes("qrcode-terminal") }`; the `web`
config needs the equivalent (bundle everything, no exceptions).

Nothing in the suite catches it, and that gap is half the finding: the only
assertion on the generated HTML is `expect(html).toContain("<!doctype html>")`
(`Server.test.ts:220`) and `expect(html).not.toContain('src="./main.js"')`
(`:249`) — both pass on a client that cannot load. Land a check that the inlined
script has **no non-relative `import … from` specifier** (a regex over
`generated.html`, or over `resolveClientHtml(false, …)`'s output), so an
externalized dependency reds the build instead of shipping.

## 2. T7's "`.storybook/` … carry dead-code entries" is unmet — the criterion holds only by accident

`.fallowrc.json` gained `src/web/main.tsx` but no `.storybook/` entry. Today
nothing is reported dead (`fallow`: 0 dead of 169) — because fallow never
**scans** `.storybook/` at all: the root `tsconfig.json` includes only
`src`/`tests`, and no `.storybook` path appears anywhere in fallow's output. So
the criterion's purpose is met by a coincidence of file discovery, not by the
entries it asks for, and `deadcode`'s turbo `inputs` list carries no
`.storybook/**` either.

Resolve it the way item 1 of the last round was resolved: either add the
`.storybook/*.ts` entries (plus `.storybook/**` in `deadcode`'s `inputs`), or
record at `.fallowrc.json` why those files need none — a reader comparing the
criterion to the config currently finds neither.

## 3. A `serve.cert` with no `serve.key` refuses with a message that says nothing is configured

`resolveCertPair` (`src/serve/Server.ts`) requires
`cert !== undefined && key !== undefined`; a half-configured pair silently falls
through to `"gtd serve: HTTPS is mandatory and no certificate is configured"`
with the remedy "or configure serve.cert and serve.key" — while `serve.cert`
**is** configured. `serveJsonSchema`'s own descriptions state the pairing rule
("Requires `key` too"), so the intended behaviour is a named refusal, not a
misleading one. Name the missing half in the message, and cover it — no test
exercises cert-without-key or key-without-cert today.
