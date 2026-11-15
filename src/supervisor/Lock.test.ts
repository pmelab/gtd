import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { acquireLock, type Lock } from "./Lock.js"

const DEAD_PID = 999_999_999

describe("acquireLock", () => {
  it("lets only one of two supervisors take over the same stale lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "gtd-lock-"))
    writeFileSync(join(directory, "lock"), `${JSON.stringify({ pid: DEAD_PID })}\n`)
    let other: Lock | undefined
    // The other supervisor takes the lock over between this one's read and its write.
    const deadAfterTheOtherTookOver = (pid: number): boolean => {
      other ??= acquireLock(directory, "/ws", () => false)
      return pid !== DEAD_PID
    }

    expect(() => acquireLock(directory, "/ws", deadAfterTheOtherTookOver)).toThrow(
      /a supervisor already runs for \/ws/,
    )
    expect(other).toBeDefined()
    expect(JSON.parse(readFileSync(join(directory, "lock"), "utf8"))).toEqual({ pid: process.pid })
  })
})
