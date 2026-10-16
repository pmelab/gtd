import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { runJudge } from "./run.js"
import { claudeShim as shimDir } from "./shim.fixture.js"

const doc = JSON.stringify({
  state: {},
  questions: [{ id: "q", primitive: "noul", instructions: "i", criteria: "c" }],
})
const cwd = tmpdir()
const env = { GTD_JUDGE_ANSWERS: '[{"id":"q","answer":true,"p":0.7}]' }

describe("runJudge", () => {
  it("writes the verdict as newline-terminated JSON", async () => {
    expect(await runJudge({ provider: "fixed", env, input: doc, cwd })).toBe(
      '[{"id":"q","answer":true,"p":0.7}]\n',
    )
  })
  it("rejects invalid JSON and a missing questions array, naming gtd judge run", async () => {
    await expect(runJudge({ provider: "fixed", env, input: "x", cwd })).rejects.toThrow(
      /gtd judge run/,
    )
    await expect(runJudge({ provider: "fixed", env, input: "{}", cwd })).rejects.toThrow(
      /gtd judge run/,
    )
  })
  it("jev without TYPESAFE_API_KEY rejects before any request", async () => {
    await expect(runJudge({ provider: "jev", env: {}, input: doc, cwd })).rejects.toThrow(
      "gtd judge run: --provider jev needs TYPESAFE_API_KEY",
    )
  })

  const answer = JSON.stringify({ structured_output: { q: { answer: "yes", p: 0.8 } } })

  it("auto selects jev when keyed and never falls back to the llm", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "gtd-run-marker-")), "ran")
    const dir = shimDir(`touch ${marker}; echo '${answer}'`)
    await expect(
      runJudge({
        provider: undefined,
        env: {
          PATH: `${dir}:/bin:/usr/bin`,
          TYPESAFE_API_KEY: "k",
          JEV_BASE_URL: "http://127.0.0.1:1/x",
        },
        input: doc,
        cwd,
      }),
    ).rejects.toThrow(/gtd judge run: jev request failed/)
    expect(existsSync(marker)).toBe(false)
  })

  it("refuses --model alongside a provider that is not the llm", async () => {
    await expect(
      runJudge({
        provider: "jev",
        model: "sonnet",
        env: { TYPESAFE_API_KEY: "k" },
        input: doc,
        cwd,
      }),
    ).rejects.toThrow("gtd judge run: a model only applies to provider llm, not jev")
  })

  it("auto selects the llm when --model is given, even with TYPESAFE_API_KEY set", async () => {
    const dir = shimDir(`echo '${answer}'`)
    expect(
      await runJudge({
        provider: undefined,
        model: "sonnet",
        env: { PATH: `${dir}:/bin:/usr/bin`, TYPESAFE_API_KEY: "k" },
        input: doc,
        cwd,
      }),
    ).toBe('[{"id":"q","answer":"yes","p":0.8}]\n')
  })
})

describe("runJudge with a user-level judge.json", () => {
  const home = (config: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "gtd-judge-home-"))
    mkdirSync(join(dir, "gtd"))
    writeFileSync(join(dir, "gtd", "judge.json"), config)
    return dir
  }

  it("layers per field: a flag provider with the file's model", async () => {
    const dir = shimDir(
      `echo '${JSON.stringify({ structured_output: { q: { answer: "yes", p: 0.8 } } })}'`,
    )
    expect(
      await runJudge({
        provider: "llm",
        env: { PATH: `${dir}:/bin:/usr/bin`, XDG_CONFIG_HOME: home('{"model":"file"}') },
        input: doc,
        cwd,
      }),
    ).toBe('[{"id":"q","answer":"yes","p":0.8}]\n')
  })
  it("empty GTD_JUDGE_* values count as unset", async () => {
    expect(
      await runJudge({
        provider: undefined,
        env: {
          ...env,
          GTD_JUDGE_PROVIDER: "",
          GTD_JUDGE_MODEL: "",
          XDG_CONFIG_HOME: home('{"provider":"fixed"}'),
        },
        input: doc,
        cwd,
      }),
    ).toBe('[{"id":"q","answer":true,"p":0.7}]\n')
  })
  it("ranks GTD_JUDGE_PROVIDER above the user file", async () => {
    await expect(
      runJudge({
        provider: undefined,
        env: { ...env, GTD_JUDGE_PROVIDER: "jev", XDG_CONFIG_HOME: home('{"provider":"fixed"}') },
        input: doc,
        cwd,
      }),
    ).rejects.toThrow("gtd judge run: --provider jev needs TYPESAFE_API_KEY")
  })
  it("falls back to ~/.config without XDG_CONFIG_HOME", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gtd-judge-home-"))
    mkdirSync(join(dir, ".config", "gtd"), { recursive: true })
    writeFileSync(join(dir, ".config", "gtd", "judge.json"), '{"provider":"fixed"}')
    expect(
      await runJudge({ provider: undefined, env: { ...env, HOME: dir }, input: doc, cwd }),
    ).toBe('[{"id":"q","answer":true,"p":0.7}]\n')
  })
  it("rejects an unknown key or provider, naming the file", async () => {
    await expect(
      runJudge({
        provider: undefined,
        env: { ...env, XDG_CONFIG_HOME: home('{"provider":"gpt"}') },
        input: doc,
        cwd,
      }),
    ).rejects.toThrow(/judge\.json: "provider" must be one of fixed, jev, llm/)
    await expect(
      runJudge({
        provider: undefined,
        env: { ...env, XDG_CONFIG_HOME: home('{"answers":"x"}') },
        input: doc,
        cwd,
      }),
    ).rejects.toThrow(/judge\.json: unknown key "answers"/)
  })
})

