import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { cdpSession, viewport } from "../testing/browserContext.js"
import { WorkspaceTrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { token } from "../testing/palette.js"
import { fullWorkspace, statusWorktrees, workspace } from "./dashboard.fixture.js"
import { Detail } from "./Detail.js"
import { fullRun } from "./retrospective.fixture.js"
import type { Entry } from "./view.js"

const portal = workspace[1]!
const plan = { project: portal, worktree: portal.worktrees[1]! }

const calls: { procedure: string; input: unknown }[] = []
const record =
  (procedure: string, answer: unknown) =>
  (input: unknown): unknown => {
    calls.push({ procedure, input })
    return answer
  }

const actions = () => ({
  status: "needsYou",
  actions: [{ id: "any:shell", label: "Open a shell", status: "any", fields: [] }],
})

const withApi = (resolvers: Record<string, (input: unknown) => unknown>) => [
  (Story: () => React.JSX.Element) => (
    <WorkspaceTrpcTestProvider resolvers={{ projects: () => workspace, actions, ...resolvers }}>
      <Story />
    </WorkspaceTrpcTestProvider>
  ),
]

const meta: Meta<typeof Detail> = {
  component: Detail,
  args: { entry: plan, onClose: fn() },
  decorators: withApi({}),
}

export default meta

type Story = StoryObj<typeof Detail>

/** On a phone the detail covers the screen, the gate page first, its tabs at the top under the header. */
export const GateFirstFullScreenOnAPhone: Story = {
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    const frame = canvas.getByTestId("gate-tab")
    const detail = canvas.getByTestId("detail").getBoundingClientRect()
    await expect(detail.width).toBe(window.innerWidth)
    const tabs = canvas.getByRole("tablist", { name: "Worktree" }).getBoundingClientRect()
    await expect(tabs.top).toBeGreaterThan(
      canvas.getByRole("heading").getBoundingClientRect().bottom,
    )
    await expect(tabs.bottom).toBeLessThanOrEqual(frame.getBoundingClientRect().top)
    await expect(canvas.getByRole("tab", { name: "Gate" }).getAttribute("aria-selected")).toBe(
      "true",
    )
  },
}

/** The header carries the weight: "Portal / plan" larger than body text, a status badge, then why. */
export const HeaderShowsWhereAndWhy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole("heading")
    await expect(title.textContent).toBe("Portal/plan")
    await expect(parseFloat(getComputedStyle(title).fontSize)).toBeGreaterThan(
      parseFloat(getComputedStyle(canvas.getByTestId("detail-reason")).fontSize),
    )
    await expect(canvasElement.querySelector("[data-status]")?.textContent).toBe(
      "needs you (question)",
    )
    await expect(canvas.getByTestId("detail-reason").textContent).toBe("Answer the plan")
  },
}

/** The gate's Proceed is an outline in the warning colour; Run in Actions stays secondary while the gate waits. */
export const ProceedIsAnOutlineAtAGate: Story = {
  decorators: withApi({}),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const proceed = canvas.getByRole("button", { name: "Proceed" })
    const style = getComputedStyle(proceed)
    await expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)")
    await expect(style.color).toBe(token("warning"))
    await expect(style.borderTopColor).toBe(token("warning"))
    await userEvent.click(canvas.getByRole("tab", { name: "Actions" }))
    const run = await canvas.findByRole("button", { name: "Run" })
    await expect(getComputedStyle(run).color).not.toBe(style.color)
    await expect(getComputedStyle(run).borderTopColor).not.toBe(style.borderTopColor)
  },
}

/** Retry stays secondary, so it looks different from Proceed. */
export const RetryStaysSecondary: Story = {
  args: { entry: { project: workspace[0]!, worktree: workspace[0]!.worktrees[1]! } },
  play: async ({ canvasElement }) => {
    const retry = within(canvasElement).getByRole("button", { name: "Retry" })
    await expect(getComputedStyle(retry).backgroundColor).toBe(token("card"))
    await expect(getComputedStyle(retry).color).not.toBe(token("warning"))
  },
}

