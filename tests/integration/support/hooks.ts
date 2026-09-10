import { Before, After } from "quickpickle"
import { rmSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GTD_BIN, type GtdWorld } from "./world.js"
import { InMemRepo } from "../../../src/testing/InMemRepo.js"

// Scrub every inherited GIT_* and GTD_LOOP_* var from the test process's
// environment, once, at support-load time — so the suite runs identically
// whether launched from a plain shell or AS A gtd LOOP'S OWN CHECK (a driver
// running `npm test` as a child, inheriting its runtime env).
//
// - GIT_*: @live scenarios spawn git and the gtd bundle against a fresh tmp
//   repo, relying on cwd-based discovery; an ambient GIT_DIR/GIT_WORK_TREE
//   would override that discovery and point `git init` and every subsequent op
//   at the OUTER worktree's git dir instead of the tmp repo's own .git — the
//   same cross-worktree leak per-worktree git-dir resolution guards against.
// - GTD_LOOP_*: a driver may export `$GTD_LOOP_LOG`, the absolute path of the
//   CURRENT worktree's loop log (`src/WorktreeState.ts`'s `loopLogPath` reads
//   it verbatim when set) — so a spawned gtd inheriting it would report the
//   driver's log path instead of resolving the tmp repo's own, breaking every
//   log-path assertion. Scrubbing the whole GTD_LOOP_ prefix also drops any
//   other leaked driver runtime state; scenarios that WANT one set it
//   explicitly via world overrides in driver-doc.steps.ts.
//
// Mutating process.env here keeps every child spawn and `{ ...process.env }`
// spread (world.ts, driver-doc.steps.ts, project-setup.ts) hermetic from
// one place. The vitest runner itself needs none of these vars. This runs once
// per WORKER (module load, not per-test), so it stays safe under `e2e-inmem`'s
// parallel file execution (vitest's default; the project sets no
// `fileParallelism` override) — but it IS a mutation of global process state,
// so any future step definition adding its own `process.env` write here
// would break that parallelism silently. Don't.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_") || key.startsWith("GTD_LOOP_")) delete process.env[key]
}

// A seeded steering-mode validate: command (`SteeringFormats.ts`'s
// `seededValidateCommand`) is the literal template `gtd check <mode> <file>`
// — readable at the cost of resolving `gtd` by NAME off `$PATH`, rather than
// by an absolute path. Nothing guarantees a `gtd` on the host's PATH at all
// (a dev machine may have none), and even if one exists it may be a stale
// global install — either way, running the seeded command for real against
// whatever `gtd.bundle.mjs` happens to be on PATH would silently test the
// wrong binary. This shim makes `gtd` resolve to THIS build's own bundle for
// the whole live-tier subprocess tree (the spawned gtd process itself, and
// anything IT shells out to, e.g. CommandRunner.Live's `bash -c` running a
// mode's validate: command).
function createPathShim(): string {
  const dir = mkdtempSync(join(tmpdir(), "gtd-path-shim-"))
  const shim = join(dir, "gtd")
  writeFileSync(shim, `#!/usr/bin/env bash\nexec node "${GTD_BIN}" "$@"\n`)
  chmodSync(shim, 0o755)
  writeFileSync(join(dir, "tailscale"), FAKE_TAILSCALE_SCRIPT)
  chmodSync(join(dir, "tailscale"), 0o755)
  return dir
}

/**
 * A stateful fake `tailscale` CLI, package 01's own `ui-lifecycle.feature`
 * serve scenarios' only way to exercise `src/ui/Serve.ts`'s real command shapes
 * (`serve --bg`/`serve status --json`/`serve ... off`) deterministically —
 * neither a real tailnet nor even the `tailscale` binary itself is
 * guaranteed present on a CI runner (`ubuntu-latest` carries neither), the
 * same reason `spawnBoundGtdUi` uses `--host 127.0.0.1 --self-signed` for
 * every OTHER `@live` `gtd ui` scenario rather than a real bind. State is one
 * file per serve port, `$GTD_TEST_TAILSCALE_DIR/<port>.mapping` holding the
 * published target URL — `GTD_TEST_TAILSCALE_DIR/fail-publish`, when
 * present, makes the next `serve --bg` fail, for the "publishServe itself
 * fails" fallback scenario.
 */
