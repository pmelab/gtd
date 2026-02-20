# Migrate from Bun to Node.js + npm Publishing

## Action Items

### Runtime & Platform

- [ ] Replace `@effect/platform-bun` with `@effect/platform-node` throughout
  - In `src/main.ts`: swap `BunContext`/`BunRuntime` imports for
    `NodeContext`/`NodeRuntime` from `@effect/platform-node`
  - In `src/services/Git.test.ts`: replace `BunContext` import with
    `NodeContext`
  - Remove `@effect/platform-bun` and `@types/bun` from `package.json`; add
    `@effect/platform-node`
  - Tests: `npm run typecheck` passes with no `platform-bun` references
    remaining

### File Operations

- [ ] Replace all `Bun.file()` / `Bun.write()` calls in

  > shouldn't those use effect platform file operations in the first place?

        `src/services/FileOps.ts` with `fs.promises`

  - `Bun.file(path).text()` → `fs.promises.readFile(path, 'utf-8')`
  - `Bun.file(path).size` → `(await fs.promises.stat(path)).size`
  - `Bun.write(path, data)` → `fs.promises.writeFile(path, data)`
  - Rename `bunFileOps` → `nodeFileOps` and update all call sites
  - Tests: existing FileOps unit tests pass under Node.js

### Process Spawning

- [ ] Replace all `Bun.spawn()` calls with Node.js `child_process.spawn()`
  > shouldn't those use effect platform process operations in the first place?
  - Affected files: `src/services/agents/Claude.ts`, `OpenCode.ts`, `Pi.ts`,
    `src/commands/build.ts`, `src/services/Notify.ts`
  - Bun's `proc.exited` → wrap in a `Promise` resolving on the `close` event
  - Bun's `proc.stdout` is a Web `ReadableStream` — Node's is a `Readable`;
    update `src/services/agents/stream.ts` to accept Node `Readable` or adapt it
  - `new Blob([data])` for stdin → pipe a `Readable` or use
    `proc.stdin.write()`; replace `new Response(proc.stdout).text()` (build.ts)
    with stream buffering via `fs.promises` or a helper
  - Tests: agent spawning integration tests pass; `npm run test` green

### Build & Distribution

- [ ] Replace `bun build --compile` with `tsup` to produce a publishable Node.js
      bundle
  - Add `tsup` as a dev dependency; create `tsup.config.ts` targeting Node.js
    ESM with a shebang injected into the entry point
  - Update `package.json` `build` script to `tsup`
  - Add `bin`, `main`/`exports`, `files`, and `engines` fields to `package.json`
    pointing at the `dist/` output
  - Tests: `npm run build` produces `dist/gtd.js` with correct shebang;
    `node dist/gtd.js --help` works

- [ ] Set up npm publishing metadata in `package.json`
  - Add `name`, `version`, `description`, `license`, `repository`, `keywords`
    fields
  - Add `files: ["dist"]` to exclude source from the published tarball
  - Add `engines: { node: ">=20" }`
  - Tests: `npm pack --dry-run` lists only `dist/` files and `package.json`

### Tooling & CI

- [ ] Update `package.json` scripts and `tsconfig.json` for Node.js
  - Scripts: replace `bun run` → `node --import tsx/esm` for `dev`; replace
    `bun vitest` → `vitest` for test scripts
  - `tsconfig.json`: change `moduleResolution` from `"bundler"` to `"node"` (or
    `"nodenext"`)
  - Delete `bun.lock`; commit `package-lock.json`
  - Tests: `npm install && npm run typecheck && npm test` all pass

- [ ] Update GitHub Actions workflow (`.github/workflows/test.yml`)
  - Replace `oven-sh/setup-bun@v2` with `actions/setup-node@v4` (Node 20, LTS)
  - Replace all `bun install` / `bun run` / `bun test` invocations with `npm`
    equivalents
  - Tests: CI pipeline passes on a push to a test branch

## Open Questions

- Should the npm package ship a pre-built `dist/gtd.js` (committed to repo) or
  build on `npm install` via a `prepare` script?
  > ship prebuilt
- Should `tsup` bundle all dependencies into the output (fully self-contained)
  or keep them as peer/runtime deps that npm installs?
  > bundle everything, no dev dependency installs on consumers
- Does `stream.ts` need to support both Web `ReadableStream` and Node
  `Readable`, or can all call sites be migrated to Node streams?
  > doesn't effect have an abstraction for that?