/** Proceed sends the HEAD commit the page showed, so a moved HEAD is refused. */
export const ProceedSendsTheHeadThePageShowed: Story = {
  decorators: withApi({ proceed: record("proceed", undefined) }),
  play: async ({ canvasElement }) => {
    calls.length = 0
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Proceed" }))
    await waitFor(() =>
      expect(calls).toEqual([
        {
          procedure: "proceed",
          input: { worktree: "/ws/portal-plan", commit: "plan-head" },
        },
      ]),
    )
  },
}

/** A press gtd refuses says why. */
export const ARefusedPressSaysWhy: Story = {
  args: { entry: { project: workspace[0]!, worktree: workspace[0]!.worktrees[1]! } },
  decorators: withApi({
    retry: () => {
      throw new Error("HEAD moved since the page loaded; reload and look again")
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }))
    await waitFor(() =>
      expect(canvas.getByTestId("press-error").textContent).toBe(
        "HEAD moved since the page loaded; reload and look again",
      ),
    )
  },
}

/** Without a gate, Run is the screen's primary action. */
export const RunIsPrimaryWithoutAGate: Story = {
  args: { entry: { project: portal, worktree: portal.worktrees[2]! } },
  decorators: withApi({
    actions: () => ({
      status: "idle",
      actions: [{ id: "any:shell", label: "Open a shell", status: "any", fields: [] }],
    }),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("tab", { name: "Actions" }))
    const run = await canvas.findByRole("button", { name: "Run" })
    await expect(run.className).toContain("bg-primary")
  },
}

/** The embedded gate talks to the worktree's own gate page API. */
export const EmbedsTheWorktreesGate: Story = {
  loaders: [
    () => {
      const urls: string[] = []
      const real = window.fetch
      window.fetch = (input, init) => {
        urls.push(String(input instanceof Request ? input.url : input))
        return real(input, init)
      }
      return { urls, restore: () => (window.fetch = real) }
    },
  ],
  play: async ({ loaded }) => {
    const { urls, restore } = loaded as { urls: string[]; restore: () => void }
    await waitFor(() =>
      expect(urls.some((u) => u.startsWith(`${plan.worktree.gate}/trpc`))).toBe(true),
    )
    restore()
  },
}

/** The embedded gate links to the full gate page in a tab of its own. */
export const OpenInTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = canvas.getByRole("link", { name: "Open in new tab" })
    await expect(link).toBe(canvas.getByTestId("open-gate"))
    await expect(link.getAttribute("href")).toBe(plan.worktree.gate)
    await expect(link.getAttribute("target")).toBe("_blank")
    await viewport(390, 844)
    await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  },
}

/** The detail offers Gate, Actions and Retrospective, in that order, and no Terminal. */
export const OffersGateThenActions: Story = {
  play: async ({ canvasElement }) => {
    const tabs = within(canvasElement).getByRole("tablist", {
      name: "Worktree",
    })
    await expect(
      within(tabs)
        .getAllByRole("tab")
        .map((b) => b.textContent),
    ).toEqual(["Gate", "Actions", "Retrospective"])
  },
}

/** The Actions tab offers the actions for the status, with their fields, and runs the chosen one. */
export const ActionsRunWithTheirFields: Story = {
  decorators: withApi({
    actions: () => ({
      status: "needsYou",
      actions: [
        {
          id: "gate:revise",
          label: "Revise",
          status: "needsYou",
          fields: [
            {
              name: "note",
              type: "text",
              required: true,
              help: "What to change",
            },
            {
              name: "mode",
              type: "select",
              required: false,
              choices: ["fast", "slow"],
            },
            { name: "dry", type: "flag", required: false },
          ],
        },
        { id: "any:shell", label: "Open a shell", status: "any", fields: [] },
      ],
    }),
    runAction: record("runAction", { ok: true }),
  }),
  play: async ({ canvasElement }) => {
    calls.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("tab", { name: "Actions" }))
    await userEvent.type(await canvas.findByRole("textbox", { name: "note" }), "shorter")
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "mode" }), "slow")
    await userEvent.click(canvas.getByRole("checkbox", { name: "dry" }))
    await userEvent.click(canvas.getByRole("button", { name: "Run" }))
    await waitFor(() =>
      expect(calls).toEqual([
        {
          procedure: "runAction",
          input: {
            project: "portal",
            worktree: "/ws/portal-plan",
            action: "gate:revise",
            values: { note: "shorter", mode: "slow", dry: true },
          },
        },
      ]),
    )
  },
}

