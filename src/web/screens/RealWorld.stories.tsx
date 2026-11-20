import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import type { DiffResult } from "../../ui/index.js"
import { widgetFormat } from "../../steering/index.js"
import { TrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { DocumentView } from "./Document.js"

/*
 * Steering files as a real process writes them: a code review, a design and a
 * findings decision for one change (per-token rate limiting in "portal"), with
 * diffs behind every hunk pointer and link.
 */

type Hunk = { readonly newStart: number; readonly lines: readonly string[] }

const hunk = (path: string, start: number, oldStart: number, lines: readonly string[]) => {
  const newLines = lines.filter((l) => !l.startsWith("-")).length
  const oldLines = lines.filter((l) => !l.startsWith("+")).length
  return {
    header: `@@ -${oldStart},${oldLines} +${start},${newLines} @@`,
    newStart: start,
    newLines,
    lines: [...lines],
    path,
  }
}

const FILES: Readonly<Record<string, readonly (Hunk & { readonly oldStart?: number })[]>> = {
  "src/limit/bucket.ts": [
    {
      newStart: 1,
      lines: [
        '+import { createHash } from "node:crypto"',
        '+import type { Redis } from "ioredis"',
        '+import refill from "./refill.lua"',
        "+",
        "+export interface Decision {",
        "+  readonly allowed: boolean",
        "+  readonly remaining: number",
        "+  readonly retryAfterMs: number",
        "+}",
        "+",
        "+export const bucket = (redis: Redis, limit: number, burst: number) => ({",
        "+  key: (token: string) => `bucket:${token}`,",
        "+  async take(token: string, cost = 1): Promise<Decision> {",
        "+    const now = Date.now()",
        "+    const [allowed, remaining, retryAfterMs] = (await redis.eval(",
        "+      refill,",
        "+      1,",
        "+      this.key(token),",
        "+      limit / 60_000,",
        "+      burst,",
        "+      cost,",
        "+      now,",
        "+    )) as [number, number, number]",
        "+    return { allowed: allowed === 1, remaining, retryAfterMs }",
        "+  },",
        "+})",
      ],
    },
  ],
  "src/limit/refill.lua": [
    {
      newStart: 1,
      lines: [
        "+local key = KEYS[1]",
        "+local rate, burst, cost, now = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])",
        '+local state = redis.call("HMGET", key, "tokens", "at")',
        "+local tokens = tonumber(state[1]) or burst",
        "+local at = tonumber(state[2]) or now",
        "+tokens = math.min(burst, tokens + (now - at) * rate)",
        "+if tokens < cost then",
        "+  return { 0, math.floor(tokens), math.ceil((cost - tokens) / rate) }",
        "+end",
        '+redis.call("HSET", key, "tokens", tokens - cost, "at", now)',
        '+redis.call("PEXPIRE", key, math.ceil(burst / rate))',
        "+return { 1, math.floor(tokens - cost), 0 }",
      ],
    },
  ],
  "src/middleware/limit.ts": [
    {
      newStart: 1,
      lines: [
        '+import type { Middleware } from "../http.js"',
        '+import type { Decision } from "../limit/bucket.js"',
        "+",
        "+const SKIP = new Set(['/health', '/ready'])",
        "+",
        "+export const limit =",
        "+  (take: (key: string) => Promise<Decision>, log: (msg: string) => void): Middleware =>",
        "+  async (req, res, next) => {",
        "+    if (SKIP.has(req.path)) return next()",
        '+    const token = req.headers.authorization?.replace(/^Bearer /, "")',
        "+    const key = token ?? `ip:${req.ip}`",
        "+    let decision: Decision",
        "+    try {",
        "+      decision = await take(key)",
        "+    } catch (error) {",
        "+      log(`rate limit skipped: ${String(error)}`)",
        "+      return next()",
        "+    }",
        '+    res.setHeader("RateLimit-Remaining", String(decision.remaining))',
        "+    if (decision.allowed) return next()",
        '+    res.setHeader("Retry-After", String(Math.floor(decision.retryAfterMs / 1000)))',
        '+    res.status(429).json({ error: "rate_limited" })',
        "+  }",
      ],
    },
  ],
  "src/app.ts": [
    {
      newStart: 16,
      oldStart: 16,
      lines: [
        "   app.use(requestId())",
        "   app.use(json({ limit: '1mb' }))",
        "+  app.use(",
        "+    limit(bucket(redis, config.rateLimit.perMinute, config.rateLimit.burst).take, log.warn),",
        "+  )",
        "   app.use(auth(config.auth))",
        "   app.use(router)",
      ],
    },
  ],
  "src/config.ts": [
    {
      newStart: 40,
      oldStart: 40,
      lines: [
        "   search: z.object({ timeoutMs: z.number().default(2_000) }),",
        "+  rateLimit: z",
        "+    .object({",
        "+      perMinute: z.number().int().positive().default(600),",
        "+      burst: z.number().int().positive().default(100),",
        "+    })",
        "+    .default({}),",
        " })",
      ],
    },
  ],
  "config/production.yaml": [
    {
      newStart: 9,
      oldStart: 9,
      lines: [
        " search:",
        "   timeoutMs: 1500",
        "+rateLimit:",
        "+  perMinute: 600",
        "+  burst: 100",
      ],
    },
  ],
  "test/limit.test.ts": [
    {
      newStart: 1,
      lines: [
        '+import { describe, expect, it } from "vitest"',
        '+import { fakeRedis } from "./support/redis.js"',
        '+import { bucket } from "../src/limit/bucket.js"',
        "+",
        '+describe("bucket", () => {',
        '+  it("allows a burst, then refuses with a retry time", async () => {',
        "+    const b = bucket(fakeRedis(), 60, 2)",
        '+    expect((await b.take("t")).allowed).toBe(true)',
        '+    expect((await b.take("t")).allowed).toBe(true)',
        '+    const third = await b.take("t")',
        "+    expect(third.allowed).toBe(false)",
        "+    expect(third.retryAfterMs).toBe(1_000)",
        "+  })",
        "+})",
      ],
    },
  ],
}

/** Answers `diff` for every pointer in the documents below from `FILES`. */
const diff = (input: unknown): DiffResult => {
  const { path } = input as { readonly path: string }
  const hunks = (FILES[path] ?? []).map((h) => hunk(path, h.newStart, h.oldStart ?? 0, h.lines))
  if (hunks.length === 0) return { kind: "no-changes" }
  return {
    kind: "hunk",
    diff: { path, hunks: hunks.map(({ path: _p, ...h }) => h) },
    hunks: hunks.map(({ path: _p, ...h }) => h),
  }
}

const meta: Meta<typeof DocumentView> = {
  title: "Screens/Real-world documents",
  component: DocumentView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <TrpcTestProvider resolvers={{ diff }}>
        <Story />
      </TrpcTestProvider>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof DocumentView>

const REVIEW = `<!-- base: 4f2c9e1a7b3d -->

# Review: per-token rate limiting

This change puts a token-bucket limiter in front of every API route. A request
over the limit gets a \`429\` with a \`Retry-After\` header. Buckets live in
Redis, so the limit holds across the three API pods.

Start with [the bucket](./src/limit/bucket.ts#1-26): everything else calls it.

## 🔍 Token bucket

A Lua script refills the bucket and takes a token in one round trip, so two
pods can never both take the last token.

- [x] ./src/limit/bucket.ts#1-26
- [ ] ./src/limit/refill.lua#1-12

## 🔍 Middleware and wiring

\`limit()\` reads the token from the \`Authorization\` header and falls back to
the client IP for anonymous calls. Health and readiness checks skip it. When
Redis is unreachable the request goes through and a warning is logged.

- [ ] ./src/middleware/limit.ts#1-23
- [ ] ./src/app.ts#18-20 wires it in before auth, so a flood of bad tokens is
      limited too

## 🔍 Configuration

Defaults are 600 requests per minute with a burst of 100. Production sets the
same values explicitly.

- [ ] ./src/config.ts#41-46
- [ ] ./config/production.yaml#11-13

## 🔍 Tests

- [ ] ./test/limit.test.ts#1-14

## ❔ Keep one bucket per IP for anonymous calls?

Behind the office proxy every anonymous request shares one IP, and so one
bucket.

- [ ] Yes
`

export const AReview: Story = {
  args: {
    filePath: ".gtd/REVIEW.md",
    context: { repo: "portal", branch: "rate-limit", label: "reviewing the change" },
    isLoading: false,
    view: widgetFormat.view(REVIEW),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("document-base")).toHaveTextContent("4f2c9e1")
    await expect(canvas.getAllByTestId("widget-review-checklist")).toHaveLength(4)
    await expect(canvas.getAllByTestId("widget-hunk")).toHaveLength(7)
  },
}

export const AReviewLinkOpensItsDiff: Story = {
  args: AReview.args!,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByText("the bucket"))
    await waitFor(() =>
      expect(canvas.getByTestId("hunk-screen")).toHaveTextContent("export const bucket"),
    )
  },
}

