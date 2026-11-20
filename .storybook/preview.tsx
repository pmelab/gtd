import type { Preview } from "@storybook/react-vite"
import { WriteStoreProvider } from "../src/web/writeStore.js"
import css from "../src/web/styles.css?raw"
import "../src/web/styles.css"

const tokens = (block: string | undefined): [string, string][] =>
  [...(block ?? "").matchAll(/(--color-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()])

// The app's own token sets, read from styles.css so no second copy exists.
const LIGHT = tokens(css.match(/@theme\s*{([^}]*)}/)?.[1])
const DARK = tokens(css.match(/prefers-color-scheme: dark\)\s*{\s*:root\s*{([^}]*)}/)?.[1])

/** Pins the page to a theme's tokens; no choice leaves the system setting in charge. */
const applyTheme = (theme: string | undefined): void => {
  const style = document.documentElement.style
  for (const [name] of [...LIGHT, ...DARK]) style.removeProperty(name)
  style.removeProperty("color-scheme")
  if (theme !== "light" && theme !== "dark") return
  for (const [name, value] of theme === "dark" ? DARK : LIGHT) style.setProperty(name, value)
  style.setProperty("color-scheme", theme)
}

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    viewport: {
      options: {
        phone: { name: "Phone", styles: { width: "360px", height: "800px" } },
        desktop: { name: "Desktop", styles: { width: "1440px", height: "900px" } },
      },
    },
  },
  globalTypes: {
    theme: {
      description: "Colour theme",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  // A fresh `WriteStoreProvider` per story — isolation comes free with no
  // per-story edit, matching the real app's own one-provider-per-screen rule.
  decorators: [
    (Story, context) => {
      applyTheme(context.globals["theme"] as string | undefined)
      return (
        <WriteStoreProvider>
          <Story />
        </WriteStoreProvider>
      )
    },
  ],
}

export default preview
