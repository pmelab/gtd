import type { Preview } from "@storybook/react-vite"
import { WriteStoreProvider } from "../src/web/writeStore.js"
import "../src/web/styles.css"

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  // A fresh `WriteStoreProvider` per story — isolation comes free with no
  // per-story edit, matching the real app's own one-provider-per-screen rule.
  decorators: [
    (Story) => (
      <WriteStoreProvider>
        <Story />
      </WriteStoreProvider>
    ),
  ],
}

export default preview
