# 02 — Shell safety and confinement inside the served worktree

## Requirement

TECHNICAL. Four holes in code this branch shipped or left standing. **The
tailnet is the whole security boundary and nothing is added to it** — so none of
these is an authentication problem. Each one's attacker is the repository's own
content or the worktree's own files, which reach the process however the port is
bound.

**A cloned repo's own `.gtdrc` executes shell on first run.** `src/ui/Tls.ts#52`
interpolates `host` into `-subj "/CN=${request.host}"` and the `subjectAltName`
line, handed as a string to `runner.bash`. `host` comes from `--host` **or
`ui.host` in the repo's own `.gtdrc`**, so `ui.host: "$(...)"` runs on the first
`gtd ui --self-signed`. Escape it, or hand `openssl` an argv array.
`src/ui/Diff.ts#172` has the same shape and is pre-existing: `quotedPath` is
properly single-quote-escaped, but `base` is interpolated unquoted straight out
of `gtd base`'s stdout.

**The private key leaks on every failure path.** `src/ui/Tls.ts#87` removes the
tmpdir holding `key.pem` only on the success path. Mode 0700, so contained but
persistent.

**`resolveWithinRoot` does not resolve symlinks.** There is no `realpath`
anywhere in `src/ui/`. A symlink inside the worktree pointing outside it passes
every one of the four gates (`Write.ts#187`, `Write.ts#214`,
`ReadSteeringFile.ts#53`, `Diff.ts#158`); `readSteeringFile` then returns the
target's bytes and `writeNote` writes through it. Worktrees are agent-writable,
so the chain is plausible. The same check also refuses a legitimate name: a file
called `..foo` resolves to relative `..foo` and trips `startsWith("..")`.
Compare path segments, not the string prefix.

**Reads inside the root are unrestricted.** Nothing confines `filePath` to
`.gtd/` or to the step's own `step.file`, and `View.ts`'s dispatch is total over
content, so `readSteeringFile({filePath: ".git/config", mode: "qa"})` returns
raw bytes — arbitrary read of anything in the repo, `.env` included. Confine it
to the served step's file.

`--dev` (`src/ui/Server.ts#226`) shells `npx tsdown --filter web` **per HTTP
request**, so one unauthenticated request triggers a build in the gtd source
checkout.

`resolveBindHost`'s comment (`src/ui/Server.ts#69`) claims the refusal exists
because an unauthenticated server "must never silently appear on the LAN". That
is untrue as written and the code is right: an explicit `--host` or `ui.host` is
the user's consent and stays honoured, `--host 0.0.0.0` included. **The comment
comes out, not the behaviour** — rewrite it to say the tailnet binding is the
boundary and an explicit host overrides it deliberately.

**Risk, blunt, accepted**: deleting `BeatCache` removed the only throttle that
ever existed. Every `step` and every `writeNote` now spawns a fresh
`gtd next --json` — a ~0.5s bundle parse — with no cache and no concurrency cap,
where the old cache capped it at 8 live spawns. Request flooding is subprocess
amplification, reachable by anything on the tailnet, and this concern does not
fix it. `src/ui/Beat.ts#18`'s comment still points at the deleted cache and
comes out here.

**Acceptance**: a unit test with `ui.host` set to a command-substitution string
asserts no shell execution and a failed certificate request, and one with a
symlink inside the root pointing outside it asserts the read and the write both
refuse. Both pass a malicious value today. No test asserts a refused bind host,
because there is none to refuse.

## Paths

`src/ui/Tls.ts`, `src/ui/Diff.ts`, `src/ui/SafePath.ts`,
`src/ui/ReadSteeringFile.ts`, `src/ui/Server.ts`, `src/ui/Beat.ts`, plus a new
`src/ui/Shell.ts` and `src/ui/Shell.test.ts`.

## Task 1 — One shared quoting helper, no new subprocess port

`CommandRunner` exposes only `bash(command)`, so an argv array means a new port
method plus a Live implementation plus every test double in the repo. Quoting
reaches the same guarantee against a `.gtdrc`-supplied `ui.host` at a fraction
of the blast radius.

- [ ] New `src/ui/Shell.ts` exports `singleQuoted(value: string): string`,
      wrapping the value in single quotes with every embedded quote escaped
