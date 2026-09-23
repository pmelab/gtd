import { Given, Then, When } from "quickpickle"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import assert from "node:assert"
import type { GtdWorld } from "../world.js"

// ── gtd ui's tailscale-serve front door (package 01, `@live` only — see world.ts#spawnGtdUiServeAndHandOff and hooks.ts's fake `tailscale` CLI) ──

When(
  "I hand off {string} in mode {string} with the text {string} to a spawned gtd ui using tailscale serve on port {int}",
  async (world: GtdWorld, filePath: string, mode: string, text: string, servePort: number) => {
    await world.spawnGtdUiServeAndHandOff(servePort, filePath, mode, text)
  },
)

// ── Task 3's publish-failure fallback (package 01, `@live` only — see world.ts#armFailPublish/#spawnGtdUiServePublishFailAndHandOff) ──

Given("the fake tailscale CLI's next serve publish fails", (world: GtdWorld) => {
  world.armFailPublish()
})

// A composable, generic Given — any scenario needing a real cert/key pair on
// disk can reach for this, not just the publish-failure fallback: a real
// `openssl` invocation (mirroring `src/ui/Tls.ts#generateSelfSignedCert`'s own
// shape), never a static "-----BEGIN CERTIFICATE-----\nfake\n..." placeholder
// — `UiListener.Live`'s real `https.createServer` would reject that outright.
Given(
  "a self-signed TLS cert and key at {string} and {string}",
  (world: GtdWorld, certPath: string, keyPath: string) => {
    execFileSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "825",
      "-keyout",
      join(world.repoDir, keyPath),
      "-out",
      join(world.repoDir, certPath),
      "-subj",
      "/CN=localhost",
    ])
  },
)

When(
  "I hand off {string} in mode {string} with the text {string} to a spawned gtd ui using tailscale serve on port {int}, falling back after the failed publish",
  async (world: GtdWorld, filePath: string, mode: string, text: string, servePort: number) => {
    await world.spawnGtdUiServePublishFailAndHandOff(servePort, filePath, mode, text)
  },
)

// ── Task 6's default-port candidate walk (package 01, `@live` only — see world.ts#seedForeignServeMapping/#spawnGtdUiServeAndHandOffDefaultPort) ──

Given(
  "a foreign tailscale serve mapping already published on port {int}",
  (world: GtdWorld, port: number) => {
    world.seedForeignServeMapping(port)
  },
)

When(
  "I hand off {string} in mode {string} with the text {string} to a spawned gtd ui using tailscale serve on the default port",
  async (world: GtdWorld, filePath: string, mode: string, text: string) => {
    await world.spawnGtdUiServeAndHandOffDefaultPort(filePath, mode, text)
  },
)

Then("the taken serve port is {int}", (world: GtdWorld, port: number) => {
  assert.strictEqual(world.lastServePort, port)
})

Then(
  "the foreign tailscale serve mapping on port {int} is untouched",
  (world: GtdWorld, port: number) => {
    assert.ok(world.tailscaleStateDir !== undefined, "no fake tailscale state dir on this world")
    const mappingPath = join(world.tailscaleStateDir!, `${port}.mapping`)
    assert.ok(
      existsSync(mappingPath),
      `expected the foreign mapping at ${mappingPath} to still exist`,
    )
  },
)

Then(
  "no tailscale serve mapping or ownership record survives on port {int}",
  async (world: GtdWorld, servePort: number) => {
    const { readServeRecord } = await import("../../../../src/ui/index.js")
    // Read through the same sandboxed `$HOME` the spawned child's own
    // teardown wrote/deleted against — `readServeRecord` resolves
    // `~/.gtd/serve/` via node:os `homedir()`, which reads this process's
    // own `$HOME`, not the child's.
    const record = await world.withServeHome(() => readServeRecord(servePort))
    assert.strictEqual(
      record,
      undefined,
      `expected no ownership record left at $HOME/.gtd/serve/${servePort}.json`,
    )
    assert.ok(world.tailscaleStateDir !== undefined, "no fake tailscale state dir on this world")
    const mappingPath = join(world.tailscaleStateDir!, `${servePort}.mapping`)
    assert.ok(
      !existsSync(mappingPath),
      `expected the fake tailscale mapping at ${mappingPath} to be gone`,
    )
  },
)

// ── gtd ui's handoff — a real done mutation against a real spawned process (`@live` only, see world.ts#spawnGtdUiAndHandOff) ──

When(
  "I hand off {string} in mode {string} with the text {string} to a spawned gtd ui",
  async (world: GtdWorld, filePath: string, mode: string, text: string) => {
    await world.spawnGtdUiAndHandOff(filePath, mode, text)
  },
)

// ── package 02's idle round trip — a real setValue write creating the sketch from scratch, then a real done with no note, against a real spawned process (`@live` only, see world.ts#spawnGtdUiAndSketchThenHandOff) ──

When(
  "I sketch {string} with the text {string} then hand off via a spawned gtd ui",
  async (world: GtdWorld, filePath: string, text: string) => {
    await world.spawnGtdUiAndSketchThenHandOff(filePath, text)
  },
)

// ── package 04's Done control — a real done mutation with no note, against a real spawned process (`@live` only, see world.ts#spawnGtdUiAndHandOffNoNote) ──

When("I hand off with no note to a spawned gtd ui", async (world: GtdWorld) => {
  await world.spawnGtdUiAndHandOffNoNote()
})

