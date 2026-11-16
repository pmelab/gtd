import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { auditLog, type AuditEntry } from "./Audit.js"

const entry = (action: string): AuditEntry => ({
  time: "2026-01-01T00:00:00.000Z",
  identity: "owner@example.com",
  endpoint: "/trpc/proceed",
  project: "portal",
  worktree: "plan",
  action,
  outcome: "accepted",
})

const lines = (file: string): unknown[] =>
  readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))

describe("auditLog", () => {
  it("appends one JSON line per entry to audit.log, readable by its owner alone", () => {
    const directory = mkdtempSync(join(tmpdir(), "gtd-audit-"))
    const log = auditLog(directory)
    log.write(entry("proceed"))
    log.write(entry("retry"))
    const file = join(directory, "audit.log")
    expect(lines(file)).toEqual([entry("proceed"), entry("retry")])
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it("moves a full log to audit.log.1 and starts a new one", () => {
    const directory = mkdtempSync(join(tmpdir(), "gtd-audit-"))
    const size = `${JSON.stringify(entry("proceed"))}\n`.length
    const log = auditLog(directory, { maxBytes: size * 2 })
    log.write(entry("one"))
    log.write(entry("two"))
    log.write(entry("thr"))
    expect(lines(join(directory, "audit.log.1"))).toEqual([entry("one"), entry("two")])
    expect(lines(join(directory, "audit.log"))).toEqual([entry("thr")])
    log.write(entry("fou"))
    log.write(entry("fiv"))
    expect(lines(join(directory, "audit.log.1"))).toEqual([entry("thr"), entry("fou")])
    expect(lines(join(directory, "audit.log"))).toEqual([entry("fiv")])
  })
})