- [ ] `src/ui/Tls.ts` runs `host` through it in `-subj`, in `subjectAltName`,
      and for both temp paths
- [ ] `src/ui/Diff.ts` runs `base` through it, and its own inline copy of the
      same escape for `quotedPath` is deleted in favour of the shared helper
- [ ] `src/ui/Shell.test.ts` covers an embedded single quote, a command
      substitution, a semicolon, and a backtick
- [ ] A unit test sets `ui.host` to a command-substitution string and asserts no
      shell execution and a failed certificate request
- [ ] Accepted and recorded: a `host` containing `/` or `=` can still confuse
      openssl's own `-subj` parsing. That is a failed certificate request with a
      named error, not code execution

## Task 2 — The private key never outlives the call

- [ ] `generateSelfSignedCert` wraps everything after `mkdtempSync` in an
      `Effect.ensuring` that removes the tmpdir recursively
- [ ] The success-path-only `rmSync` at `src/ui/Tls.ts#87` is deleted
- [ ] A unit test asserts the tmpdir is gone after an openssl non-zero exit
- [ ] A unit test asserts the tmpdir is gone after a read-back failure

## Task 3 — `resolveWithinRoot` compares segments and resolves symlinks

Two changes, one function, still synchronous — all four call sites are sync,
ahead of `src/ui/Write.ts`'s `enqueue`.

- [ ] The containment test becomes a first-segment comparison against `..`
      instead of a `startsWith("..")` string prefix
- [ ] A file named `..foo` inside the root resolves rather than refusing
- [ ] The candidate is `realpathSync`'d before the test
- [ ] A leaf that does not exist yet walks up to the nearest existing ancestor,
      realpaths that, and re-appends the tail — an `ENOENT` never becomes a
      throw
- [ ] `root` is `realpathSync`'d too, so a worktree reached through a symlinked
      parent does not refuse its own files
- [ ] Any other `realpath` error refuses
- [ ] A unit test with a symlink inside the root pointing outside it asserts the
      read AND the write both refuse — all four gates (`Write.ts#187`,
      `Write.ts#214`, `ReadSteeringFile.ts#53`, `Diff.ts#158`) go through this
      one function

## Task 4 — Confine reads and writes to the served step's own file

The gate lives in `src/ui/Server.ts`'s `createContext`, not inside each
function: the context already closes over `cwd.root`, and the startup gate hands
it a `file` narrowed to a `string`.

- [ ] The `readSteeringFile` context wrapper refuses when
      `request.filePath !== step.file`
- [ ] The `writeNote` context wrapper refuses on the same comparison
- [ ] The `writeValue` context wrapper refuses on the same comparison
- [ ] The refusal reason is the existing `file-vanished`; no seventh value joins
      `WriteRefusalReason`, because a seventh reason means a seventh client
      display sentence for a case only a hand-rolled client can reach
- [ ] A unit test asserts `readSteeringFile` with `filePath: ".git/config"`
      refuses

## Task 5 — `--dev` builds once, at startup

The server lives for exactly one step, so a mid-step rebuild has nothing to
reflect.

- [ ] `rebuildDevClientScript` runs ahead of `httpsServer.listen`, its result
      held for the process's lifetime
- [ ] The per-request build path is deleted
- [ ] The "read fresh off disk every call" comment is deleted
- [ ] No HTTP request can spawn a build

## Task 6 — Two comments come out

- [ ] `resolveBindHost`'s comment is rewritten to say the tailnet binding is the
      boundary and an explicit `--host`/`ui.host` is the user's own consent,
      overriding it deliberately
- [ ] The bind behaviour is untouched — `--host 0.0.0.0` stays honoured, and no
      test asserts a refused bind host, because there is none to refuse
- [ ] `src/ui/Beat.ts#18`'s pointer at the deleted `BeatCache` is deleted

## Task 7 — Record the throttle risk, do not fix it

**Risk, blunt, unfixed**: no throttle and no concurrency cap on
`gtd next --json`. Every `step` read and every write still spawns a ~0.5s bundle
parse, where the deleted `BeatCache` capped it at 8 live spawns. Request
flooding is subprocess amplification reachable by anything on the tailnet.

- [ ] No cache and no concurrency cap is added by this package
- [ ] Moving the `--dev` build to startup removes the single most expensive
      amplifier; the beat spawns themselves stay uncapped and out of scope