/** Close returns to the list. */
export const Closes: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Close" }))
    await expect(args.onClose).toHaveBeenCalled()
  },
}

/** Remove first lists what would be lost; a second press confirms, removes and closes the detail. */
export const RemoveAsksToConfirm: Story = {
  decorators: withApi({
    removeWorktree: (input) => {
      calls.push({ procedure: "removeWorktree", input })
      return (input as { confirmed?: boolean }).confirmed === true
        ? { removed: true }
        : {
            confirm: ["the tree has uncommitted changes", "the branch is not integrated"],
          }
    },
  }),
  play: async ({ canvasElement, args }) => {
    calls.length = 0
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("tab", { name: "Actions" }))
    const remove = canvas.getByRole("button", { name: "Remove" })
    const restBackground = getComputedStyle(remove).backgroundColor
    await userEvent.click(remove)
    const losses = within(await canvas.findByTestId("remove-confirm")).getAllByRole("listitem")
    await expect(losses.map((l) => l.textContent)).toEqual([
      "the tree has uncommitted changes",
      "the branch is not integrated",
    ])
    await expect(canvas.getByTestId("danger-zone")).toHaveTextContent("deletes the worktree")
    const anyway = canvas.getByRole("button", { name: "Remove anyway" })
    await expect(getComputedStyle(anyway).backgroundColor).not.toBe(restBackground)
    await userEvent.click(anyway)
    await waitFor(() => expect(args.onClose).toHaveBeenCalled())
    await expect(calls).toEqual([
      {
        procedure: "removeWorktree",
        input: {
          project: "portal",
          worktree: "/ws/portal-plan",
          confirmed: false,
        },
      },
      {
        procedure: "removeWorktree",
        input: {
          project: "portal",
          worktree: "/ws/portal-plan",
          confirmed: true,
        },
      },
    ])
  },
}

/** A worktree that Remove keeps shows gtd's reason. */
export const ShowsWhyRemoveKeepsAWorktree: Story = {
  decorators: withApi({
    removeWorktree: () => {
      throw new Error("its driver runs")
    },
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("tab", { name: "Actions" }))
    await userEvent.click(canvas.getByRole("button", { name: "Remove" }))
    await expect((await canvas.findByTestId("remove-error")).textContent).toBe("its driver runs")
  },
}

const MovingRest = (args: React.ComponentProps<typeof Detail>) => {
  const [worktree, setWorktree] = useState(plan.worktree)
  return (
    <>
      <button
        style={{ minWidth: 44, minHeight: 44 }}
        onClick={() => setWorktree((w) => ({ ...w, label: "Answer the plan again" }))}
      >
        relabel
      </button>
      <button
        style={{ minWidth: 44, minHeight: 44 }}
        onClick={() => setWorktree((w) => ({ ...w, head: "c0ffee" }))}
      >
        commit
      </button>
      <Detail {...args} entry={{ ...plan, worktree }} />
    </>
  )
}

/** The gate page loads again once the worktree's HEAD moves on, and only then. */
export const GateFollowsTheRest: Story = {
  render: (args) => <MovingRest {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const gate = () => canvas.getByTestId("gate-tab").firstElementChild
    const first = gate()
    await userEvent.click(canvas.getByRole("button", { name: "relabel" }))
    await expect(gate()).toBe(first)
    await userEvent.click(canvas.getByRole("button", { name: "commit" }))
    await expect(gate()).not.toBe(first)
  },
}

/** Remove sits in Actions, below Run, never beside the press. */
export const RemoveSitsInActions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("tab", { name: "Actions" }))
    await expect(canvas.getByRole("button", { name: "Remove" })).toBeVisible()
  },
}

