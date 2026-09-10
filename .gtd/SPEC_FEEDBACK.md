# Spec feedback — 01-tailscale-serve-front-door

Two problems. Task 1, 2, 3 control flow and Task 4 ownership otherwise match the
spec; `npm test` is green and every command shape verifies against the real
`tailscale serve --help` (1.102.3), including `--https=<port> off`.

## 1. The orphan check parses stderr-merged output, so a stderr warning reads as "port is free"

`probeLiveServeMapping` (`src/ui/Server.ts#470`) feeds `outcome.output` to
`parseServeStatus`. `CommandRunner.Live` defines `output` as
`` `${stdout}${stderr}` `` (`src/CommandRunner.ts#68`) — anything `tailscale`
writes to stderr on an exit-0 run is appended to the JSON. The most common one
is real: `tailscale` prints
`Warning: client version ... != tailscaled server version ...` to stderr
whenever the CLI and daemon versions differ.

Consequence, exactly the case the spec calls mandatory: `JSON.parse` throws →
`parseServeStatus` returns `undefined` → `clearOrphanForPublish` reads
`probe.mapping === undefined` as "nothing published here" → `publishServe`
overwrites a foreign mapping (another tool's own port-443 door). The deliberate
`ok: false` vs `mapping: undefined` distinction the doc comment at `#460`–`#469`
builds is bypassed, because the probe DID exit 0 — it just produced unparseable
text.

`CommandOutcome` already carries `stdout` separately. Use
`outcome.stdout ?? outcome.output` in `probeLiveServeMapping`, and script a test
double that returns
`{ status: 0, output: "{...}\nWarning: ...", stdout: "{...}", stderr: "Warning: ..." }`
for a mapping on the port, asserting the foreign mapping IS seen and no
`tailscale serve --bg` runs.

(`probeTailscaleStatus` has the same shape and is pre-existing — out of scope,
do not change it here.)

## 2. Task 1's "parent directory is created when absent" is asserted only as "the path exists"

`src/ui/Serve.test.ts#167` writes a record and asserts
`existsSync(~/.gtd/serve/65535.json)`. It never removes `~/.gtd/serve/`
beforehand, and the round-trip test above it already created it, so the
`mkdirSync(..., { recursive: true })` half of the criterion is never exercised —
deleting that `mkdirSync` line still passes the suite.

The criterion is "its parent directory is created when absent". Make the test
prove it: assert against an absent directory. The record helpers hard-code
`homedir()`, so the test needs the serve dir genuinely gone first (`rmSync` of
`~/.gtd/serve` is destructive to a concurrently-running `gtd ui` and is not
acceptable) — instead give the record helpers a resolvable base (an injected
directory, or reading `homedir()` through a seam the test can point at a
`mkdtemp` path) and assert write-into-a-nonexistent-dir succeeds there.
