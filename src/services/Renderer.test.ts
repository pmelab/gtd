import { describe, it, expect } from "vitest"
import {
  initBuildState,
  updatePackageStatus,
  formatDuration,
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
})
