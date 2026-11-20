/**
 * Stories have TWO hosts: the vitest browser runner (`test:web`), where
 * `vitest/browser` resolves to a virtual module, and the Storybook
 * dev UI, where that specifier resolves to a stub whose module body THROWS
 * ("can be imported only inside the Browser Mode"). A static import of it
 * anywhere in a story's module graph therefore breaks the whole story page in
 * Storybook — it must stay behind a dynamic import whose rejection is the
 * signal that these runner-only effects have to be skipped.
 */
const browserContext = async (): Promise<typeof import("vitest/browser") | null> => {
  try {
    return await import("vitest/browser")
  } catch {
    return null
  }
}

/** Resizes the runner's browser; a no-op in Storybook, which sizes its own preview iframe. */
export const viewport = async (width: number, height: number): Promise<void> => {
  await (await browserContext())?.page.viewport(width, height)
}

/**
 * `context.d.ts`'s own `CDPSession` interface is intentionally empty ("methods
 * are defined by the provider type augmentation") — the playwright provider
 * this project uses supplies `.send()` at runtime, but nothing augments the
 * type in this package, so this is the one narrow cast needed to call it.
 */
interface PlaywrightCdpSession {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
}

/** The runner's raw CDP session, or `null` outside it (Storybook has no CDP). */
export const cdpSession = async (): Promise<PlaywrightCdpSession | null> => {
  const context = await browserContext()
  return context === null ? null : (context.cdp() as unknown as PlaywrightCdpSession)
}

/**
 * Turns CSS transitions off for the page. A transition in a throttled or
 * backgrounded runner tab can sit at its start value past any `waitFor`
 * timeout, so a story asserting a changed colour reads the end state instead.
 */
export const disableTransitions = (): void => {
  const style = document.createElement("style")
  style.textContent = "*, *::before, *::after { transition: none !important }"
  document.head.appendChild(style)
}

const TARGET_SELECTOR = "button, a[href], input, [role=button]"
const MIN_TARGET = 44

const describeElement = (el: Element): string => {
  const label = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? ""
  return `<${el.tagName.toLowerCase()}> "${label}"`
}

/**
 * The layout rules every story must meet: no sideways page scroll, and (on a
 * phone) no visible, enabled target under 44px. Links inside a paragraph,
 * list item or table cell are exempt. Returns one message per violation.
 */
export const auditLayout = (root: ParentNode, options: { readonly targets: boolean }): string[] => {
  const problems: string[] = []
  const page = document.documentElement
  if (page.scrollWidth > page.clientWidth) {
    problems.push(`page scrolls sideways (${page.scrollWidth}px > ${page.clientWidth}px)`)
  }
  if (!options.targets) return problems
  for (const el of root.querySelectorAll(TARGET_SELECTOR)) {
    if (el.matches("a") && el.closest("p, li, td, th") !== null) continue
    if (el.matches(":disabled") || !el.checkVisibility({ visibilityProperty: true })) continue
    const { width, height } = el.getBoundingClientRect()
    if (width < MIN_TARGET || height < MIN_TARGET) {
      problems.push(`${describeElement(el)} is ${Math.round(width)}x${Math.round(height)}px`)
    }
  }
  return problems
}
