/**
 * `src/Install.ts` is pure string data — these tests pin its two load-bearing
 * properties: `MINIMAL_DRIVER` stays byte-equal to docs/driver.md's own
 * fenced driver block (the single source of truth for both), and
 * `renderBriefing()` names every command/field a driver actually invokes, so
 * a protocol change elsewhere can't silently drift the briefing out of sync.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import {
  EDIT_COMMAND,
  FIX_COMMAND,
  MINIMAL_DRIVER,
  REVIEW_COMMAND,
  renderBriefing,
} from "./Install.js"

const _require = createRequire(import.meta.url)
const GTD_VERSION: string = (_require("../package.json") as { version: string }).version

describe("MINIMAL_DRIVER", () => {
  it("equals docs/driver.md's own 'A complete minimal driver' fenced bash block", () => {
    const doc = readFileSync(resolve(import.meta.dirname, "../docs/driver.md"), "utf8")
    const match = doc.match(/### A complete minimal driver\n[\s\S]*?```bash\n([\s\S]*?)\n```/)
    expect(match).not.toBeNull()
    expect(match![1]).toBe(MINIMAL_DRIVER)
  })
})

describe("renderBriefing", () => {
  it("embeds MINIMAL_DRIVER verbatim", () => {
    expect(renderBriefing()).toContain(MINIMAL_DRIVER)
  })

  it("names every command a driver invokes", () => {
    const briefing = renderBriefing()
    expect(briefing).toContain("gtd next --json")
    expect(briefing).toContain("gtd next")
    expect(briefing).toContain("gtd land")
    expect(briefing).not.toContain("gtd status --json")
    // The bare whole-document form is never recommended — only the
    // `--json=<path>` selector form (e.g. `gtd land --json=script`).
    expect(briefing).not.toMatch(/gtd land --json(?!=)/)
    expect(briefing).not.toContain("--dispatch")
    expect(briefing).not.toContain("--if-resting")
    expect(briefing).not.toContain("gtd step")
  })

  it("names the version", () => {
    expect(renderBriefing()).toContain(GTD_VERSION)
  })

  it("instructs the agent to investigate the repo and ask before driving", () => {
    expect(renderBriefing()).toMatch(/investigate the repository and ask/i)
  })

  it("instructs `gtd init`, treating an existing-config refusal as success", () => {
    const briefing = renderBriefing()
    expect(briefing).toContain("gtd init")
    expect(briefing).toMatch(/already exists.{0,40}success/is)
    expect(briefing).toMatch(/do not hand-roll/i)
  })

  it("instructs committing the config before the first drive", () => {
    expect(renderBriefing()).toMatch(/commit (it|the config).{0,40}before.{0,20}drive/is)
  })

  it("names the edit command's default path", () => {
    expect(renderBriefing()).toContain("~/.local/bin/gtd-edit")
  })

  it("names the `file` field the edit command reads", () => {
    expect(renderBriefing()).toMatch(/`?file`?/)
    expect(renderBriefing()).toContain("gtd next --json=file")
  })

  it("documents that an absent field prints nothing, not the string null a jq recipe would print", () => {
    expect(renderBriefing()).toMatch(/absent field (is silence|prints nothing)/i)
    expect(renderBriefing()).toMatch(/`?null`?/)
  })

  it("names the .gtd/TODO.md fallback", () => {
    expect(renderBriefing()).toContain(".gtd/TODO.md")
  })

  it("names the initial-instruction use of the edit command", () => {
    expect(renderBriefing()).toMatch(/initial state/i)
    expect(renderBriefing()).toMatch(/sketch/i)
  })

  it("EDIT_COMMAND contains no jq", () => {
    expect(EDIT_COMMAND).not.toMatch(/jq/)
  })

  it("names all four default command paths", () => {
    const briefing = renderBriefing()
    expect(briefing).toContain("~/.local/bin/gtd-build")
    expect(briefing).toContain("~/.local/bin/gtd-edit")
    expect(briefing).toContain("~/.local/bin/gtd-review")
    expect(briefing).toContain("~/.local/bin/gtd-fix")
  })

  it("contains the review-gate and fix-precheck entry invocations, exec'ing the loop", () => {
    const briefing = renderBriefing()
    expect(briefing).toContain("--entry review-gate.check --var reviewBase=")
    expect(briefing).toContain("--entry fix-precheck")
    expect(briefing).toMatch(/exec.{0,20}GTD_BUILD/s)
  })

  it("states gtd-fix on a green suite is a no-op straight back to idle", () => {
    expect(renderBriefing()).toMatch(/gtd-fix.{0,80}green.{0,80}no-op.{0,40}idle/is)
  })

  it("states gtd-review on a red baseline hands off to the loop, halting at the blocked gate", () => {
    expect(renderBriefing()).toMatch(/gtd-review.{0,120}red.{0,120}blocked gate/is)
  })

  it("states both new commands exec the RESOLVED loop path, not the literal string gtd-build", () => {
    expect(renderBriefing()).toMatch(/RESOLVED.{0,60}gtd-build.{0,80}never the literal string/is)
  })

  it("names plannerModel/coderModel, their defaults, and states they are opaque hints", () => {
    const briefing = renderBriefing()
    expect(briefing).toContain("plannerModel")
    expect(briefing).toContain("coderModel")
    expect(briefing).toContain("smart")
    expect(briefing).toContain("base")
    expect(briefing).toMatch(/opaque hints, not model names/i)
    expect(briefing).toMatch(/--model smart.{0,20}fails/is)
  })

  it("names GTD_PLANNERMODEL/GTD_CODERMODEL exports, wrapped in gtd-install markers, not written to .gtdrc", () => {
    const briefing = renderBriefing()
    expect(briefing).toContain("GTD_PLANNERMODEL")
    expect(briefing).toContain("GTD_CODERMODEL")
    expect(briefing).toContain("# gtd-install: model exports")
    expect(briefing).toContain("# gtd-install: end")
    expect(briefing).toMatch(/NOT into.{0,20}\.gtdrc/is)
  })

  it("states gtd-review/gtd-fix inherit exports only via exec, and GTD_* is highest precedence", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/inherit.{0,60}exports only because they.{0,10}exec/is)
    expect(briefing).toMatch(/GTD_\*.{0,40}highest-precedence/is)
  })

  it("states the consequence of not honoring model hints", () => {
    expect(renderBriefing()).toMatch(
      /drop.{0,20}--model.{0,80}no.{0,20}exports.{0,60}default tier/is,
    )
  })

  it("probes for at least two known coding-agent CLIs on PATH", () => {
    const briefing = renderBriefing()
    const probed = ["claude", "codex", "gemini", "cursor-agent", "aider", "opencode", "amp"]
    const found = probed.filter((name) => briefing.includes(name))
    expect(found.length).toBeGreaterThanOrEqual(2)
  })

  it("contains no hardcoded table of concrete model identifiers", () => {
    const briefing = renderBriefing()
    expect(briefing).not.toMatch(/opus|sonnet|haiku|gpt-\d|gemini-\d|o1-|o3-/i)
  })
})

describe("REVIEW_COMMAND", () => {
  it("is POSIX sh with no jq or bashisms", () => {
    expect(REVIEW_COMMAND).toMatch(/^#!\/usr\/bin\/env sh\n/)
    expect(REVIEW_COMMAND).toContain("set -eu")
    expect(REVIEW_COMMAND).not.toMatch(/jq/)
  })

  it("carries GTD_BUILD at top and execs it as the last line", () => {
    expect(REVIEW_COMMAND).toMatch(
      /^#!\/usr\/bin\/env sh\nset -eu\nGTD_BUILD=~\/\.local\/bin\/gtd-build\n/,
    )
    expect(REVIEW_COMMAND.trimEnd().endsWith('exec "$GTD_BUILD"')).toBe(true)
  })

  it("cds to the repository root before any gtd call", () => {
    const cdIndex = REVIEW_COMMAND.indexOf('cd "$(git rev-parse --show-toplevel)"')
    const gtdIndex = REVIEW_COMMAND.indexOf("gtd --entry")
    expect(cdIndex).toBeGreaterThan(-1)
    expect(gtdIndex).toBeGreaterThan(cdIndex)
  })

  it("runs gtd --entry review-gate.check with reviewBase from $1", () => {
    expect(REVIEW_COMMAND).toContain("gtd --entry review-gate.check --var reviewBase=")
    expect(REVIEW_COMMAND).toContain('"$1"')
  })

  it("captures the emitted script via command substitution, never a pipe into sh", () => {
    expect(REVIEW_COMMAND).toMatch(/script="\$\(gtd --entry review-gate\.check[\s\S]*?\)"/)
    expect(REVIEW_COMMAND).toContain('sh -c "$script"')
    expect(REVIEW_COMMAND).not.toMatch(/gtd --entry[^\n]*\|\s*sh/)
  })

  it("prints usage to stderr and exits 2 when $1 is missing", () => {
    expect(REVIEW_COMMAND).toContain("usage: gtd-review <commitish>")
    expect(REVIEW_COMMAND).toMatch(/usage: gtd-review <commitish>" >&2\n\s*exit 2/)
  })
})

describe("FIX_COMMAND", () => {
  it("is POSIX sh with no jq or bashisms", () => {
    expect(FIX_COMMAND).toMatch(/^#!\/usr\/bin\/env sh\n/)
    expect(FIX_COMMAND).toContain("set -eu")
    expect(FIX_COMMAND).not.toMatch(/jq/)
  })

  it("carries GTD_BUILD at top and execs it as the last line", () => {
    expect(FIX_COMMAND).toMatch(
      /^#!\/usr\/bin\/env sh\nset -eu\nGTD_BUILD=~\/\.local\/bin\/gtd-build\n/,
    )
    expect(FIX_COMMAND.trimEnd().endsWith('exec "$GTD_BUILD"')).toBe(true)
  })

  it("cds to the repository root before any gtd call", () => {
    const cdIndex = FIX_COMMAND.indexOf('cd "$(git rev-parse --show-toplevel)"')
    const gtdIndex = FIX_COMMAND.indexOf("gtd --entry")
    expect(cdIndex).toBeGreaterThan(-1)
    expect(gtdIndex).toBeGreaterThan(cdIndex)
  })

  it("runs gtd --entry fix-precheck with no argument", () => {
    expect(FIX_COMMAND).toContain("gtd --entry fix-precheck")
  })

  it("captures the emitted script via command substitution, never a pipe into sh", () => {
    expect(FIX_COMMAND).toContain('script="$(gtd --entry fix-precheck)"')
    expect(FIX_COMMAND).toContain('sh -c "$script"')
    expect(FIX_COMMAND).not.toMatch(/gtd --entry[^\n]*\|\s*sh/)
  })
})
