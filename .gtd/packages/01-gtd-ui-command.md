# `gtd ui`, its config key, and its docs pins

The rename, landed atomically with everything that reds on it. No behaviour
changes except the repo guard.

## Requirement

### `gtd ui` replaces `gtd serve` as a single-worktree command

PRODUCT. The command is named `ui`, and it operates on the worktree it is
invoked in — **the invoking directory, never a configured list of roots**. It
binds a defined port and shows the web interface for that worktree's current
step, nothing else.

`gtd serve` carries `needs: "config"` so it runs outside a repository, like
`visualize`. `gtd ui` is the opposite: the worktree IS the invoking directory,
so it takes whatever repo guard the state commands already use. Invoked outside
a repo it must refuse, not start.

The port is settled: default 8443, `--port <n>` override, `ui.port` config key.

**The UI keeps its network reach** — a phone on the tailnet is the whole point,
so single-worktree scope shrinks nothing here. `gtd ui` binds a configurable
host over HTTPS, prints the QR code, and keeps `--host`, `--self-signed`,
`ui.cert`/`ui.key`, `src/serve/Tls.ts` and `src/serve/Qr.ts`. Both refusal
scenarios survive as behaviour and are re-pointed at the new command name:
`--host` without a tailnet name still refuses, and `--host` without a cert still
refuses. Nothing in the TLS or QR path joins the deletions in a later package.

Forced into this concern, because they red the moment the name changes: the CLI
help row and every flag `scope`/`scopeError` in `src/Cli.ts`, the `## Commands`
pin in `docs/cli.md`, the top-level config key rename `serve:` → `ui:`, and
`docs/configuration.md`'s section for it. `--port`'s error text lost its command
name when it was widened from `visualize`-only; fix that here.

Acceptance: help output lists `gtd ui` and no `gtd serve`, with the
`docs/cli.md` `## Commands` pin green; a scenario runs `gtd ui` in a non-repo
directory and refuses; a config file with `serve:` fails to decode where `ui:`
succeeds.

## Tasks

### Rename the command token, kind, and every flag scope

`src/Cli.ts`

- [ ] The command token and `Command["kind"]` are `ui`, never `serve`
- [ ] `--port`, `--host`, `--self-signed`, `--dev` each scope to `kind === "ui"`
      (`--port` also still to `visualize`)
- [ ] `--port`'s `scopeError` names `gtd visualize`/`gtd ui`, and its help text
      names both defaults — a free port for visualize, 8443 for ui
- [ ] `--host`, `--self-signed`, `--dev` `scopeError` strings each name `gtd ui`
- [ ] `src/Cli.test.ts` passes with every `serve` reference renamed

### Move `gtd ui` under the shared repo guard

`src/program.ts`

- [ ] `needsOf("ui")` returns `"state"`, not `"config"`
- [ ] `ui` is absent from `standaloneKinds()`, and that list's "seven kinds" doc
      comment reads six
- [ ] `standaloneKinds`' own pin test passes with six entries
- [ ] `gtd ui` outside a git repository exits **1** —
      `assertRunningFromRepoRoot` fails with a plain `Error`, which
      `Cli.ts#report` maps to `EXIT_RUNTIME_ERROR`
- [ ] `gtd ui` in a repository with no commits exits 1 through
      `assertRepositoryHasCommits`
- [ ] No new exit code exists; `src/ExitCodes.ts`'s closure set is still five
      numbers

### Rename the config key `serve:` to `ui:`

`src/ConfigSchema.ts`, `schema.json`

- [ ] The top-level key is `ui:`; `serveJsonSchema` → `uiJsonSchema`,
      `ServeSchema` → `UiSchema`, `ServeConfig` → `UiConfig`
- [ ] A config file carrying `serve:` fails to decode at exit 2, and the same
      file under `ui:` decodes
- [ ] `schema.json` regenerates in `postbuild` with the new key and no `serve`
      key remaining
- [ ] `src/ConfigSchema.test.ts` passes

### Rename the module directory and every message prefix

`src/serve/` → `src/ui/`

- [ ] The directory is `src/ui/`, moved with `git mv`, and every importer
      follows
- [ ] `runServeCommand` → `runUiCommand`, `ServeCommandOptions` →
      `UiCommandOptions`, `ServeRequirements` → `UiRequirements`
- [ ] Every `gtd serve:` message prefix in the moved modules reads `gtd ui:`
- [ ] `turbo.json` needs no edit — its `inputs` are `src/**`
- [ ] `npm run typecheck` and `npm run lint` pass

### Keep `--dev` exactly as it is

`src/ui/Server.ts`

- [ ] `--dev` still parses, still scopes, and still appears in help output
- [ ] `findPackageRoot`, `readDevTemplate` and `rebuildDevClientScript` are
      unchanged in behaviour — the walk starts at the module's own file, never
      the invoking directory
- [ ] `gtd ui --dev` from a gtd source checkout serves a freshly rebuilt client

### Keep the TLS, bind and QR behaviour, renamed only

`src/ui/Tls.ts`, `src/ui/Qr.ts`, `src/ui/Bind.ts`, `src/ui/Server.ts`

- [ ] `--host` absent with no tailnet interface and no configured host refuses,
      naming both remedies
- [ ] `--host` given with no `--self-signed` and no configured cert/key refuses,
      naming both remedies
- [ ] `--self-signed` unlocks certificate generation only, never the `--host`
      requirement
- [ ] The started server prints its `https://` URL and the QR code
- [ ] Default port is 8443; `--port <n>` overrides it; `ui.port` overrides the
      default and loses to `--port`

### Update the pinned docs in the same commit

`docs/cli.md`, `docs/configuration.md`

- [ ] `docs/cli.md`'s `## Commands` block lists `gtd ui` and no `gtd serve`, and
      matches rendered help byte for byte
- [ ] `docs/cli.md`'s flags block matches rendered help, including the reworded
      `--port` line
- [ ] `docs/cli.md`'s standalone-command sentence no longer lists `serve` among
      the commands that skip the repo guard
- [ ] `docs/configuration.md`'s section heading and every bullet read `ui:`, not
      `serve:` — its `roots` and `loop` bullets stay for now
- [ ] The exit-code table is unchanged: 0, 1, 2, 130, 143

### Re-point the feature file and invert the non-repo scenario

`tests/integration/features/serve.feature` → `ui.feature`

- [ ] All four refusal scenarios run `gtd ui` and pass
- [ ] The scenario named "serve needs no repository" is **inverted, not
      deleted** — the same setup, now asserting `gtd ui` refuses outside a
      repository with exit 1
- [ ] `src/ui/Server.test.ts` passes with every rename applied
- [ ] `npm test` is green
