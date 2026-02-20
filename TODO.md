# Migrate from Bun to Node.js + npm Publishing

## Action Items

### Runtime & Platform

- [x] Replace `@effect/platform-bun` with `@effect/platform-node` throughout
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
      `src/services/FileOps.ts` with `@effect/platform` `FileSystem` service
  - Inject `FileSystem` from `@effect/platform` and use `fs.readFileString`,
    `fs.stat`, `fs.writeFileString` instead of `Bun.file()` / `Bun.write()`
  - Rename `bunFileOps` → `nodeFileOps` and update all call sites
  - The Node.js implementation is provided automatically via `NodeContext.layer`
    already added in the Runtime & Platform step
  - Tests: existing FileOps unit tests pass under Node.js

### Process Spawning

- [ ] Replace all `Bun.spawn()` calls with `@effect/platform` `Command` service
  - Affected files: `src/services/agents/Claude.ts`, `OpenCode.ts`, `Pi.ts`,
    `src/commands/build.ts`, `src/services/Notify.ts`
  - Use `Command.make(...)` and `Command.stream` / `Command.string` from
    `@effect/platform` — this also resolves the stdout stream abstraction, as
    Effect's `Command` yields Effect `Stream`s natively
  - Pass stdin via `Command.stdin` pipe rather than `new Blob()`
  - The Node.js implementation is provided automatically via `NodeContext.layer`
  - Tests: agent spawning integration tests pass; `npm run test` green

### Build & Distribution

- [ ] Replace `bun build --compile` with `tsup` to produce a fully
      self-contained publishable bundle

  - Add `tsup` as a dev dependency; create `tsup.config.ts` targeting Node.js
    ESM, inject `#!/usr/bin/env node` shebang, and set `noExternal: [/.*/]` to
    bundle all dependencies (no runtime installs for consumers)
  - Update `package.json` `build` script to `tsup`; commit the built
    `dist/gtd.js` to the repo (ship prebuilt)
  - Add `bin`, `exports`, `files: ["dist"]`, and `engines: { node: ">=20" }`
    fields to `package.json` pointing at `dist/gtd.js`
  - Tests: `npm run build` produces `dist/gtd.js` with correct shebang;
    `node dist/gtd.js --help` works; `npm pack --dry-run` lists only `dist/`

- [ ] Set up npm publishing metadata in `package.json`
  - Add `name`, `version`, `description`, `license`, `repository`, `keywords`
    fields
  - Tests: `npm pack --dry-run` lists only `dist/` files and `package.json`

### Tooling & CI

- [ ] Update `package.json` scripts and `tsconfig.json` for Node.js

  - Scripts: replace `bun run` → `tsx` for `dev`; replace `bun vitest` →
    `vitest` for test scripts
  - `tsconfig.json`: change `moduleResolution` from `"bundler"` to `"node16"` or
    `"nodenext"`
  - Delete `bun.lock`; commit `package-lock.json`
  - Tests: `npm install && npm run typecheck && npm test` all pass

- [ ] Update GitHub Actions workflow (`.github/workflows/test.yml`)
  - Replace `oven-sh/setup-bun@v2` with `actions/setup-node@v4` (Node 20, LTS)
  - Replace all `bun install` / `bun run` / `bun test` invocations with `npm`
    equivalents
  - Tests: CI pipeline passes on a push to a test branch

## Learnings

- Prefer `@effect/platform` abstractions (`FileSystem`, `Command`) over raw
  Node.js APIs — they keep code platform-agnostic and the correct runtime
  implementation is injected automatically via the platform layer
