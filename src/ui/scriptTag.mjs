// Plain `.mjs` (not `.ts`) so `scripts/inline-web-client.mjs` — a bare `node`
// script with no TypeScript transform — can import it directly, the same
// module both it and `src/ui/Server.ts` share, so the two never drift
// apart the way two independently-typed copies of this regex/function pair
// would.
export const SCRIPT_TAG_PATTERN = /<script type="module" src="\.\/main\.js"><\/script>/

/**
 * Inlines `script` into `template` in place of the `<script src="./main.js">`
 * tag. MUST use a replacement FUNCTION, not a replacement string: `.replace`
 * treats a string's second argument as a pattern where `$&`/`` $` ``/`$'`/`$$`
 * are all special — and real client JS contains `$&` literally (React's key
 * escaping calls `.replace(userProvidedKeyEscapeRegex, "$&/")` twice), which a
 * string replacement silently expands into a stray, script-terminating
 * `</script>` baked into the "inlined" output. A literal `</script>` inside
 * the bundled script itself would ALSO terminate the tag early — escaped here
 * as `<\/script>`, the standard guard, even though today's build has none.
 */
export const inlineScript = (template, script) =>
  template.replace(
    SCRIPT_TAG_PATTERN,
    () => `<script type="module">\n${script.replaceAll("</script>", "<\\/script>")}\n</script>`,
  )

/** The Tailwind CLI's own output link — `src/web/index.html`'s `<link rel="stylesheet" href="./main.css" />`, the CSS sibling of `SCRIPT_TAG_PATTERN` above. */
export const STYLE_TAG_PATTERN = /<link rel="stylesheet" href="\.\/main\.css" \/>/

/**
 * Inlines `css` into `template` in place of the `<link rel="stylesheet">`
 * tag — same replacement-FUNCTION requirement as `inlineScript` (a `$&` in
 * the css would otherwise be treated as a backreference by `.replace`'s
 * string form), and the same `</style>`-escaping guard a literal closing tag
 * inside the compiled CSS would need to not terminate early.
 */
export const inlineStyles = (template, css) =>
  template.replace(
    STYLE_TAG_PATTERN,
    () => `<style>\n${css.replaceAll("</style>", "<\\/style>")}\n</style>`,
  )
