import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { GtdConfigService } from "../services/Config.js"
import { GitService } from "../services/Git.js"
import { AgentService } from "../services/Agent.js"
import type { AgentInvocation, AgentResult } from "../services/Agent.js"
import { planCommand } from "./plan.js"

const defaultConfig = {
  file: "TODO.md",
  agent: "auto",
  agentPlan: "plan",
  agentBuild: "code",
  agentLearn: "plan",
  testCmd: "npm test",
  testRetries: 10,
  commitPrompt: "{{diff}}",
  agentInactivityTimeout: 300,
  agentForbiddenTools: ["AskUserQuestion"] as ReadonlyArray<string>,
}

const mockConfig = (overrides: Partial<typeof defaultConfig> = {}) =>
  Layer.succeed(GtdConfigService, { ...defaultConfig, ...overrides })

const mockGit = (overrides: Partial<GitService["Type"]> = {}) => {
  const base = {
    getDiff: () => Effect.succeed("+ new feature"),
    hasUnstagedChanges: () => Effect.succeed(false),
    add: (() => Effect.void) as GitService["Type"]["add"],
    addAll: () => Effect.void,
    commit: (() => Effect.void) as GitService["Type"]["commit"],
    show: () => Effect.succeed(""),
    ...overrides,
  }
  return Layer.succeed(GitService, {
    ...base,
    atomicCommit:
      base.atomicCommit ??
      ((files, message) =>
        Effect.gen(function* () {
          if (files === "all") yield* base.addAll()
          else yield* base.add(files)
          yield* base.commit(message)
        })),
  } satisfies GitService["Type"])
}

const mockFs = (content: string) => ({
  readFile: () => Effect.succeed(content),
  writeFile: () => Effect.void,
  exists: () => Effect.succeed(content !== ""),
})