const DESIGN = `# Design: per-token rate limiting

## Context

The public API has no limit. Last month one integration sent 41,000 requests in
ten minutes and slowed search for every customer. Product wants a default of
600 requests per minute per token, with higher limits on paid plans.

## Approach

A token bucket per API token, stored in Redis. Each request takes one token;
the bucket refills at \`limit / 60\` tokens per second, up to its burst size.

Free plans get 600 requests per minute with a burst of 100, Team 3,000 with[^2]
500, and Enterprise 12,000 with 2,000.

\`\`\`ts
export interface Bucket {
  take(token: string, cost?: number): Promise<Decision>
}
\`\`\`

## 🔘 Where do the buckets live?

Redis already holds sessions. Buckets in process memory cost nothing, but each
of the three pods would then allow the full limit.

- [x] Redis, one key per token
- [ ] In process memory, with the limit divided by the pod count
- [ ] ✏️

## 🔘 What happens when Redis is down?[^1]

- [ ] Fail open: serve the request and log a warning
- [ ] Fail closed: answer \`503 Service Unavailable\`
- [ ] ✏️

## ☑️ Which responses carry rate-limit headers?

- [x] \`429 Too Many Requests\`, with \`Retry-After\`
- [ ] Every response, with \`RateLimit-Remaining\` and \`RateLimit-Reset\`
- [ ] ✏️

## ❔ Ship behind the \`rate-limit\` feature flag first?

- [x] Yes

## Out of scope

- Per-endpoint costs: a search counts the same as a profile read.
- A page where customers see their own usage.

[^1]: Fail open lets one bad client through for as long as Redis is down. Is
    that acceptable for an outage of an hour?

[^2]: Sales promised Enterprise customers "no limits". Check with them before
    shipping 12,000.
`

