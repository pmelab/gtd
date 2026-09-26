import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

// Pins the ceiling closed: a child that outfills the pty buffer (~64 KiB on
// most systems) used to block in `write()` forever, get SIGKILLed at
// `IDLE_TIMEOUT_SECONDS`, and hand back truncated output with returncode -9
// (shell status 247). Lives beside the helper it guards, not in
// `src/OutcomeScript.test.ts`, which is about colour surviving a real tty,
// not throughput.
const PTY_RUNNER = resolve(import.meta.dirname, "support/run-in-pty.py")

describe("run-in-pty.py drains while the child runs", () => {
  it("returns the full output and a clean exit for a child writing well past 256 KiB", () => {
    const byteCount = 300 * 1024
    const command = `python3 -c "import sys; sys.stdout.write('a' * ${byteCount})"`

    const result = spawnSync("python3", [PTY_RUNNER, command], {
      encoding: "utf8",
      maxBuffer: byteCount * 2,
    })

    expect(result.status).toBe(0)
    expect(result.status).not.toBe(247)
    expect(result.stdout.length).toBe(byteCount)
    expect(result.stdout).toBe("a".repeat(byteCount))
  })

  // `IDLE_TIMEOUT_SECONDS` names an IDLE bound, not a total-runtime one — a
  // child still producing output past ten seconds total must survive, or
  // the constant's name is a lie.
  it("does not kill a child that keeps producing output past ten seconds total", () => {
    const command =
      'python3 -c "import sys, time\n' +
      "for _ in range(12):\n" +
      "    sys.stdout.write('x')\n" +
      "    sys.stdout.flush()\n" +
      '    time.sleep(1)\n"'
    const result = spawnSync("python3", [PTY_RUNNER, command], { encoding: "utf8" })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe("x".repeat(12))
  }, 20_000)

  // The wedge-detection behaviour both `run-in-pty.py` rewrites independently
  // fixed must survive this branch's own rewrite too: a child producing NO
  // output for the whole `IDLE_TIMEOUT_SECONDS` window is killed, not left
  // to run forever.
  it("kills a genuinely wedged child producing no output for the idle timeout", () => {
    const command = 'python3 -c "import time; time.sleep(15)"'
    const result = spawnSync("python3", [PTY_RUNNER, command], { encoding: "utf8" })

    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe("")
  }, 20_000)
})
