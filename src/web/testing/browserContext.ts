/**
 * Stories have TWO hosts: the vitest browser runner (`test:web`), where
 * `@vitest/browser/context` resolves to a virtual module, and the Storybook
 * dev UI, where that specifier resolves to a stub whose module body THROWS
 * ("can be imported only inside the Browser Mode"). A static import of it
 * anywhere in a story's module graph therefore breaks the whole story page in
 * Storybook — it must stay behind a dynamic import whose rejection is the
 * signal that these runner-only effects have to be skipped.
 */
const browserContext = async (): Promise<typeof import("@vitest/browser/context") | null> => {
  try {
    return await import("@vitest/browser/context")
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
