import { extendTailwindMerge } from "tailwind-merge"

/**
 * Class merge for every component that takes a `className` override.
 * Without it a call site's `text-muted`/`text-small` silently LOSES to a
 * variant's own `text-text`/`text-body` — same-property utilities both reach
 * the element and the generated stylesheet's order, not the attribute's,
 * decides. The `extend` block is mandatory, not decoration: this palette and
 * type scale are project tokens (`styles.css`'s `@theme`), so out of the box
 * `text-muted` and `text-small` are unknown class names tailwind-merge would
 * keep alongside the ones they mean to replace.
 */
export const cn = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["body", "large", "small"] }],
      "text-color": [
        {
          text: [
            "page",
            "surface",
            "border",
            "text",
            "muted",
            "accent",
            "accent-pressed",
            "disabled",
            "warning",
            "danger",
            "link",
            "code",
            "quote",
            "heading-a",
            "heading-b",
            "heading-c",
            "syntax-kw",
            "syntax-str",
            "syntax-num",
            "syntax-typ",
            "syntax-com",
          ],
        },
      ],
    },
  },
})