describe("runJudge defaultModel", () => {
  const answer = JSON.stringify({ structured_output: { q: { answer: "yes", p: 0.8 } } })
  const verdict = '[{"id":"q","answer":"yes","p":0.8}]\n'
  const argvShim = (): { dir: string; argv: () => string } => {
    const out = join(mkdtempSync(join(tmpdir(), "gtd-run-argv-")), "argv")
    const dir = shimDir(`echo "$@" > ${out}; echo '${answer}'`)
    return { dir, argv: () => readFileSync(out, "utf8") }
  }
  const home = (config: string): string => {
    const dir = mkdtempSync(join(tmpdir(), "gtd-judge-home-"))
    mkdirSync(join(dir, "gtd"))
    writeFileSync(join(dir, "gtd", "judge.json"), config)
    return dir
  }

  it("is the model when no layer sets one", async () => {
    const { dir, argv } = argvShim()
    expect(
      await runJudge({
        provider: undefined,
        defaultModel: "sonnet",
        env: { PATH: `${dir}:/bin:/usr/bin` },
        input: doc,
        cwd,
      }),
    ).toBe(verdict)
    expect(argv()).toContain("--model sonnet")
  })

  it("loses to --model, GTD_JUDGE_MODEL and judge.json", async () => {
    const flag = argvShim()
    await runJudge({
      provider: "llm",
      model: "opus",
      defaultModel: "sonnet",
      env: { PATH: `${flag.dir}:/bin:/usr/bin` },
      input: doc,
      cwd,
    })
    expect(flag.argv()).toContain("--model opus")
    const envv = argvShim()
    await runJudge({
      provider: "llm",
      defaultModel: "sonnet",
      env: { PATH: `${envv.dir}:/bin:/usr/bin`, GTD_JUDGE_MODEL: "haiku" },
      input: doc,
      cwd,
    })
    expect(envv.argv()).toContain("--model haiku")
    const file = argvShim()
    await runJudge({
      provider: "llm",
      defaultModel: "sonnet",
      env: { PATH: `${file.dir}:/bin:/usr/bin`, XDG_CONFIG_HOME: home('{"model":"file"}') },
      input: doc,
      cwd,
    })
    expect(file.argv()).toContain("--model file")
  })

  it("does not stop jev auto-selection", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "gtd-run-marker-")), "ran")
    const dir = shimDir(`touch ${marker}; echo '${answer}'`)
    await expect(
      runJudge({
        provider: undefined,
        defaultModel: "sonnet",
        env: {
          PATH: `${dir}:/bin:/usr/bin`,
          TYPESAFE_API_KEY: "k",
          JEV_BASE_URL: "http://127.0.0.1:1/x",
        },
        input: doc,
        cwd,
      }),
    ).rejects.toThrow(/gtd judge run: jev request failed/)
    expect(existsSync(marker)).toBe(false)
  })

  it("does not trip the pairing check for provider fixed", async () => {
    expect(
      await runJudge({ provider: "fixed", defaultModel: "sonnet", env, input: doc, cwd }),
    ).toBe('[{"id":"q","answer":true,"p":0.7}]\n')
  })

  it("does not trip the pairing check for provider jev", async () => {
    await expect(
      runJudge({
        provider: "jev",
        defaultModel: "sonnet",
        env: { TYPESAFE_API_KEY: "k", JEV_BASE_URL: "http://127.0.0.1:1/x" },
        input: doc,
        cwd,
      }),
    ).rejects.toThrow(/gtd judge run: jev request failed/)
  })
})
