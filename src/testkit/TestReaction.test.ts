import { describe, expect, it } from "vitest"
import { reaction } from "../workspace/index.js"
import { testReaction } from "./TestReaction.js"

const autofix = reaction({
  on: { to: "error", errorKind: ["driver", "crashed"] },
  run: async (change, ctx) => {
    const out = await ctx.exec(["triage", change.commit])
    ctx.log(`triage: ${out.stdout.trim()}`)
    if (out.stdout.includes("flaky")) {
      const retried = await ctx.retry(change.commit)
      if (!retried.ok) await ctx.notify({ title: "retry refused", body: retried.message })
      return
    }
    await ctx.action("error:fix", { hint: out.stdout.trim() })
  },
})

const crashed = {
  project: "portal",
  worktree: "/code/portal.wt/build",
  branch: "build",
  from: "working",
  to: "error",
  errorKind: "crashed",
  label: "Build",
  commit: "abc123",
} as const

describe("testReaction", () => {
  it("runs a matching reaction and records what it did through ctx", async () => {
    const result = await testReaction(autofix, crashed, {
      exec: (argv, options) => ({
        status: 0,
        stdout: `${argv.join(" ")} in ${options?.cwd} is flaky\n`,
        stderr: "",
      }),
    })

    expect(result).toEqual({
      ran: true,
      logs: ["triage: triage abc123 in /code/portal.wt/build is flaky"],
      calls: [{ call: "retry", commit: "abc123" }],
    })
  })

  it("answers ctx.action, ctx.proceed and ctx.retry as the test says", async () => {
    const result = await testReaction(autofix, crashed, {
      exec: () => ({ status: 0, stdout: "flaky", stderr: "" }),
      answer: (call) =>
        call.call === "retry" ? { ok: false, message: "HEAD moved" } : { ok: true },
    })

    expect(result.calls).toEqual([
      { call: "retry", commit: "abc123" },
      { call: "notify", title: "retry refused", body: "HEAD moved", priority: "default" },
    ])
  })

  it("records an action with its values", async () => {
    const result = await testReaction(autofix, crashed, {
      exec: () => ({ status: 0, stdout: "missing key\n", stderr: "" }),
    })

    expect(result.calls).toEqual([
      { call: "action", id: "error:fix", values: { hint: "missing key" } },
    ])
  })

  it("does not run a reaction whose filter does not match the change", async () => {
    const result = await testReaction(autofix, { ...crashed, errorKind: "stalled" })

    expect(result).toEqual({ ran: false, logs: [], calls: [] })
  })

  it("passes atStartup, false unless the change says so", async () => {
    const seen: boolean[] = []
    const startup = reaction({ on: {}, run: (change) => void seen.push(change.atStartup) })

    await testReaction(startup, crashed)
    await testReaction(startup, { ...crashed, atStartup: true })

    expect(seen).toEqual([false, true])
  })

  it("reports a run that throws as its failure", async () => {
    const broken = reaction({
      on: {},
      run: () => {
        throw new Error("triage service is down")
      },
    })

    expect(await testReaction(broken, crashed)).toEqual({
      ran: true,
      failure: "triage service is down",
      logs: [],
      calls: [],
    })
  })

  it("fails a run that runs a command the test did not script", async () => {
    expect((await testReaction(autofix, crashed)).failure).toBe(
      "testReaction: no exec given for triage abc123",
    )
  })
})