const FAKE_TAILSCALE_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${GTD_TEST_TAILSCALE_DIR:?GTD_TEST_TAILSCALE_DIR not set}"
mkdir -p "$STATE_DIR"
HOSTNAME="test-node.tailnet.ts.net"
FAIL_MARKER="$STATE_DIR/fail-publish"

if [ "\${1:-}" = "status" ] && [ "\${2:-}" = "--json" ]; then
  printf '{"BackendState":"Running","CertDomains":["%s"],"Self":{"DNSName":"%s."}}\\n' "$HOSTNAME" "$HOSTNAME"
  exit 0
fi

if [ "\${1:-}" = "serve" ] && [ "\${2:-}" = "status" ]; then
  entries=""
  for f in "$STATE_DIR"/*.mapping; do
    [ -e "$f" ] || continue
    port="$(basename "$f" .mapping)"
    target="$(cat "$f")"
    entry="\\"$HOSTNAME:$port\\":{\\"Handlers\\":{\\"/\\":{\\"Proxy\\":\\"$target\\"}}}"
    if [ -z "$entries" ]; then entries="$entry"; else entries="$entries,$entry"; fi
  done
  printf '{"Web":{%s}}\\n' "$entries"
  exit 0
fi

if [ "\${1:-}" = "serve" ] && [ "\${2:-}" = "--bg" ]; then
  port=""
  target=""
  for arg in "$@"; do
    case "$arg" in
      --https=*) port="\${arg#--https=}" ;;
      http://*) target="$arg" ;;
    esac
  done
  if [ -e "$FAIL_MARKER" ]; then
    echo "tailscale: simulated publish failure" >&2
    exit 1
  fi
  echo "$target" > "$STATE_DIR/$port.mapping"
  exit 0
fi

if [ "\${1:-}" = "serve" ]; then
  port=""
  for arg in "$@"; do
    case "$arg" in
      --https=*) port="\${arg#--https=}" ;;
    esac
  done
  for arg in "$@"; do
    if [ "$arg" = "off" ]; then
      rm -f "$STATE_DIR/$port.mapping"
      exit 0
    fi
  done
fi

echo "fake tailscale: unsupported invocation: $*" >&2
exit 1
`

/**
 * Detect tier from scenario tags. Exactly one of `@live`/`@inmem` is required
 * on every scenario (directly or inherited from its feature) — the tier tag
 * is a required, single-valued property, not a default, since the `e2e-inmem`
 * / `e2e-live` vitest projects (`vitest.config.ts`) route scenarios by tag via
 * `skipTags`; an untagged or double-tagged scenario would silently stop
 * running in EITHER project instead of failing loudly here.
 */
Before(async (world: GtdWorld) => {
  const tags = world.info.tags
  const live = tags.includes("@live")
  const inmem = tags.includes("@inmem")
  if (live === inmem) {
    throw new Error(
      `scenario "${world.info.scenario}" must carry exactly one of @live/@inmem (found: ${
        live ? "both" : "neither"
      })`,
    )
  }
  if (live) {
    world.tier = "live"
    world.repo = undefined
    world.pathShimDir = createPathShim()
    world.tailscaleStateDir = mkdtempSync(join(tmpdir(), "gtd-fake-tailscale-"))
  } else {
    world.tier = "inmem"
    world.repo = new InMemRepo()
  }
})

/** Unconditionally removed regardless of `KEEP_TEST_REPO` — harness scaffolding, never part of the test repo that flag preserves. */
function removeScaffolding(...dirs: ReadonlyArray<string | undefined>): void {
  for (const dir of dirs) {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
}

function cleanupLiveTier(world: GtdWorld): void {
  const keep = process.env["KEEP_TEST_REPO"] === "1"
  const dirs = [world.repoDir, world.extraCleanupDir, world.driverDocDir].filter(
    Boolean,
  ) as string[]
  for (const dir of dirs) {
    if (keep) process.stderr.write(`Test repo preserved at: ${dir}\n`)
    else rmSync(dir, { recursive: true, force: true })
  }
  removeScaffolding(world.pathShimDir, world.tailscaleStateDir)
  world.pathShimDir = undefined
  world.tailscaleStateDir = undefined
}

After(async (world: GtdWorld) => {
  if (world.tier === "inmem") {
    world.repo = undefined
    return
  }
  cleanupLiveTier(world)
})
