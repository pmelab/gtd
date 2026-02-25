import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  initBuildState,
  updatePackageStatus,
  formatDuration,
  createEventHandler,
  createSpinnerRenderer,
  createBuildRenderer,
  stripCursorSymbols,
  type BuildStatus,
} from "./Renderer.js"

describe("Renderer", () => {
  describe("initBuildState", () => {
    it("creates pending state for unchecked packages", () => {
      const packages = [
        { title: "Pkg A", items: [{ checked: false }] },
        { title: "Pkg B", items: [{ checked: false }] },
      ]
      const state = initBuildState(packages, 1000)
      expect(state.startedAt).toBe(1000)
      expect(state.packages).toEqual([
        {
          title: "Pkg A",
          status: "pending",
          startedAt: undefined,
          finishedAt: undefined,
          retryCount: 0,
          maxRetries: 0,
        },
        {
          title: "Pkg B",
          status: "pending",
          startedAt: undefined,
          finishedAt: undefined,
          retryCount: 0,
          maxRetries: 0,
        },
      ])
    })

    it("marks fully-checked packages as done", () => {
      const packages = [
        { title: "Pkg A", items: [{ checked: true }, { checked: true }] },
        { title: "Pkg B", items: [{ checked: false }] },
      ]
      const state = initBuildState(packages, 1000)
      expect(state.packages[0]!.status).toBe("done")
      expect(state.packages[1]!.status).toBe("pending")
    })

    it("handles empty package list", () => {
      const state = initBuildState([], 1000)
      expect(state.packages).toEqual([])
    })

    it("package with mixed checked/unchecked is pending", () => {
      const packages = [{ title: "Mixed", items: [{ checked: true }, { checked: false }] }]
      const state = initBuildState(packages, 1000)
      expect(state.packages[0]!.status).toBe("pending")
    })

    it("pre-done packages have no timing info", () => {
      const packages = [{ title: "Done", items: [{ checked: true }] }]
      const state = initBuildState(packages, 1000)
      expect(state.packages[0]!.startedAt).toBeUndefined()
      expect(state.packages[0]!.finishedAt).toBeUndefined()
    })
  })

  describe("updatePackageStatus", () => {
    it("updates the status of a specific package", () => {
      const state = initBuildState(
        [
          { title: "Pkg A", items: [{ checked: false }] },
          { title: "Pkg B", items: [{ checked: false }] },
        ],
        1000,
      )
      const updated = updatePackageStatus(state, "Pkg A", "building", undefined, 2000)
      expect(updated.packages[0]!.status).toBe("building")
      expect(updated.packages[0]!.startedAt).toBe(2000)
      expect(updated.packages[1]!.status).toBe("pending")
    })

    it("does not mutate original state", () => {
      const state = initBuildState([{ title: "Pkg A", items: [{ checked: false }] }], 1000)
      const updated = updatePackageStatus(state, "Pkg A", "done", undefined, 5000)
      expect(state.packages[0]!.status).toBe("pending")
      expect(updated.packages[0]!.status).toBe("done")
    })

    it("handles non-existent package title (no-op)", () => {
      const state = initBuildState([{ title: "Pkg A", items: [{ checked: false }] }], 1000)
      const updated = updatePackageStatus(state, "Missing", "building", undefined, 2000)
      expect(updated.packages).toEqual(state.packages)
    })

    it("transitions through all statuses", () => {
      let state = initBuildState([{ title: "Pkg", items: [{ checked: false }] }], 1000)
      const statuses: BuildStatus[] = ["building", "testing", "done"]
      for (const status of statuses) {
        state = updatePackageStatus(state, "Pkg", status, undefined, 2000)
        expect(state.packages[0]!.status).toBe(status)
      }
    })

    it("can set failed status", () => {
      const state = initBuildState([{ title: "Pkg", items: [{ checked: false }] }], 1000)
      const updated = updatePackageStatus(state, "Pkg", "failed", undefined, 5000)
      expect(updated.packages[0]!.status).toBe("failed")
    })

    it("sets startedAt on first non-pending transition", () => {
      const state = initBuildState([{ title: "Pkg", items: [{ checked: false }] }], 1000)
      const updated = updatePackageStatus(state, "Pkg", "building", undefined, 2000)
      expect(updated.packages[0]!.startedAt).toBe(2000)
    })

    it("preserves startedAt on subsequent transitions", () => {
      let state = initBuildState([{ title: "Pkg", items: [{ checked: false }] }], 1000)
      state = updatePackageStatus(state, "Pkg", "building", undefined, 2000)
      state = updatePackageStatus(state, "Pkg", "testing", undefined, 3000)
      expect(state.packages[0]!.startedAt).toBe(2000)
    })

    it("sets finishedAt on done", () => {
      let state = initBuildState([{ title: "Pkg", items: [{ checked: false }] }], 1000)
      state = updatePackageStatus(state, "Pkg", "building", undefined, 2000)
      state = updatePackageStatus(state, "Pkg", "done", undefined, 5000)
      expect(state.packages[0]!.finishedAt).toBe(5000)
    })

    it("sets finishedAt on failed", () => {
      let state = initBuildState([{ title: "Pkg", items: [{ checked: false }] }], 1000)
      state = updatePackageStatus(state, "Pkg", "building", undefined, 2000)
      state = updatePackageStatus(state, "Pkg", "failed", undefined, 5000)
      expect(state.packages[0]!.finishedAt).toBe(5000)
    })

    it("stores retryInfo", () => {
      let state = initBuildState([{ title: "Pkg", items: [{ checked: false }] }], 1000)
      state = updatePackageStatus(state, "Pkg", "testing", { current: 2, max: 4 }, 3000)
      expect(state.packages[0]!.retryCount).toBe(2)
      expect(state.packages[0]!.maxRetries).toBe(4)
    })
  })

  describe("formatDuration", () => {
    it("returns '<1s' for sub-second", () => {
      expect(formatDuration(0)).toBe("<1s")
      expect(formatDuration(500)).toBe("<1s")
      expect(formatDuration(999)).toBe("<1s")
    })

    it("returns seconds for < 60s", () => {
      expect(formatDuration(1000)).toBe("1s")
      expect(formatDuration(5000)).toBe("5s")
      expect(formatDuration(59000)).toBe("59s")
    })

    it("returns minutes and seconds", () => {
      expect(formatDuration(60000)).toBe("1m")
      expect(formatDuration(90000)).toBe("1m30s")
      expect(formatDuration(135000)).toBe("2m15s")
    })

    it("omits seconds when exactly on the minute", () => {
      expect(formatDuration(120000)).toBe("2m")
    })
  })

  describe("createEventHandler", () => {
    let writeSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    })

    afterEach(() => {
      writeSpy.mockRestore()
    })

    it("writes output on ThinkingDelta when verbose=true", () => {
      const handler = createEventHandler(true)
      handler.onEvent({ _tag: "ThinkingDelta", delta: "some thought" })
      expect(writeSpy).toHaveBeenCalled()
    })

    it("writes nothing on ThinkingDelta when verbose=false", () => {
      const handler = createEventHandler(false)
      handler.onEvent({ _tag: "ThinkingDelta", delta: "some thought" })
      expect(writeSpy).not.toHaveBeenCalled()
    })

    it("still handles subsequent non-thinking event cleanly when verbose=false", () => {
      const handler = createEventHandler(false)
      expect(() => {
        handler.onEvent({ _tag: "ThinkingDelta", delta: "thought" })
        handler.onEvent({ _tag: "ToolStart", toolName: "bash", toolInput: {} })
      }).not.toThrow()
    })

    it("writes nothing on ToolStart when verbose=false", () => {
      const handler = createEventHandler(false)
      handler.onEvent({ _tag: "ToolStart", toolName: "bash", toolInput: {} })
      expect(writeSpy).not.toHaveBeenCalled()
    })

    it("writes 🔨 line on ToolStart when verbose=true", () => {
      const handler = createEventHandler(true)
      handler.onEvent({ _tag: "ToolStart", toolName: "bash", toolInput: {} })
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).toContain("🔨")
      expect(allOutput).toContain("bash")
    })

    it("does not double-newline or crash after ThinkingDelta when verbose=false", () => {
      const handler = createEventHandler(false)
      expect(() => {
        handler.onEvent({ _tag: "ThinkingDelta", delta: "thought" })
        handler.onEvent({ _tag: "TurnEnd", text: "done" })
      }).not.toThrow()
    })

    it("leaves no residual █ in stdout after ThinkingDelta → TurnEnd → ToolStart (verbose=true)", () => {
      vi.useFakeTimers()
      const handler = createEventHandler(true)
      handler.onEvent({ _tag: "ThinkingDelta", delta: "some thought" })
      handler.onEvent({ _tag: "TurnEnd", text: "done" })
      handler.onEvent({ _tag: "ToolStart", toolName: "bash", toolInput: {} })
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\u2588")
      vi.useRealTimers()
    })

    it("leaves no residual █ in stdout after two ThinkingDelta → ToolStart (verbose=true)", () => {
      vi.useFakeTimers()
      const handler = createEventHandler(true)
      handler.onEvent({ _tag: "ThinkingDelta", delta: "first chunk" })
      handler.onEvent({ _tag: "ThinkingDelta", delta: "second chunk" })
      handler.onEvent({ _tag: "ToolStart", toolName: "bash", toolInput: {} })
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\u2588")
      vi.useRealTimers()
    })

    it("leaves no residual █ in stdout after two ThinkingDelta → ToolStart with timer advance (verbose=true)", () => {
      vi.useFakeTimers()
      const handler = createEventHandler(true)
      handler.onEvent({ _tag: "ThinkingDelta", delta: "first chunk" })
      handler.onEvent({ _tag: "ThinkingDelta", delta: "second chunk" })
      vi.advanceTimersByTime(1060)
      handler.onEvent({ _tag: "ToolStart", toolName: "bash", toolInput: {} })
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\u2588")
      vi.useRealTimers()
    })

    it("no cursor-blink escape sequences in ThinkingDelta → ToolStart flow (verbose=true)", () => {
      const handler = createEventHandler(true)
      handler.onEvent({ _tag: "ThinkingDelta", delta: "thinking..." })
      handler.onEvent({ _tag: "ToolStart", toolName: "bash", toolInput: {} })
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\x1b[?25l")
      expect(allOutput).not.toContain("\x1b[1D")
      expect(allOutput).not.toContain("\u2588")
    })

    it("no cursor-blink escape sequences in ThinkingDelta → ToolStart flow (verbose=false)", () => {
      const handler = createEventHandler(false)
      handler.onEvent({ _tag: "ThinkingDelta", delta: "thinking..." })
      handler.onEvent({ _tag: "ToolStart", toolName: "bash", toolInput: {} })
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\x1b[?25l")
      expect(allOutput).not.toContain("\x1b[1D")
      expect(allOutput).not.toContain("\u2588")
    })
  })

  describe("createSpinnerRenderer", () => {
    let writeSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    })

    afterEach(() => {
      writeSpy.mockRestore()
      vi.useRealTimers()
    })

    it("suppresses ThinkingDelta output when interactive=true, verbose=false", () => {
      vi.useFakeTimers()
      const renderer = createSpinnerRenderer(true, false)
      renderer.onEvent({ _tag: "ThinkingDelta", delta: "thinking..." })
      expect(writeSpy).not.toHaveBeenCalled()
      renderer.dispose()
    })

    it("emits ThinkingDelta output when interactive=true, verbose=true", () => {
      vi.useFakeTimers()
      const renderer = createSpinnerRenderer(true, true)
      renderer.onEvent({ _tag: "ThinkingDelta", delta: "thinking..." })
      expect(writeSpy).toHaveBeenCalled()
      renderer.dispose()
    })

    it("emits a newline between setTextWithCursor and succeed", () => {
      vi.useFakeTimers()
      const renderer = createSpinnerRenderer(true, false)
      renderer.setTextWithCursor("Planning...")
      renderer.succeed("Done")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const planningPos = allOutput.indexOf("Planning...")
      const donePos = allOutput.indexOf("Done")
      expect(planningPos).toBeGreaterThanOrEqual(0)
      expect(donePos).toBeGreaterThan(planningPos)
      expect(allOutput.slice(planningPos, donePos)).toContain("\n")
      expect(allOutput.slice(planningPos, donePos)).not.toContain("\n\n")
      renderer.dispose()
    })

    it("emits a newline between setTextWithCursor and succeed after thinking events", () => {
      vi.useFakeTimers()
      const renderer = createSpinnerRenderer(true, false)
      renderer.setTextWithCursor("Planning...")
      renderer.onEvent({ _tag: "ThinkingDelta", delta: "some thought" })
      renderer.onEvent({ _tag: "TurnEnd", text: "result" })
      renderer.succeed("Done")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const planningPos = allOutput.indexOf("Planning...")
      const donePos = allOutput.indexOf("Done")
      expect(planningPos).toBeGreaterThanOrEqual(0)
      expect(donePos).toBeGreaterThan(planningPos)
      expect(allOutput.slice(planningPos, donePos)).toContain("\n")
      expect(allOutput.slice(planningPos, donePos)).not.toContain("\n\n")
      renderer.dispose()
    })

    it("emits a newline between setTextWithCursor and fail", () => {
      vi.useFakeTimers()
      const renderer = createSpinnerRenderer(true, false)
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
      renderer.setTextWithCursor("Planning...")
      renderer.fail("Oops")
      const stdoutOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const planningPos = stdoutOutput.indexOf("Planning...")
      expect(planningPos).toBeGreaterThanOrEqual(0)
      expect(stdoutOutput.slice(planningPos)).toContain("\n")
      stderrSpy.mockRestore()
      renderer.dispose()
    })

    it("emits a newline between setTextWithCursor and setText", () => {
      vi.useFakeTimers()
      const renderer = createSpinnerRenderer(true, false)
      renderer.setTextWithCursor("Planning...")
      renderer.setText("Running...")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const planningPos = allOutput.indexOf("Planning...")
      const runningPos = allOutput.indexOf("Running...")
      expect(planningPos).toBeGreaterThanOrEqual(0)
      expect(runningPos).toBeGreaterThan(planningPos)
      expect(allOutput.slice(planningPos, runningPos)).toContain("\n")
      renderer.dispose()
    })

    it("leaves no residual █ in stdout after setTextWithCursor → ThinkingDelta → succeed (verbose=false)", () => {
      vi.useFakeTimers()
      const renderer = createSpinnerRenderer(true, false)
      renderer.setTextWithCursor("Planning...")
      renderer.onEvent({ _tag: "ThinkingDelta", delta: "some thought" })
      renderer.succeed("Done")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\u2588")
      renderer.dispose()
    })

    it("leaves no residual █ in stdout after setTextWithCursor → ThinkingDelta → succeed (verbose=true)", () => {
      vi.useFakeTimers()
      const renderer = createSpinnerRenderer(true, true)
      renderer.setTextWithCursor("Planning...")
      renderer.onEvent({ _tag: "ThinkingDelta", delta: "some thought" })
      renderer.succeed("Done")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\u2588")
      renderer.dispose()
    })

    it("setTextWithCursor ends with \\n (no cursor timer)", () => {
      const renderer = createSpinnerRenderer(true, false)
      renderer.setTextWithCursor("Planning...")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const planningPos = allOutput.indexOf("Planning...")
      expect(planningPos).toBeGreaterThanOrEqual(0)
      const afterPlanning = allOutput.slice(planningPos + "Planning...".length)
      expect(afterPlanning.startsWith("\n")).toBe(true)
      renderer.dispose()
    })

    it("setTextWithCursor does not write HIDE_CURSOR sequence", () => {
      const renderer = createSpinnerRenderer(true, false)
      renderer.setTextWithCursor("Planning...")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\x1b[?25l")
      renderer.dispose()
    })

    it("stopCursor produces no CLEAR_CHAR or SHOW_CURSOR output", () => {
      const renderer = createSpinnerRenderer(true, false)
      renderer.setTextWithCursor("Planning...")
      writeSpy.mockClear()
      renderer.stopCursor()
      const stopOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(stopOutput).not.toContain("\x1b[1D")
      expect(stopOutput).not.toContain("\x1b[?25h")
      renderer.dispose()
    })

    it("setText ends with \\n (interactive=true, verbose=false)", () => {
      const renderer = createSpinnerRenderer(true, false)
      renderer.setText("Running...")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const pos = allOutput.indexOf("Running...")
      expect(pos).toBeGreaterThanOrEqual(0)
      expect(allOutput.slice(pos + "Running...".length).startsWith("\n")).toBe(true)
      renderer.dispose()
    })

    it("succeed ends with \\n (interactive=true, verbose=false)", () => {
      const renderer = createSpinnerRenderer(true, false)
      renderer.succeed("Done")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const pos = allOutput.indexOf("Done")
      expect(pos).toBeGreaterThanOrEqual(0)
      expect(allOutput.slice(pos + "Done".length).startsWith("\n")).toBe(true)
      renderer.dispose()
    })

    it("fail ends with \\n on stderr (interactive=true, verbose=false)", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true)
      const renderer = createSpinnerRenderer(true, false)
      renderer.fail("Error")
      const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("")
      const pos = stderrOutput.indexOf("Error")
      expect(pos).toBeGreaterThanOrEqual(0)
      expect(stderrOutput.slice(pos + "Error".length).startsWith("\n")).toBe(true)
      stderrSpy.mockRestore()
      renderer.dispose()
    })

    it("setTextWithCursor then succeed are separated by \\n (verbose=true)", () => {
      const renderer = createSpinnerRenderer(true, true)
      renderer.setTextWithCursor("Planning...")
      renderer.succeed("Done")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const planningPos = allOutput.indexOf("Planning...")
      const donePos = allOutput.indexOf("Done")
      expect(planningPos).toBeGreaterThanOrEqual(0)
      expect(donePos).toBeGreaterThan(planningPos)
      expect(allOutput.slice(planningPos, donePos)).toContain("\n")
      renderer.dispose()
    })

    it("setText then succeed are separated by \\n (verbose=true)", () => {
      const renderer = createSpinnerRenderer(true, true)
      renderer.setText("Running...")
      renderer.succeed("Done")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const runningPos = allOutput.indexOf("Running...")
      const donePos = allOutput.indexOf("Done")
      expect(runningPos).toBeGreaterThanOrEqual(0)
      expect(donePos).toBeGreaterThan(runningPos)
      expect(allOutput.slice(runningPos, donePos)).toContain("\n")
      renderer.dispose()
    })

    it("ThinkingDelta stream ends with \\n\\n via endThinking before next message (verbose=true)", () => {
      const renderer = createSpinnerRenderer(true, true)
      renderer.setTextWithCursor("Step 1")
      renderer.onEvent({ _tag: "ThinkingDelta", delta: "thought" })
      renderer.onEvent({ _tag: "TurnEnd", text: "done" })
      renderer.setTextWithCursor("Step 2")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const thoughtPos = allOutput.indexOf("thought")
      const step2Pos = allOutput.indexOf("Step 2")
      expect(thoughtPos).toBeGreaterThanOrEqual(0)
      expect(step2Pos).toBeGreaterThan(thoughtPos)
      const between = allOutput.slice(thoughtPos + "thought".length, step2Pos)
      expect(between).toContain("\n\n")
      renderer.dispose()
    })
  })

  describe("non-interactive branch (interactive=false)", () => {
    let logSpy: ReturnType<typeof vi.spyOn>
    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    })

    afterEach(() => {
      logSpy.mockRestore()
      errorSpy.mockRestore()
    })

    it("strips █ from setText input", () => {
      const renderer = createSpinnerRenderer(false, false)
      renderer.setText("Hello \u2588 World")
      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\u2588")
      expect(allOutput).toContain("Hello  World")
    })

    it("strips █ from setTextWithCursor input", () => {
      const renderer = createSpinnerRenderer(false, false)
      renderer.setTextWithCursor("Planning\u2588...")
      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\u2588")
    })

    it("strips █ from succeed input", () => {
      const renderer = createSpinnerRenderer(false, false)
      renderer.succeed("Done \u2588")
      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\u2588")
    })

    it("strips █ from fail input", () => {
      const renderer = createSpinnerRenderer(false, false)
      renderer.fail("Error \u2588")
      const allOutput = errorSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\u2588")
    })

    it("strips HIDE_CURSOR sequence from setText input", () => {
      const renderer = createSpinnerRenderer(false, false)
      renderer.setText("Hello \x1b[?25l World")
      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\x1b[?25l")
    })

    it("strips SHOW_CURSOR sequence from setText input", () => {
      const renderer = createSpinnerRenderer(false, false)
      renderer.setText("Hello \x1b[?25h World")
      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\x1b[?25h")
    })

    it("strips CLEAR_CHAR sequence from setText input", () => {
      const renderer = createSpinnerRenderer(false, false)
      renderer.setText("Hello \x1b[1D World")
      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\x1b[1D")
    })

    it("preserves normal text after stripping", () => {
      const renderer = createSpinnerRenderer(false, false)
      renderer.setText("Building package A")
      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).toContain("Building package A")
    })

    it("consecutive setTextWithCursor calls produce separate console.log calls", () => {
      const renderer = createSpinnerRenderer(false, false)
      renderer.setTextWithCursor("Step 1")
      renderer.setTextWithCursor("Step 2")
      expect(logSpy).toHaveBeenCalledTimes(2)
      expect(String(logSpy.mock.calls[0]![0])).toContain("Step 1")
      expect(String(logSpy.mock.calls[1]![0])).toContain("Step 2")
    })
  })

  describe("stripCursorSymbols", () => {
    it("removes block cursor character", () => {
      expect(stripCursorSymbols("hello \u2588 world")).toBe("hello  world")
    })

    it("removes HIDE_CURSOR sequence", () => {
      expect(stripCursorSymbols("text\x1b[?25lmore")).toBe("textmore")
    })

    it("removes SHOW_CURSOR sequence", () => {
      expect(stripCursorSymbols("text\x1b[?25hmore")).toBe("textmore")
    })

    it("removes CLEAR_CHAR sequence", () => {
      expect(stripCursorSymbols("text\x1b[1Dmore")).toBe("textmore")
    })

    it("removes multiple occurrences", () => {
      expect(stripCursorSymbols("\u2588\u2588\x1b[1D\x1b[?25l")).toBe("")
    })

    it("returns plain text unchanged", () => {
      expect(stripCursorSymbols("plain text")).toBe("plain text")
    })

    it("handles empty string", () => {
      expect(stripCursorSymbols("")).toBe("")
    })
  })

  describe("createBuildRenderer", () => {
    let writeSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    })

    afterEach(() => {
      writeSpy.mockRestore()
      vi.useRealTimers()
    })

    it("emits a newline between setTextWithCursor and setStatus", () => {
      const packages = [{ title: "Pkg A", items: [{ checked: false }] }]
      const renderer = createBuildRenderer(packages, true, false)
      renderer.setTextWithCursor("Planning...")
      renderer.setStatus("Pkg A", "building")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const planningPos = allOutput.indexOf("Planning...")
      const buildingPos = allOutput.indexOf("Building")
      expect(planningPos).toBeGreaterThanOrEqual(0)
      expect(buildingPos).toBeGreaterThan(planningPos)
      expect(allOutput.slice(planningPos, buildingPos)).toContain("\n")
      renderer.dispose()
    })

    it("setTextWithCursor ends with \\n (no cursor timer)", () => {
      const packages = [{ title: "Pkg A", items: [{ checked: false }] }]
      const renderer = createBuildRenderer(packages, true, false)
      renderer.setTextWithCursor("Planning...")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const planningPos = allOutput.indexOf("Planning...")
      expect(planningPos).toBeGreaterThanOrEqual(0)
      const afterPlanning = allOutput.slice(planningPos + "Planning...".length)
      expect(afterPlanning.startsWith("\n")).toBe(true)
      renderer.dispose()
    })

    it("setTextWithCursor does not write HIDE_CURSOR sequence", () => {
      const packages = [{ title: "Pkg A", items: [{ checked: false }] }]
      const renderer = createBuildRenderer(packages, true, false)
      renderer.setTextWithCursor("Planning...")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).not.toContain("\x1b[?25l")
      renderer.dispose()
    })

    it("stopCursor produces no CLEAR_CHAR or SHOW_CURSOR output", () => {
      const packages = [{ title: "Pkg A", items: [{ checked: false }] }]
      const renderer = createBuildRenderer(packages, true, false)
      renderer.setTextWithCursor("Planning...")
      writeSpy.mockClear()
      renderer.stopCursor()
      const stopOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(stopOutput).not.toContain("\x1b[1D")
      expect(stopOutput).not.toContain("\x1b[?25h")
      renderer.dispose()
    })

    it("finish ends with \\n (interactive=true)", () => {
      const packages = [{ title: "Pkg A", items: [{ checked: false }] }]
      const renderer = createBuildRenderer(packages, true, false)
      renderer.finish("All done.")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      expect(allOutput).toContain("All done.")
      expect(allOutput.endsWith("\n")).toBe(true)
      renderer.dispose()
    })

    it("setTextWithCursor then setStatus are separated by \\n (verbose=true)", () => {
      const packages = [{ title: "Pkg A", items: [{ checked: false }] }]
      const renderer = createBuildRenderer(packages, true, true)
      renderer.setTextWithCursor("Planning...")
      renderer.setStatus("Pkg A", "building")
      const allOutput = writeSpy.mock.calls.map((c) => String(c[0])).join("")
      const planningPos = allOutput.indexOf("Planning...")
      const buildingPos = allOutput.indexOf("Building")
      expect(planningPos).toBeGreaterThanOrEqual(0)
      expect(buildingPos).toBeGreaterThan(planningPos)
      expect(allOutput.slice(planningPos, buildingPos)).toContain("\n")
      renderer.dispose()
    })
  })

  describe("non-interactive createBuildRenderer", () => {
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    })

    afterEach(() => {
      logSpy.mockRestore()
    })

    it("consecutive setTextWithCursor calls produce separate console.log calls", () => {
      const packages = [{ title: "Pkg A", items: [{ checked: false }] }]
      const renderer = createBuildRenderer(packages, false, false)
      renderer.setTextWithCursor("Step 1")
      renderer.setTextWithCursor("Step 2")
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes("Step 1"))).toBe(true)
      expect(logSpy.mock.calls.some((c) => String(c[0]).includes("Step 2"))).toBe(true)
      const step1CallIndex = logSpy.mock.calls.findIndex((c) => String(c[0]).includes("Step 1"))
      const step2CallIndex = logSpy.mock.calls.findIndex((c) => String(c[0]).includes("Step 2"))
      expect(step2CallIndex).toBeGreaterThan(step1CallIndex)
      renderer.dispose()
    })
  })
})
