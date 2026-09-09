# Architecture

## The served page carries no styling at all

An inline `<style>` block in `src/web/index.html`'s `<head>`. Not a `.css` file,
not injection from `main.tsx`: a build-emitted stylesheet is dropped on the
floor by both delivery paths (`scripts/inline-web-client.mjs` and
`resolveClientHtml`, which each read exactly `src/web/index.html` plus
`dist/web/main.js`), and JS-injected styles paint after first frame — a flash of
white on every phone load. **Inline `<style>` needs no change to either delivery
path, no change to `tsdown.config.ts`, and no new inline seam beside
`SCRIPT_TAG_PATTERN`.**

The whole shell, four declarations on `body` plus one on `:root`:

- `color-scheme: dark` — **the one line that must not be dropped.** Without it a
  phone in light mode paints white form controls and a white scrollbar over the
  dark page
- `background` — a dark surface consistent with the `#111` already hardcoded in
  `Refusal.tsx#124` and `NoteSheet.tsx#199`
- `color` — a light text color
- a system font stack (`-apple-system, …`) — the phone client's target is iOS
  Safari
- `margin: 0` on `body`, so the dark surface reaches the viewport edges

**No component file changes and no syntax-palette change.** `#111`, `#3a2a00`,
`#333`, and `Highlight.ts`'s `#6a9955`/`#ce9178`/`#569cd6` are already a
dark-surface set and stay exactly as they are.

Error handling: **none, structurally.** The inline-script seam throws a named
error when its tag goes missing because the script is folded in from a separate
file at build time. A `<style>` block is part of the template itself — it cannot
go missing without the template going missing, which both paths already report.

Acceptance, one unit test asserting a page background and a text color are
present in the served HTML, run against **both** sources: the `generated.html`
string `Server.ts#16` imports, and the `--dev` template read from
`src/web/index.html`. Both fail today.

Primary paths: `src/web/index.html`, `src/ui/Server.test.ts`.

## Emit the Tailscale URL, not just the bound IP

One concern, one package: the hostname URL and the `tailscale cert` branch share
the same probe output and have no separate acceptance.

### Splitting bind from display

`Server.ts#369` resolves one `host` string that today serves both the socket
bind and the printed URL. Split into two values at that call site:

- `bindHost` — unchanged, `resolveBindHost`'s CGNAT IP, passed to
  `httpsServer.listen`
- `displayHost` — the tailnet hostname when the probe answers, otherwise
  `bindHost`, used for `const url = \`https://${displayHost}:${bound.port}/\``
  and therefore the QR code too

**An explicit `--host`/`ui.host` sets both and skips the probe entirely.**
`resolveBindHost` already treats that as deliberate consent; detection must not
override it.

### The probe

Two modules, mirroring the `Bind.ts` / `BindSystem.ts` split that exists so
`program.test.ts`, `Server.test.ts`, and `ui.steps.ts` can mock the real-system
call without stubbing pure logic:

- `src/ui/Tailscale.ts` — pure.
  `parseTailscaleStatus(json: string): TailscaleStatus | undefined`. Returns
  undefined on unparseable JSON, on `BackendState !== "Running"`, and on a
  missing `Self`. Otherwise returns
  `{ hostname, certDomains: readonly string[] }`
- the probe Effect itself lives beside it and shells out through
  **`CommandRunner`**, already in `resolveCertPair`'s requirements — so it needs
  no `vi.mock` site of its own and adds no new port. `CommandRunner` is the seam
  tests drive.

`hostname` comes from `CertDomains[0]` when present, else `DNSName` with its
**trailing dot stripped** — `Self.DNSName` is a fully-qualified name ending in
the DNS root (`…tailb2e719.ts.net.`) and that dot must never reach a URL or a QR
code.

**The binary is located through `$PATH` only** — one `tailscale status --json`
through `CommandRunner.bash`, no candidate-path list. **Risk accepted: a macOS
App Store install puts the binary at
`/Applications/Tailscale.app/Contents/MacOS/Tailscale` and never on `$PATH`, so
that user silently gets the CGNAT IP and the certificate refusal.**

Three empty results, each falling back to today's IP rather than failing: binary
absent from `$PATH` (spawn failure or non-zero exit), `BackendState` not
`"Running"`, MagicDNS off so no `DNSName` at all. **The probe never fails the
command** — it returns `undefined` and the URL is the IP, exactly as today.

### The certificate branch