describe("planCommand", () => {
  it.effect("invokes agent in plan mode with diff", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        invoke: (params) =>
          Effect.succeed<AgentResult>({ sessionId: undefined }).pipe(
            Effect.tap(() => Effect.sync(() => { calls.push(params) })),
          ),
        isAvailable: () => Effect.succeed(true),
      })
      yield* planCommand(mockFs("")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer)),
      )
      expect(calls.length).toBeGreaterThan(0)
      expect(calls[0]!.mode).toBe("plan")
      expect(calls[0]!.systemPrompt).toBe("")
    }),
  )

  it.effect("reads existing plan file and includes it in prompt", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        invoke: (params) =>
          Effect.succeed<AgentResult>({ sessionId: undefined }).pipe(
            Effect.tap(() => Effect.sync(() => { calls.push(params) })),
          ),
        isAvailable: () => Effect.succeed(true),
      })
      const existingPlan = `# Feature\n\n## Action Items\n\n- [ ] Item\n  - Detail\n  - Tests: check\n`
      yield* planCommand(mockFs(existingPlan)).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer)),
      )
      expect(calls[0]!.prompt).toContain("Feature")
    }),
  )

  it.effect("calls git add and commit", () =>
    Effect.gen(function* () {
      const gitCalls: string[] = []
      const gitLayer = mockGit({
        add: (files) =>
          Effect.sync(() => {
            gitCalls.push(`add:${files.join(",")}`)
          }),
        commit: (msg) =>
          Effect.sync(() => {
            gitCalls.push(`commit:${msg}`)
          }),
      })
      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.succeed<AgentResult>({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })
      yield* planCommand(mockFs("")).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), gitLayer, agentLayer)),
      )
      expect(gitCalls).toContain("add:TODO.md")
      expect(gitCalls.some((c) => c.startsWith("commit:"))).toBe(true)
      expect(gitCalls).toContain("commit:🤖 plan: update TODO.md")
    }),
  )

  it.effect("saves session ID to .gtd-session when agent returns one", () =>
    Effect.gen(function* () {
      let savedSessionId: string | undefined
      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.succeed<AgentResult>({ sessionId: "plan-ses-abc" }),
        isAvailable: () => Effect.succeed(true),
      })
      const fs = {
        ...mockFs(""),
        writeSessionId: (id: string) =>
          Effect.sync(() => {
            savedSessionId = id
          }),
      }
      yield* planCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer)),
      )
      expect(savedSessionId).toBe("plan-ses-abc")
    }),
  )

  it.effect("lint retries resume the plan session", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      let callCount = 0
      const agentLayer = Layer.succeed(AgentService, {
        invoke: (params) =>
          Effect.succeed<AgentResult>({
            sessionId: callCount++ === 0 ? "plan-ses-1" : undefined,
          }).pipe(
            Effect.tap(() => Effect.sync(() => { calls.push(params) })),
          ),
        isAvailable: () => Effect.succeed(true),
      })
      // Plan with blockquote → triggers lint error
      const planWithBlockquote = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Setup",
        "",
        "- [ ] Item",
        "  - Detail",
        "  - Tests: check",
        "",
        "> Fix this",
        "",
      ].join("\n")
      // After agent "fixes" it, return clean plan
      const cleanPlan = [
        "# Feature",
        "",
        "## Action Items",
        "",
        "### Setup",
        "",
        "- [ ] Item",
        "  - Detail",
        "  - Tests: check",
        "",
      ].join("\n")
      let readCount = 0
      const fs = {
        // Reads: 0=initial plan, 1=first lint check (has errors), 2=second lint check (clean)
        readFile: () => Effect.succeed(readCount++ < 2 ? planWithBlockquote : cleanPlan),
        exists: () => Effect.succeed(true),
      }
      yield* planCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer)),
      )
      // 2 calls: initial plan + 1 lint fix
      expect(calls.length).toBe(2)
      // Lint fix should resume the plan session
      expect(calls[1]!.resumeSessionId).toBe("plan-ses-1")
    }),
  )

  it.effect("resumes previous session from .gtd-session on re-invocation", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        invoke: (params) =>
          Effect.succeed<AgentResult>({ sessionId: "plan-ses-new" }).pipe(
            Effect.tap(() => Effect.sync(() => { calls.push(params) })),
          ),
        isAvailable: () => Effect.succeed(true),
      })
      let savedSessionId: string | undefined
      const fs = {
        ...mockFs(""),
        readSessionId: () => Effect.succeed("plan-ses-prev" as string | undefined),
        writeSessionId: (id: string) =>
          Effect.sync(() => {
            savedSessionId = id
          }),
      }
      yield* planCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer)),
      )
      // Should resume the previous session
      expect(calls[0]!.resumeSessionId).toBe("plan-ses-prev")
      // Should save the new session ID
      expect(savedSessionId).toBe("plan-ses-new")
    }),
  )

  it.effect("does not resume when no previous session exists", () =>
    Effect.gen(function* () {
      const calls: AgentInvocation[] = []
      const agentLayer = Layer.succeed(AgentService, {
        invoke: (params) =>
          Effect.succeed<AgentResult>({ sessionId: undefined }).pipe(
            Effect.tap(() => Effect.sync(() => { calls.push(params) })),
          ),
        isAvailable: () => Effect.succeed(true),
      })
      const fs = {
        ...mockFs(""),
        readSessionId: () => Effect.succeed(undefined as string | undefined),
      }
      yield* planCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer)),
      )
      expect(calls[0]!.resumeSessionId).toBeUndefined()
    }),
  )

  it.effect("does not write session file when sessionId is undefined", () =>
    Effect.gen(function* () {
      let writeSessionCalled = false
      const agentLayer = Layer.succeed(AgentService, {
        invoke: () => Effect.succeed<AgentResult>({ sessionId: undefined }),
        isAvailable: () => Effect.succeed(true),
      })
      const fs = {
        ...mockFs(""),
        writeSessionId: (_id: string) =>
          Effect.sync(() => {
            writeSessionCalled = true
          }),
      }
      yield* planCommand(fs).pipe(
        Effect.provide(Layer.mergeAll(mockConfig(), mockGit(), agentLayer)),
      )
      expect(writeSessionCalled).toBe(false)
    }),
  )
})
