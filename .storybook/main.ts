import type { StorybookConfig } from "@storybook/react-vite"

const config: StorybookConfig = {
  stories: ["../src/web/**/*.stories.tsx"],
  framework: "@storybook/react-vite",
  addons: ["@storybook/addon-vitest"],
}

export default config
