import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"

export type ClaudeOutcome =
  | {
      readonly kind: "exited"
      readonly code: number
      readonly stdout: string
      readonly stderr: string
    }
  | { readonly kind: "missing" }
  | { readonly kind: "timeout" }
  | { readonly kind: "unstartable"; readonly message: string }

export interface ClaudeCall {
  readonly argv: readonly string[]
  readonly stdin: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly timeoutMs: number
}

/**
 * What a judge reaches outside the process. `liveJudgeIo` reads, fetches and
 * spawns for real; an in-memory twin answers from a fake repository and
 * scripted replies, and `tests/tooling/judge-io.test.ts` holds the two to the
 * same answers.
 */
export interface JudgeIo {
  /** Rejects with the `code` a Node fs error carries — `ENOENT` for an absent file. */
  readonly readFile: (path: string) => Promise<string>
  readonly fetch: typeof fetch
  readonly claude: (call: ClaudeCall) => Promise<ClaudeOutcome>
}

export const liveJudgeIo: JudgeIo = {
  readFile: (path) => readFile(path, "utf8"),
  fetch: (input, init) => fetch(input, init),
  claude: ({ argv, stdin, env, cwd, timeoutMs }) =>
    new Promise((resolve) => {
      const child = execFile(
        "claude",
        argv,
        {
          cwd,
          env: env as NodeJS.ProcessEnv,
          timeout: timeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: 64 * 1024 * 1024,
        },
        (e, stdout, stderr) => {
          if (!e) return resolve({ kind: "exited", code: 0, stdout, stderr })
          const { code, killed, message } = e as NodeJS.ErrnoException & { killed?: boolean }
          resolve(
            code === "ENOENT"
              ? { kind: "missing" }
              : killed
                ? { kind: "timeout" }
                : typeof code === "number"
                  ? { kind: "exited", code, stdout, stderr }
                  : { kind: "unstartable", message },
          )
        },
      )
      child.stdin?.on("error", () => {})
      child.stdin?.end(stdin)
    }),
}
