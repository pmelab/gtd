import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { networkInterfaces, tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { liveHeadSha, liveRunInWorktree, readLocalGtdVersionAt } from "./Beat.js"
import { UiHost } from "./Ports.js"
import { deleteServeRecord, readServeRecord, writeServeRecord } from "./Serve.js"
import { liveReadFile, liveWriteFile } from "./Write.js"

export const liveUiHost: Layer.Layer<UiHost> = Layer.succeed(UiHost, {
  run: liveRunInWorktree,
  headSha: liveHeadSha,
  readLocalGtdVersion: readLocalGtdVersionAt,
  readFile: liveReadFile,
  writeFile: liveWriteFile,
  networkInterfaces: () => networkInterfaces(),
  serveRecords: {
    read: (servePort) => readServeRecord(servePort),
    write: (servePort, record) => writeServeRecord(servePort, record),
    delete: (servePort) => deleteServeRecord(servePort),
  },
  // `kill(pid, 0)` sends no signal, only probes: it throws for a dead pid.
  isPidAlive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  },
  scratch: (body) =>
    Effect.acquireUseRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "gtd-tls-"))),
      (dir) => body(dir, (name) => readFileSync(join(dir, name), "utf8")),
      (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
    ),
})
