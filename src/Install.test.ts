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

const FOUR_SUITE_PATHS = ["gtd-build", "gtd-edit", "gtd-review", "gtd-fix"]

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

describe("REINSTALL", () => {
  it("comes after all four command subsections, and before PREREQUISITES", () => {
    const briefing = renderBriefing()
    const fixIndex = briefing.lastIndexOf("### `gtd-fix`")
    const reinstallIndex = briefing.indexOf("read each of the four suite paths")
    const prereqIndex = briefing.indexOf("## Prerequisites and portability")
    expect(fixIndex).toBeGreaterThan(-1)
    expect(reinstallIndex).toBeGreaterThan(fixIndex)
    expect(prereqIndex).toBeGreaterThan(reinstallIndex)
  })

  it("instructs reading each of the four suite paths before writing anything", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/read each of the four suite paths.{0,40}before writing/is)
    for (const name of FOUR_SUITE_PATHS) expect(briefing).toContain(name)
  })

  it("states the three-way branch: absent, content-equal, and different", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/absent.{0,60}install it/is)
    expect(briefing).toMatch(/content-equal.{0,80}(change nothing|skip)/is)
    expect(briefing).toMatch(/skip.{0,40}interview questions/is)
    expect(briefing).toMatch(/different.{0,120}(show the difference|diff)/is)
    expect(briefing).toMatch(/ask before overwriting/i)
  })

  it("states drift is detected by comparing content, never by parsing a version", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/comparing content/i)
    expect(briefing).toMatch(/never by parsing a version/i)
    expect(briefing).toMatch(/carries no version marker/i)
  })

  it("states an unreadable path or a directory is reported and asked about, never overwritten", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/unreadable.{0,80}directory.{0,120}never overwritten/is)
  })

  it("names the model-export markers as the region to strip before comparing gtd-build", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(
      /# gtd-install: model exports[\s\S]{0,120}# gtd-install: end.{0,120}strip/i,
    )
  })

  it("states a gtd-build differing only inside the markers is unchanged, and re-asks nothing", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/differing only.{0,60}(inside|within).{0,60}(markers|exports)/is)
    expect(briefing).toMatch(/unchanged.{0,40}re-asks? nothing/is)
  })

  it("states why: resolved model names are per machine, so every re-install would report drift otherwise", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/per machine/i)
    expect(briefing).toMatch(/every.{0,20}re-install.{0,40}report(s|ing)? drift/is)
  })

  it("scopes the check to exactly the four suite paths", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/exactly the four suite paths/i)
  })

  it("never names gtd-loop as something to read, diff, delete, or remove", () => {
    // Scoped to the sentences that actually mention "gtd-loop", found in the
    // whitespace-collapsed briefing (not per wrapped line — the briefing is
    // hard-wrapped prose, so a line-by-line filter can land "gtd-loop" and a
    // removal verb on different lines and miss the very sentence it exists
    // to check). Scoping to those sentences (rather than the whole document)
    // avoids false positives from unrelated uses of "diff" elsewhere, e.g.
    // the driver protocol's own "a full diff" language.
    const collapsed = renderBriefing().replace(/\s+/g, " ")
    const loopSentences = collapsed
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => sentence.includes("gtd-loop"))
    expect(loopSentences.length).toBeGreaterThan(0)
    for (const sentence of loopSentences) {
      expect(sentence).not.toMatch(/\b(remove|delete|diff)\b/i)
    }
  })

  it("states an existing gtd-loop survives untouched, and cleanup is the human's own call", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/gtd-loop.{0,60}survives untouched/is)
    expect(briefing).toMatch(/human's own call/i)
  })
})

describe("EDITOR_INTEGRATION", () => {
  it("comes after the command suite and before PREREQUISITES", () => {
    const briefing = renderBriefing()
    const fixIndex = briefing.lastIndexOf("### `gtd-fix`")
    const editorIndex = briefing.indexOf("## Editor integration")
    const prereqIndex = briefing.indexOf("## Prerequisites and portability")
    expect(fixIndex).toBeGreaterThan(-1)
    expect(editorIndex).toBeGreaterThan(fixIndex)
    expect(prereqIndex).toBeGreaterThan(editorIndex)
  })

  it("names gtd lsp and stdio as the integration contract", () => {
    const briefing = renderBriefing()
    expect(briefing).toContain("gtd lsp")
    expect(briefing).toMatch(/\bstdio\b/i)
  })

  it("names no specific editor and carries no per-editor recipe", () => {
    const briefing = renderBriefing()
    for (const editor of ["VS Code", "Neovim", "Helix", "Zed", "Emacs"]) {
      expect(briefing).not.toContain(editor)
    }
  })

  it("instructs reading $EDITOR/$VISUAL first, then shell rc files, for the user's editor", () => {
    const briefing = renderBriefing()
    expect(briefing).toContain("$EDITOR")
    expect(briefing).toContain("$VISUAL")
    for (const rc of [".zshrc", ".bashrc", ".config/fish/config.fish"]) {
      expect(briefing).toContain(rc)
    }
  })

  it("instructs asking the user when detection finds nothing or more than one", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/ask\s+the\s+user\s+outright.{0,60}(nothing|more than one)/is)
  })

  it("instructs saying nothing and moving on when no editor is found at all", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/say\s+nothing\s+and\s+move\s+on/i)
  })

  it("instructs looking the chosen editor's own LSP configuration format up", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/look.{0,20}(its|their) own LSP configuration format up/is)
  })

  it("names gtd.openSteeringFile and both fresh-repo facts", () => {
    const briefing = renderBriefing()
    expect(briefing).toContain("gtd.openSteeringFile")
    expect(briefing).toMatch(/gtd lsp.{0,40}never creates.{0,20}\.gtd\//is)
    expect(briefing).toMatch(/gtd lsp.{0,40}needs no repository root/is)
  })

  it("instructs editing the editor's own config file, not printing a snippet and walking away", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/edit the editor's own config file/i)
    expect(briefing).toMatch(/never\s+print\s+a\s+snippet\s+and\s+walk\s+away/i)
  })

  it("instructs asking first, per editor, naming the exact file about to change", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/ask first, per editor.{0,60}naming the exact file/is)
  })

  it("instructs merging rather than overwriting the editor config", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/merge, never overwrite/i)
  })

  it("instructs skipping and reporting when the entry is already present", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/skip and report when the entry is already present/i)
  })

  it("treats a malformed existing config as stop-and-report, not a rewrite", () => {
    const briefing = renderBriefing()
    expect(briefing).toMatch(/malformed existing.{0,40}config.{0,120}stop-and-report/is)
    expect(briefing).toMatch(/leave it untouched/i)
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