/** The main checkout has no Remove. */
export const NoRemoveOnTheMainCheckout: Story = {
  args: { entry: { project: portal, worktree: portal.worktrees[0]! } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("tab", { name: "Actions" }))
    await canvas.findByTestId("actions-tab")
    await expect(canvas.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument()
  },
}

const shop = fullWorkspace[0]!

const detailShows =
  (key: string, status: string, reason: string, message?: string): NonNullable<Story["play"]> =>
  async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const detail = canvas.getByTestId("detail")
    await expect(detail.querySelector("[data-status]")?.textContent).toBe(status)
    if (reason === "") await expect(canvas.queryByTestId("detail-reason")).toBeNull()
    else await expect(canvas.getByTestId("detail-reason")).toHaveTextContent(reason)
    if (message) await expect(detail).toHaveTextContent(message)
    await expect(detail.querySelector("header h2")).toHaveTextContent(statusWorktrees[key]!.branch!)
  }

const detailOf = (key: string, status: string, reason: string, message?: string): Story => {
  const entry: Entry = { project: shop, worktree: statusWorktrees[key]! }
  const shown = detailShows(key, status, reason, message)
  return {
    args: { entry, onClose: fn() },
    play: async (context) => {
      await shown(context)
      const canvas = within(context.canvasElement)
      const gate = canvas.getByRole("tab", { name: "Gate" })
      const atGate = statusWorktrees[key]!.humanRest === true
      await expect(gate.hasAttribute("disabled")).toBe(!atGate)
      await expect(gate.getAttribute("aria-selected")).toBe(String(atGate))
      await expect(canvas.queryByTestId("gate-tab") !== null).toBe(atGate)
      await expect(canvas.queryByText("No human gate right now") !== null).toBe(!atGate)
    },
  }
}

// "Idle" under the "idle" badge would say it twice: no reason line.
export const DetailIdle: Story = detailOf("idle", "idle", "")
export const DetailIdleWithNote: Story = detailOf("idleNote", "idle", "", "merged into main")
export const DetailAtAGateWithNoDriver: Story = detailOf("gate", "needs you", "Answer the plan")
export const DetailNeedsYouPermission: Story = detailOf(
  "permission",
  "needs you (permission)",
  "Allow the edit",
)
export const DetailNeedsYouQuestion: Story = detailOf(
  "question",
  "needs you (question)",
  "Pick a store",
)
export const DetailNeedsYouNoDriverRuns: Story = detailOf(
  "noDriver",
  "needs you",
  "Build the change",
  "no driver runs",
)
export const DetailWorking: Story = detailOf("working", "working", "Building")
export const DetailErrorStalled: Story = detailOf(
  "stalled",
  "error (stalled)",
  "Stalled",
  "the process cannot go on",
)
export const DetailErrorCrashed: Story = detailOf(
  "crashed",
  "error (crashed)",
  "Driver crashed",
  "the driver exited with 1",
)
export const DetailErrorDriver: Story = detailOf(
  "driver",
  "error (driver)",
  "Driver failed",
  "the model refused",
)
export const DetailErrorNote: Story = detailOf(
  "note",
  "error (note)",
  "Note failed",
  "gh: not logged in",
)

/** The detail page keeps every service: name, status, error, state colour and link. */
export const ShowsServiceChips: Story = {
  args: {
    entry: {
      project: portal,
      worktree: {
        ...portal.worktrees[2]!,
        services: [
          ...(portal.worktrees[0]!.services ?? []),
          ...(portal.worktrees[2]!.services ?? []),
        ],
      },
    },
  },
  play: async ({ canvasElement }) => {
    const chips = within(canvasElement).getAllByTestId("service-chip")
    await expect(chips.map((c) => c.textContent)).toEqual([
      "web running",
      "web stopped",
      "jobs error: exit code 3",
    ])
    const dots = chips.map((c) => getComputedStyle(c.firstElementChild!).backgroundColor)
    await expect(dots).toEqual([token("success"), token("muted-foreground"), token("destructive")])
    for (const chip of chips) {
      await expect(chip.getBoundingClientRect().height).toBeGreaterThanOrEqual(24)
    }
    await expect(chips.map((c) => c.getAttribute("href"))).toEqual([
      "https://web.portal.example.ts.net",
      "https://web.login.portal.example.ts.net",
      null,
    ])
  },
}

