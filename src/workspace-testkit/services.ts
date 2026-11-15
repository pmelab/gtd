import { isAdapterFailure, type Service, type ServicesAdapter } from "../workspace/index.js"
import type { ContractCase } from "./index.js"

/**
 * A fresh world for one case. `worktree` and `twin` each have two services,
 * both stopped: `web`, which starts and answers at a URL, and `broken`, which
 * fails as it starts. `bare` has no services.
 */
export interface ServicesFixture {
  readonly adapter: ServicesAdapter
  readonly project: string
  readonly worktree: string
  /** Another worktree with the same services as `worktree`. */
  readonly twin: string
  readonly bare: string
  readonly dispose: () => Promise<void>
}

export interface ServicesHarness {
  readonly setup: () => Promise<ServicesFixture>
}

const fail = (message: string): never => {
  throw new Error(message)
}

const withFixture =
  (harness: ServicesHarness, body: (fixture: ServicesFixture) => Promise<void>) =>
  async (): Promise<void> => {
    const fixture = await harness.setup()
    try {
      await body(fixture)
    } finally {
      await fixture.dispose()
    }
  }

const serviceOf = async (
  fixture: ServicesFixture,
  worktree: string,
  name: string,
): Promise<Service> => {
  const services = await fixture.adapter.list(fixture.project, worktree)
  return (
    services.find((s) => s.name === name) ??
    fail(`list() of ${worktree} has no service "${name}": ${JSON.stringify(services)}`)
  )
}

const runningIs = async (
  fixture: ServicesFixture,
  worktree: string,
  name: string,
  expected: boolean,
): Promise<Service> => {
  const service = await serviceOf(fixture, worktree, name)
  if (service.running !== expected) {
    fail(`service "${name}" of ${worktree}: running is ${service.running}, expected ${expected}`)
  }
  return service
}

// `up` fails because `broken` does not start; the cases that need `web`
// running look past that failure.
const upIgnoringBroken = (fixture: ServicesFixture, worktree: string): Promise<unknown> =>
  fixture.adapter.up(fixture.project, worktree).catch((error: unknown) => error)

/** The cases every services adapter passes, bundled or userland. */
export const servicesContract = (harness: ServicesHarness): readonly ContractCase[] => [
  {
    name: "list() reports a worktree's services before they start, none running",
    run: withFixture(harness, async (fixture) => {
      const names = (await fixture.adapter.list(fixture.project, fixture.worktree))
        .map((s) => s.name)
        .sort()
      if (names.join() !== "broken,web") fail(`list() reported ${JSON.stringify(names)}`)
      await runningIs(fixture, fixture.worktree, "web", false)
      await runningIs(fixture, fixture.worktree, "broken", false)
    }),
  },
  {
    name: "up() starts the worktree's services, and a running service has a URL",
    run: withFixture(harness, async (fixture) => {
      await upIgnoringBroken(fixture, fixture.worktree)
      const web = await runningIs(fixture, fixture.worktree, "web", true)
      if (web.error !== undefined) fail(`the running "web" reports the error "${web.error}"`)
      if (web.url === undefined || !/^https?:\/\//.test(web.url)) {
        fail(`the running "web" reports the URL ${JSON.stringify(web.url)}`)
      }
    }),
  },
  {
    name: "up() fails with the adapter error shape, and the service that did not start reports why",
    run: withFixture(harness, async (fixture) => {
      const failure = await upIgnoringBroken(fixture, fixture.worktree)
      if (!isAdapterFailure(failure)) {
        fail(`up() ended with ${String(failure)}, not { adapter, op, message, detail }`)
      }
      const { adapter, op } = failure as { adapter: string; op: string }
      if (adapter !== "services" || op !== "up") {
        fail(`it failed as { adapter: "${adapter}", op: "${op}" }, not services/up`)
      }
      const broken = await runningIs(fixture, fixture.worktree, "broken", false)
      if (broken.error === undefined || broken.error === "") {
        fail(`the "broken" service reports no error`)
      }
    }),
  },
  {
    name: "up() and down() leave another worktree's services alone",
    run: withFixture(harness, async (fixture) => {
      await upIgnoringBroken(fixture, fixture.worktree)
      await runningIs(fixture, fixture.twin, "web", false)
      await upIgnoringBroken(fixture, fixture.twin)
      await fixture.adapter.down(fixture.project, fixture.worktree)
      await runningIs(fixture, fixture.worktree, "web", false)
      await runningIs(fixture, fixture.twin, "web", true)
      await fixture.adapter.down(fixture.project, fixture.twin)
    }),
  },
  {
    name: "down() stops the worktree's services, and a second down() does nothing",
    run: withFixture(harness, async (fixture) => {
      await upIgnoringBroken(fixture, fixture.worktree)
      await fixture.adapter.down(fixture.project, fixture.worktree)
      await runningIs(fixture, fixture.worktree, "web", false)
      await fixture.adapter.down(fixture.project, fixture.worktree)
    }),
  },
  {
    name: "a worktree with no services lists none, and up() and down() do nothing",
    run: withFixture(harness, async (fixture) => {
      await fixture.adapter.up(fixture.project, fixture.bare)
      const listed = await fixture.adapter.list(fixture.project, fixture.bare)
      if (listed.length > 0)
        fail(`list() of a worktree with no services: ${JSON.stringify(listed)}`)
      await fixture.adapter.down(fixture.project, fixture.bare)
    }),
  },
]
