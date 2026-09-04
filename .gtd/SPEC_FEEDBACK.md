# Spec feedback — 01-serve-and-client-harness

Fresh pass over `64dd325f` → working tree. The previous round's three items are
genuinely fixed: `tsdown.config.ts`'s `web` config now carries
`deps: { alwaysBundle: [/.*/] }` and the built `generated.html` has no bare
import specifier; `.fallowrc.json`'s `.storybook/` note checks out against
`npx fallow list` (the `storybook` plugin does discover `main.ts`, `preview.ts`
and `App.stories.tsx` as entries) and `deadcode` gained `.storybook/**` inputs;
a half-configured cert pair now names the missing half.

Two problems remain — one blocker.

## 1. BLOCKER — the inlined client still does not run: `String.replace`'s `$&` pattern corrupts the bundle and injects a stray `</script>`

T5's criterion "`gtd serve` without `--dev` serves the inlined client" is still
unmet, for a different reason than last round. `scripts/inline-web-client.mjs`
does:

```js
template.replace(
  scriptTagPattern,
  `<script type="module">\n${clientScript}\n</script>`,
)
```

The second argument is a **replacement string**, so every `$&`, `` $` ``, `$'`,
`$$` inside the bundled client JS is expanded. React's key escaping contains
literally `escapedKey.replace(userProvidedKeyEscapeRegex, "$&/")` — twice — so
in `src/web/generated.html` those two sites read:

```
userProvidedKeyEscapeRegex, "<script type="module" src="./main.js"></script>/")
```

Two consequences, both fatal: the JS is semantically corrupted, and the injected
`</script>` **terminates the inline module script early**. Counted on the real
build: `grep -c '</script>' src/web/generated.html` → **3**, where a correct
inline is **1**.

Measured live against the built bundle with headless chromium (`playwright`,
`ignoreHTTPSErrors`):

```
node dist/gtd.bundle.mjs serve --host 127.0.0.1 --port 18449 --self-signed
# page:  root innerHTML: ""
#        document.body.innerText length: 984758   <- the whole bundle rendered as page text
#        pageerror: SyntaxError: missing ) after argument list
```

Nothing renders. `#root` is empty and ~985 KB of JavaScript is displayed as
visible text.

`src/serve/Server.ts`'s `renderHtml` has the **same** defect on the `--dev` path
— same `template.replace(DEV_SCRIPT_TAG, "<script …>" + script + …)` shape — so
T5's `--dev` criterion is broken identically.

Both sites need a replacement **function** (`() => …`), which disables `$`
expansion. Confirmed on this tree: string replacement → 3 `</script>`, function
replacement → 1. While there, decide explicitly about a literal `</script>`
occurring inside a future client dependency (today the raw `dist/web/main.js`
has zero) — escaping it as `<\/script>` is the standard guard.

Nothing in the suite catches it, and that gap is half the finding. Last round's
new test (`Server.test.ts:252`, "no bare import specifier") passes on this
corpse. Land a check that actually pins loadability — e.g. exactly one
`</script>` in `resolveClientHtml(false, …)`'s output, and no occurrence of the
`src="./main.js"` tag text **inside** the inlined script — so this reds the
build instead of shipping.

## 2. `--self-signed` with a hostname `--host` fails, blaming openssl

`runServeCommand` calls `generateSelfSignedCert({ host, ip: host })`
(`src/serve/Server.ts`), so the resolved bind host is put into the SAN's **`IP:`
slot** unconditionally. A hostname there is rejected by openssl, not ignored.
Measured on this machine's LibreSSL 3.3.6:

```
node dist/gtd.bundle.mjs serve --host localhost --self-signed --port 18450
gtd serve: openssl exited without issuing a certificate
  exit status: 1
  Error Loading command line extensions
  ...x509_alt.c:565:value=localhost
```

T3 asks the SAN to carry "the bind IP **and** the hostname" — the code treats
them as the same string, which only holds when `--host` is a dotted-quad. The
user-visible failure is a raw openssl dump that names neither the flag nor the
cause. Split the two: put an IPv4/IPv6 literal in `IP:` and a non-literal in
`DNS:` only (Tailscale auto-detection always yields a literal, so the default
path is unaffected), or refuse up front naming `--host` as the reason. No test
exercises a non-literal `--host` with `--self-signed` — `Tls.test.ts` only ever
passes `100.90.1.2`-shaped values.
