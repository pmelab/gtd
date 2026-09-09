import tailwindcss from "@tailwindcss/vite"
import type { StorybookConfig } from "@storybook/react-vite"

const config: StorybookConfig = {
  stories: ["../src/web/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  addons: ["@storybook/addon-vitest"],
  // Same `src/web/styles.css` the packaged build compiles via the Tailwind
  // CLI (package.json's `build` script) — this is the OTHER of the two
  // consumers the CLI-vs-plugin split names, so Storybook/`test:web` see the
  // identical palette/utilities without a second copy of either.
  viteFinal: async (viteConfig) => {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()]
    return viteConfig
  },
}

export default config