`resolveCertPair` gains a fourth branch. Full precedence: `--self-signed`, then
a configured `ui.cert`/`ui.key` pair, then `tailscale cert`, then the refusal.

`tailscale cert <domain>` **cannot use `--cert-file -` / `--key-file -` for both
at once** — two PEM blocks would interleave on one stream. Write both to an
`mkdtempSync(join(tmpdir(), "gtd-tls-"))` directory, the same shape
`generateSelfSignedCert` already uses, read them back as PEM strings, and remove
the directory on **every** exit path via `Effect.ensuring` — the tmpdir holds a
private key, and that guard is not optional.

**`Self.CertDomains` non-empty is the availability probe.** The field is
populated only when the tailnet has HTTPS certs enabled; empty means
`tailscale cert` would fail, and the branch is skipped rather than attempted.

Certificate re-issue per invocation is accepted, not a problem to solve here:
`gtd ui` runs once per step, and `tailscale cert` returns its own cached
certificate when the existing one is still valid, so this is a local state-dir
read, not a CA round trip per step.

**A non-zero `tailscale cert` fails the command outright — no fallback to the
refusal, no fallback to self-signed.** The error carries `tailscale cert`'s own
output as hint lines. The branch was chosen because `CertDomains` said it was
available, so a rate limit, an ACL change, or HTTPS switched off between the two
calls is a broken tailnet, and sliding back into "no certificate is configured"
would name the wrong cause. `--self-signed` remains the user's escape.

**The refusal's two hint lines gain a third naming the Tailscale path**, or a
user on a tailnet with HTTPS disabled reads a message that omits the reason they
landed there. That refusal is reached only when `CertDomains` is empty — never
after a failed `tailscale cert`.

### Comments this falsifies

Two doc comments assert the opposite of the new code and are rewritten as part
of this package, never left behind:

- `Bind.ts`'s "avoids shelling out to a `tailscale` binary, which is not
  installed on this machine and not worth acquiring" — the premise is false
- `resolveCertPair`'s "Neither present is a refusal, not a silent default to
  self-signed — that would mean an unexpected `openssl` invocation on every
  plain `gtd ui`". A plain `gtd ui` on an HTTPS-enabled tailnet now succeeds.
  The recorded reasoning still holds for the `openssl` path, which is exactly
  why the new branch shells out to `tailscale` — say that

`Tls.ts` needs no change: `SelfSignedCertRequest` already models `host` for the
SAN's `DNS:` entry and optional `ip` for its `IP:` entry, so a hostname URL over
an IP bind fills both fields of a shape that already exists.

### Docs

`docs/cli.md` lines 81–83 and 149 describe the `--host` default and are PINNED
equal to the rendered help output. Changing that wording means regenerating that
block from the help text, never hand-editing it.

Acceptance, two e2e scenarios driven by a `CommandRunner` double: with a fake
`tailscale status --json` reporting a running backend, the printed URL and QR
code carry the tailnet hostname; with the probe empty, they carry the IP exactly
as today.

Primary paths: `src/ui/Tailscale.ts` (new), `src/ui/Server.ts`,
`src/ui/Bind.ts`, `docs/cli.md`, `tests/integration/features/ui.feature`.

## Answered Questions

### Should the two concerns merge into one package?

No. Their file footprints do not overlap — the styling concern is
`src/web/index.html`, the Tailscale concern is `src/ui/`. Neither consumes an
interface the other creates.

### Inline `<style>` in the template, or styles injected from `main.tsx`?

Inline `<style>`. Both avoid a build change, but injected styles apply after the
first paint, so every phone load flashes white before going dark.

### Is a new mockable port needed for the Tailscale probe, like `BindSystem.ts`?

No. `CommandRunner` is already an injectable port and already in
`resolveCertPair`'s requirements, so the probe's subprocess is testable through
it. Only the JSON parsing splits out, as pure code.

### `CertDomains[0]` or `DNSName` for the hostname?

`CertDomains[0]` first — it carries no trailing dot and its presence doubles as
the HTTPS-enabled probe. `DNSName`, dot-stripped, is the fallback.

### How is the `tailscale` binary located?

`$PATH` only. A macOS App Store install is not on `$PATH` and falls back to the
CGNAT IP and the certificate refusal — accepted, rather than baking
macOS-specific paths into `src/ui/`.

### What happens when `tailscale cert` itself fails after the branch was chosen?

It fails the command hard, surfacing `tailscale cert`'s own output — no
fallback. A silent slide back into the generic refusal would hide a broken
tailnet.
