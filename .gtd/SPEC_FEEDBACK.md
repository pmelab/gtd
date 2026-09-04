# Spec feedback — 01-serve-and-client-harness

Range inspected: `64dd325f` → working tree. T1–T5 land and their gates are
green. **T7 and T8 are entirely absent, and T6/T9 are each missing one required
criterion.** Below, in severity order.

## 1. T8 (tRPC transport) is not implemented at all — zero of five criteria

No `src/serve/Router.ts`, no `src/web/api.ts`, no `@trpc/*` in either dependency
block, no React Query. `grep -rn trpc package.json src/ docs/` returns nothing.
`src/serve/Server.ts`'s request handler serves exactly one response — the client
HTML — with no API surface.

Every criterion fails, including the two the spec calls load-bearing: the
refusal crossing as a typed error whose `{stdout, stderr, exitCode}` stay
separately readable, and "the new runtime dependency is declared under
`dependencies`, not `devDependencies`".

## 2. T7 (Storybook, browser mode, `test:web`) is not implemented at all — zero of seven criteria

No `.storybook/` directory. No `test:web` script in `package.json`, no
`test:web` task in `turbo.json`, and no `test:web` in the `test` script's task
list — the exact all-three requirement `tests/tooling/turbo.test.ts` pins.
`vitest.config.ts` still has three projects, not four. No `@storybook/*` or
vitest browser-mode devDependency. `.github/workflows/` is untouched, so no
explicit chromium install step exists.

## 3. `build`'s turbo `outputs` omit `src/web/generated.html`, so a cache-hit build leaves the node bundle's import unresolvable

`turbo.json`'s `build` declares `outputs: ["dist/**", "schema.json"]`.
`scripts/inline-web-client.mjs` writes `src/web/generated.html`, which
`src/serve/Server.ts` imports. `test:unit`, `test:e2e:inmem` and `test:e2e:live`
all gained `dependsOn: ["build"]` to produce it.

Reproduced on this tree:

```
rm -f src/web/generated.html && npx turbo run build   # >>> FULL TURBO, file NOT restored
npx vitest run --project unit src/serve/Server.test.ts # exit 1
#   Cannot find module '../web/generated.html' imported from src/serve/Server.ts
```

Worse, `npx turbo run test:unit` in that state reports FULL TURBO green — a
stale green over a broken tree, the exact hazard AGENTS.md's "Task graph and
caching" section names. Trigger in normal use: any `git clean -xdf` or
`rm -rf dist` with a warm turbo cache.

Note `dist/web/main.js` is also not restorable in practice: the `gtd` tsdown
config's `clean: true` wipes `dist/` — including `dist/web/` — after the browser
build, so the cached `dist/**` never contains it.

## 4. Two unit tests assert a refusal that only holds on a machine with no tailnet

- `src/serve/Server.test.ts:58` — "calls through to the real system scan by
  default" calls `resolveBindHost(undefined, undefined)` with no `pickHost`
  override and asserts `Exit.isFailure`.
- `src/program.test.ts` — the `gtd serve` dispatch test asserts the cause
  contains `"gtd serve: no Tailscale interface found"`.

Both reach the real `os.networkInterfaces()`. On any machine or CI runner that
has joined a tailnet, `pickBindHostFromSystem()` returns an address, both
Effects succeed, and both tests red — with a failure that reads as a serve bug.
Assert the integration point without depending on the host's network (e.g.
inject the interfaces map, or assert the seam is called).

## 5. T6: the lint config never gained the `react` plugin

`.oxlintrc.json` is untouched — `"plugins": ["typescript", "unicorn", "oxc"]`.
Criterion "a React hooks-rule violation in a client file fails `lint`" cannot
hold: no react rules are loaded, so `npm run lint` is silent on `src/web/`.

## 6. T9: `docs/configuration.md` does not document `serve:`

Criterion "the configuration reference documents `serve:` and each of its six
sub-keys" fails — `docs/configuration.md` has no `serve` section
(`grep -n serve docs/configuration.md` hits only an unrelated `schema.json`
sentence). `docs/cli.md` did land.

## 7. No cucumber scenario for `gtd serve`

`git diff --stat 64dd325f..HEAD -- tests/` is empty. AGENTS.md: "create
cucumber.js scenarios for each new feature". A whole new command and its refusal
paths landed with unit tests only.

## 8. `--dev` shells out to `npx tsdown` per request, which contradicts the spec and cannot work where `serve` is documented to run

T5 says `--dev` "reads the client off disk instead". `rebuildDevClientScript`
(`src/serve/Server.ts`) instead runs `npx tsdown --filter web` on **every HTTP
request**, then reads `dist/web/main.js`. Three problems:

- `CommandRunner.Live` runs with `workingDirectory(Cwd.root)`, i.e. the invoking
  cwd. `serve` is deliberately `needs: "config"` so it runs outside any repo —
  where `npx tsdown --filter web` has no config to select and fails. The
  command's own help text advertises exactly this ("the roots it scans are
  elsewhere, so it never needs a repository").
- `tsdown` is a devDependency; in an installed `@pmelab/gtd`, `npx` resolves
  nothing and `--dev` refuses.
- A full rolldown build per page load (~1s measured for the browser config).

## 9. Documented `serve` default port contradicts the code

`src/serve/Server.ts` sets `DEFAULT_PORT = 8443`. `docs/cli.md` and
`src/Cli.ts`'s flag help both say `--port` defaults to "a free port" and the
`serve` command row says "(default: an address picked automatically, and a free
port)". Since the help block is pinned byte-for-byte to `docs/cli.md`, fixing
one requires fixing both.

Same block: "Start a local HTTP(S) server" understates a hard requirement —
HTTPS is mandatory and no flag yields plain http (requirement 1, T4's last
criterion).

## 10. A comment claims a shared constant that does not exist

`src/serve/Server.ts`'s `DEV_SCRIPT_TAG` carries: "kept as one constant so the
two never drift apart". `scripts/inline-web-client.mjs` declares its own
identical `scriptTagPattern`. They are two copies; the comment asserts the
opposite of the code.
