// PROTOTYPE — throwaway (pmelab/gtd#593). Three workspace dashboard variants on fake data.
// Storybook's sidebar is the variant switcher; use its viewport toolbar for phone width.
import type { Meta, StoryObj } from "@storybook/react-vite"
import { VariantA } from "./VariantA.js"
import { VariantB } from "./VariantB.js"
import { VariantC } from "./VariantC.js"

const meta: Meta = {
  title: "PROTOTYPE/Workspace dashboard",
  parameters: { layout: "fullscreen" },
}
export default meta

export const A_Sections: StoryObj = { render: () => <VariantA /> }
export const B_NowProjectsInbox: StoryObj = { render: () => <VariantB /> }
export const C_MasterDetail: StoryObj = { render: () => <VariantC /> }