// ── gtd ui's setValue write-through — a real checkbox mutation against a real spawned process (`@live` only, see world.ts#spawnGtdUiAndSetValue) ──

When(
  "I pick option {int} of question {int} in {string} mode {string} via a spawned gtd ui",
  async (
    world: GtdWorld,
    optionIndex: number,
    questionIndex: number,
    filePath: string,
    mode: string,
  ) => {
    await world.spawnGtdUiAndSetValue(
      filePath,
      mode,
      { kind: "option", questionIndex, index: optionIndex },
      { checked: true },
    )
  },
)

// ── package 06's own free-text write-through — a real checkbox+text setValue mutation against a real spawned process (`@live` only, see world.ts#spawnGtdUiAndSetValue) ──

When(
  "I answer option {int} of question {int} in {string} mode {string} with the text {string} via a spawned gtd ui",
  async (
    world: GtdWorld,
    optionIndex: number,
    questionIndex: number,
    filePath: string,
    mode: string,
    text: string,
  ) => {
    await world.spawnGtdUiAndSetValue(
      filePath,
      mode,
      { kind: "option", questionIndex, index: optionIndex },
      { checked: true, text },
    )
  },
)

// ── gtd ui survives a reload then hands off — a real GET reload, then a real done mutation, against a real spawned process (`@live` only, see world.ts#spawnGtdUiReloadThenHandOff) ──

When(
  "I reload the client of a spawned gtd ui, then hand off {string} in mode {string} with the text {string}",
  async (world: GtdWorld, filePath: string, mode: string, text: string) => {
    await world.spawnGtdUiReloadThenHandOff(filePath, mode, text)
  },
)

Then("the file {string} contains {string}", (world: GtdWorld, path: string, text: string) => {
  const content = readFileSync(join(world.repoDir, path), "utf8")
  assert.ok(
    content.includes(text),
    `expected ${path} to contain ${JSON.stringify(text)}, got:\n${content}`,
  )
})

Then(
  "the file {string} does not contain {string}",
  (world: GtdWorld, path: string, text: string) => {
    const content = existsSync(join(world.repoDir, path))
      ? readFileSync(join(world.repoDir, path), "utf8")
      : ""
    assert.ok(!content.includes(text), `expected ${path} not to contain ${JSON.stringify(text)}`)
  },
)

// ── Package 01 Task 10 — the mode-less steering screen's own e2e coverage (`@live` only, see world.ts#spawnGtdUiAndReadView/#spawnGtdUiAndSetValueWithStaleHash/#spawnGtdUiAndWriteTwiceReusingHash) ──

When(
  "I hand off {string} with the text {string} to a spawned gtd ui",
  async (world: GtdWorld, filePath: string, text: string) => {
    await world.spawnGtdUiAndHandOff(filePath, undefined, text)
  },
)

When(
  "I read the view of {string} via a spawned gtd ui",
  async (world: GtdWorld, filePath: string) => {
    await world.spawnGtdUiAndReadView(filePath, undefined)
  },
)

Then(
  "the rendered view has a {string} block at index {int}",
  (world: GtdWorld, kind: string, index: number) => {
    const nodes = world.lastSteeringView?.nodes ?? []
    const node = nodes[index]
    assert.ok(
      node !== undefined,
      `expected a node at index ${index}, got ${nodes.length} node(s): ${JSON.stringify(nodes)}`,
    )
    assert.strictEqual(
      node.block?.kind,
      kind,
      `expected node ${index}'s block.kind to be "${kind}", got: ${JSON.stringify(node.block)}`,
    )
  },
)

When(
  "I edit paragraph {int} of {string} with the text {string} via a spawned gtd ui",
  async (world: GtdWorld, line: number, filePath: string, text: string) => {
    await world.spawnGtdUiAndSetValue(filePath, undefined, { kind: "paragraph", line }, { text })
  },
)

When(
  "I attempt to edit paragraph {int} of {string} with the text {string} using a stale token via a spawned gtd ui",
  async (world: GtdWorld, line: number, filePath: string, text: string) => {
    await world.spawnGtdUiAndSetValueWithStaleHash(
      filePath,
      undefined,
      { kind: "paragraph", line },
      { text },
    )
  },
)

When(
  "I attempt to edit paragraph {int} of {string} with the text {string} against an unreadable file via a spawned gtd ui",
  async (world: GtdWorld, line: number, filePath: string, text: string) => {
    await world.spawnGtdUiAndSetValueAgainstUnreadableFile(
      filePath,
      undefined,
      { kind: "paragraph", line },
      { text },
    )
  },
)

Then("the write is refused with reason {string}", (world: GtdWorld, reason: string) => {
  assert.strictEqual(
    world.lastWriteRefusal?.reason,
    reason,
    `expected a writeRefusal with reason "${reason}", got: ${JSON.stringify(world.lastWriteRefusal)}`,
  )
})

When(
  "I write {string} then {string} to paragraph {int} of {string} via a spawned gtd ui, reusing the first write's returned hash",
  async (
    world: GtdWorld,
    firstText: string,
    secondText: string,
    line: number,
    filePath: string,
  ) => {
    await world.spawnGtdUiAndWriteTwiceReusingHash(
      filePath,
      undefined,
      { kind: "paragraph", line },
      firstText,
      secondText,
    )
  },
)

Then("the second write succeeded", (world: GtdWorld) => {
  assert.ok(
    world.formatWriteResult?.secondOk === true,
    `expected the second write to succeed, got: ${JSON.stringify(world.formatWriteResult)}`,
  )
})