const GateMoves = (args: React.ComponentProps<typeof Detail>) => {
  const [humanRest, setHumanRest] = useState(false)
  const worktree = { ...statusWorktrees.working!, humanRest }
  return (
    <>
      <button style={{ minWidth: 44, minHeight: 44 }} onClick={() => setHumanRest((h) => !h)}>
        toggle
      </button>
      <Detail {...args} entry={{ project: shop, worktree }} />
    </>
  )
}

/** Reaching a gate enables Gate without selecting it; passing it while selected returns to Actions, and the next gate keeps Actions. */
export const GateFollowsTheStatus: Story = {
  render: (args) => <GateMoves {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const gate = canvas.getByRole("tab", { name: "Gate" })
    await expect(gate).toBeDisabled()
    await userEvent.click(gate)
    await expect(canvas.getByRole("tab", { name: "Actions" }).getAttribute("aria-selected")).toBe(
      "true",
    )
    await userEvent.click(canvas.getByRole("button", { name: "toggle" }))
    await expect(gate).toBeEnabled()
    await expect(gate.getAttribute("aria-selected")).toBe("false")
    await userEvent.click(gate)
    await expect(canvas.getByTestId("gate-tab")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "toggle" }))
    await expect(canvas.getByRole("tab", { name: "Actions" }).getAttribute("aria-selected")).toBe(
      "true",
    )
    await userEvent.click(canvas.getByRole("button", { name: "toggle" }))
    await expect(gate).toBeEnabled()
    await expect(gate.getAttribute("aria-selected")).toBe("false")
  },
}

const retro = { retrospective: () => fullRun }

const openRetrospective = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole("tab", { name: "Retrospective" }))
  return canvas
}

const showsAllActors = async (canvas: ReturnType<typeof within>) => {
  const tab = await canvas.findByTestId("retrospective-tab")
  for (const label of ["Human", "Agent", "Judge", "Script"])
    await expect(within(tab).getAllByText(label).length).toBeGreaterThan(0)
  await expect(tab).toHaveTextContent("sent back")
  await expect(tab).toHaveTextContent("Failed · exit 1")
  await expect(tab).toHaveTextContent("Exit unknown")
  await expect(tab).toHaveTextContent("Approved by Ada")
  await expect(tab).toHaveTextContent("Worktree total $1.25")
  await expect(canvas.getAllByTestId("retro-process")[1]!.hasAttribute("open")).toBe(false)
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
}

const scheme = async (value: "light" | "dark") => {
  await (
    await cdpSession()
  )?.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value }],
  })
}

/** A full run on a phone, in light and dark: every actor, no horizontal page scroll at 360 px. */
export const RetrospectivePhoneLight: Story = {
  decorators: withApi(retro),
  play: async ({ canvasElement }) => {
    await viewport(360, 800)
    await scheme("light")
    await showsAllActors(await openRetrospective(canvasElement))
  },
}

export const RetrospectivePhoneDark: Story = {
  decorators: withApi(retro),
  play: async ({ canvasElement }) => {
    await viewport(360, 800)
    await scheme("dark")
    await showsAllActors(await openRetrospective(canvasElement))
    await scheme("light")
  },
}

export const RetrospectiveDesktopLight: Story = {
  decorators: withApi(retro),
  play: async ({ canvasElement }) => {
    await viewport(1280, 800)
    await scheme("light")
    await showsAllActors(await openRetrospective(canvasElement))
  },
}

export const RetrospectiveDesktopDark: Story = {
  decorators: withApi(retro),
  play: async ({ canvasElement }) => {
    await viewport(1280, 800)
    await scheme("dark")
    await showsAllActors(await openRetrospective(canvasElement))
    await scheme("light")
  },
}