export const ADesign: Story = {
  args: {
    filePath: ".gtd/DESIGN.md",
    context: { repo: "portal", branch: "rate-limit", label: "answering the design" },
    isLoading: false,
    view: widgetFormat.view(DESIGN),
    onProceed: () => Promise.resolve(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByTestId("widget-single-select")).toHaveLength(2)
    await expect(canvas.getByTestId("widget-multi-select")).toBeInTheDocument()
    await expect(canvas.getByTestId("widget-boolean")).toBeInTheDocument()
    await expect(canvas.getByText(/Fail open lets one bad client through/)).toBeInTheDocument()
    await expect(canvas.getByText(/Sales promised Enterprise customers/)).toBeInTheDocument()
    const code = canvas.getByText("interface").closest("pre")!
    await expect(code).toHaveAttribute("data-language", "ts")
    await expect(canvas.getByText("interface")).toHaveClass("text-syntax-kw")
    await expect(canvas.getByText("503 Service Unavailable").tagName).toBe("CODE")
  },
}

const FINDINGS = `# Findings: per-token rate limiting

Three review lenses (security, tests, correctness) ran over the change. After
three fix turns, three findings are still open. Decide what happens to each.

## 🔘 F1: the bucket key holds the raw API token

**High** · security · [src/limit/bucket.ts#12](./src/limit/bucket.ts#12)

\`bucket:\${token}\` puts the token in clear text into Redis key names, which
show up in \`MONITOR\` output and the slow log. Hashing it with SHA-256 first
keeps the keys unique without exposing the token.

- [ ] Fix it: hash the token before building the key
- [ ] Accept it: Redis is private to the cluster
- [ ] ✏️

## 🔘 F2: no test covers the fail-open path

**Medium** · tests ·
[src/middleware/limit.ts#13-18](./src/middleware/limit.ts#13-18)

When \`take\` throws, the middleware logs and lets the request through. Nothing
proves it: a refactor that drops the \`try\` would turn a Redis outage into an
API outage.

- [ ] Fix it: add a test with a Redis that throws
- [ ] Defer it: open an issue and ship
- [ ] ✏️

## 🔘 F3: \`Retry-After\` rounds down to zero

**Low** · correctness ·
[src/middleware/limit.ts#21](./src/middleware/limit.ts#21)

\`Math.floor\` turns a wait of 400 ms into \`Retry-After: 0\`, so a well-behaved
client retries at once and is refused again.

- [x] Fix it: round up with \`Math.ceil\`
- [ ] Accept it
- [ ] ✏️

## Fixed by the fix turns

- A missing \`await\` on \`bucket.take\` (turn 1).
- The health check was limited (turn 2).
`

export const AFindingsDecision: Story = {
  args: {
    filePath: ".gtd/FINDINGS.md",
    context: { repo: "portal", branch: "rate-limit", label: "deciding the findings" },
    isLoading: false,
    view: widgetFormat.view(FINDINGS),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByTestId("widget-single-select")).toHaveLength(3)
    await expect(canvas.getAllByTestId("widget-required")).toHaveLength(2)
    const fixed = within(canvas.getAllByTestId("widget-single-select")[2]!)
    await expect(fixed.getAllByRole("radio")[0]).toBeChecked()
    await expect(canvas.getByText("High").tagName).toBe("STRONG")
    await expect(canvas.queryByText(/\*\*High\*\*/)).toBeNull()
  },
}

export const AFindingLocationOpensItsDiff: Story = {
  args: AFindingsDecision.args!,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByText("src/limit/bucket.ts#12"))
    await waitFor(() =>
      expect(canvas.getByTestId("hunk-screen")).toHaveTextContent("bucket:${token}"),
    )
    await expect(canvas.queryByTestId("hunk-tick")).toBeNull()
  },
}
