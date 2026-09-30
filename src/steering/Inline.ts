import type { Definition, Node, PhrasingContent } from "mdast"
import { parseMarkdown } from "./MarkdownTree.js"

/**
 * The server-side projection of a run of mdast inline (phrasing) content —
 * the shape the client's shared renderer (`src/web/screens/InlineRun.tsx`)
 * walks instead of a string. Deliberately closed to these seven kinds: a
 * `footnoteReference` is dropped (see `projectInline`), a hard `break`
 * collapses to a single space `text` node, and an inline `html` node
 * projects as `text` carrying its raw source verbatim — no kind here can
 * ever carry raw HTML, which is what pins "markdown is never raw HTML" at
 * the type level as well as by test.
 */
export type InlineNode =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "strong"; readonly children: readonly InlineNode[] }
  | { readonly kind: "emphasis"; readonly children: readonly InlineNode[] }
  | { readonly kind: "delete"; readonly children: readonly InlineNode[] }
  | { readonly kind: "code"; readonly value: string }
  | { readonly kind: "link"; readonly href: string; readonly children: readonly InlineNode[] }
  | { readonly kind: "image"; readonly src: string; readonly alt: string }

/**
 * A `link`'s `href`/an `image`'s `src` passes only when it carries NO scheme
 * at all (relative, `./src/x.ts#42`, a bare fragment) or a scheme matching
 * `https?`/`mailto` case-insensitively — one allowlist for both attributes,
 * no per-attribute branch. `url` here is already entity-decoded by mdast
 * (`link.url`/`image.url`), which is exactly what makes this check catch
 * `&#106;avascript:` too — a client-side regex over raw source never sees
 * the decoded form at all.
 */
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/
const ALLOWED_SCHEME_RE = /^(https?|mailto)$/i

/**
 * Mirrors the two whitespace-removal passes the WHATWG URL parser — what a
 * real `<a href>`/`<img src>` actually runs through — applies to the WHOLE
 * input before it ever looks for a scheme: every ASCII tab/LF/CR is removed
 * from anywhere in the string, and every LEADING (and trailing) C0 control
 * (`U+0000`–`U+001F`) or space is trimmed off the ends. Skipping either pass
 * leaves a `javascript:` reachable here: `java&#9;script:alert(1)` needs the
 * first, a leading `&#32;`/`&#1;`/form-feed-prefixed `javascript:` (or an
 * angle-bracket destination's own literal leading spaces) needs the second —
 * both read as "no scheme, so allowed" here while the browser reads the
 * stripped `javascript:alert(1)` and executes it.
 */
const stripUrlWhitespace = (url: string): string =>
  url
    .replace(/[\t\n\r]/g, "")
    // eslint-disable-next-line no-control-regex -- the C0 control range IS the point: mirrors the WHATWG URL parser's own leading/trailing trim.
    .replace(/^[\x00-\x1f ]+|[\x00-\x1f ]+$/g, "")

const isAllowedUrl = (url: string): boolean => {
  const match = SCHEME_RE.exec(stripUrlWhitespace(url))
  return match === undefined || match === null || ALLOWED_SCHEME_RE.test(match[1]!)
}

/**
 * A marker's shape once it's plain text — `[^name]`, no whitespace, no `]` —
 * mirrors `Blocks.ts`'s own `MARKER_TEXT_RE` exactly (duplicated, not
 * imported: that one is private to the string-flattening path this module
 * doesn't otherwise touch). GFM only turns `[^name]` into a real
 * `footnoteReference` NODE when a matching definition exists; a dangling
 * marker with no definition never becomes one, so it survives as plain
 * `text` — this strips it there too, so `inline`/`detailInline` drop a
 * dangling marker the same way `stripMarkerText` already drops it from
 * `title`/`detail`, instead of leaking it into the UI for the first time.
 */
const MARKER_TEXT_RE = /\[\^([^\s\]]+)\]/g

/**
 * One `identifier` (mdast's own normalized form: markdown whitespace
 * collapsed, trimmed, case-folded) → the `definition` node it resolves to —
 * what a `linkReference`/`imageReference` needs to become a real `link`/
 * `image` instead of silently losing its own visible label/alt. Walks the
 * WHOLE tree, not just `tree.children`: a definition can sit anywhere
 * CommonMark allows one, not only at the document's top level.
 */
const collectDefinitions = (node: Node, into: Map<string, Definition>): void => {
  if (node.type === "definition") into.set((node as Definition).identifier, node as Definition)
  const children = (node as { children?: readonly Node[] }).children
  if (children) children.forEach((child) => collectDefinitions(child, into))
}

/** Every link/image reference definition in `content`, by normalized identifier — built off `parseMarkdown`'s own memoized tree, so calling this alongside another same-content call in the same pass never re-parses. */
export const definitionsOf = (content: string): ReadonlyMap<string, Definition> => {
  const map = new Map<string, Definition>()
  collectDefinitions(parseMarkdown(content), map)
  return map
}

type Definitions = ReadonlyMap<string, Definition>

/** A resolved `link`/`linkReference` — real `href` (already allowlist-checked) plus its own label children — or `undefined` when there is none to resolve to (no url at all, or an unresolved reference). */
const resolveLink = (
  url: string | undefined,
  labelChildren: readonly PhrasingContent[],
  definitions: Definitions,
): readonly InlineNode[] => {
  const children = projectInline(labelChildren, definitions)
  if (url !== undefined && isAllowedUrl(url)) return [{ kind: "link", href: url, children }]
  return children
}

/** A resolved `image`/`imageReference` — real `src` (already allowlist-checked) plus `alt` — or a degrade to plain `alt` text when there is nothing to resolve to. */
const resolveImage = (url: string | undefined, alt: string): readonly InlineNode[] =>
  url !== undefined && isAllowedUrl(url)
    ? [{ kind: "image", src: url, alt }]
    : [{ kind: "text", value: alt }]

/** One recursive `children: readonly InlineNode[]` wrap — `strong`/`emphasis`/`delete` share this exact shape. */
const projectWrapped = (
  kind: "strong" | "emphasis" | "delete",
  children: readonly PhrasingContent[],
  definitions: Definitions,
): readonly InlineNode[] => [{ kind, children: projectInline(children, definitions) }]

/**
 * One `PhrasingContent["type"]` → the `InlineNode`s it projects to (0, 1, or
 * — for a rejected/unresolved link — its own several label children) — a
 * lookup table, not a `switch`, so `projectInline` itself stays a single
 * dispatch with no per-case branch of its own (mirrors `ProseBlock.tsx`'s
 * own `BLOCK_RENDERERS`/`InlineRun.tsx`'s own `INLINE_RENDERERS`). A kind
 * with no entry (there is none left; every `PhrasingContent` member is
 * covered) projects to nothing.
 */
const NODE_PROJECTORS: {
  readonly [K in PhrasingContent["type"]]: (
    child: Extract<PhrasingContent, { readonly type: K }>,
    definitions: Definitions,
  ) => readonly InlineNode[]
} = {
  text: (child) => [{ kind: "text", value: child.value.replace(MARKER_TEXT_RE, "") }],
  strong: (child, definitions) => projectWrapped("strong", child.children, definitions),
  emphasis: (child, definitions) => projectWrapped("emphasis", child.children, definitions),
  delete: (child, definitions) => projectWrapped("delete", child.children, definitions),
  inlineCode: (child) => [{ kind: "code", value: child.value }],
  break: () => [{ kind: "text", value: " " }],
  html: (child) => [{ kind: "text", value: child.value }],
  footnoteReference: () => [],
  link: (child, definitions) => resolveLink(child.url, child.children, definitions),
  image: (child) => resolveImage(child.url, child.alt ?? ""),
  linkReference: (child, definitions) =>
    resolveLink(definitions.get(child.identifier)?.url, child.children, definitions),
  imageReference: (child, definitions) =>
    resolveImage(definitions.get(child.identifier)?.url, child.alt ?? ""),
}

/**
 * Projects one run of mdast `PhrasingContent` (a paragraph's/heading's own
 * `children`, or any other phrasing-content array) into `InlineNode`s.
 * `footnoteReference` is dropped outright — gtd's own review-note protocol,
 * never document content — and a rejected `link`/`image` degrades rather
 * than disappearing: a rejected link keeps its own (still-styled) label
 * children, a rejected image keeps only its alt text. An inline `html` node
 * (a real tag typed into prose) becomes a `text` node carrying its raw
 * source verbatim — never parsed, never a carrier for markup in the model.
 *
 * `definitions` (`definitionsOf`) resolves a `linkReference`/`imageReference`
 * (`[label][id]`/`![alt][id]`) to its own `link`/`image` the same way a
 * bare `[label](url)` resolves — an UNRESOLVED reference (no matching
 * definition, or the caller passed none) degrades exactly like a
 * scheme-rejected one: the label's own children for a link, bare alt text
 * for an image — never silently dropped.
 */
export const projectInline = (
  children: readonly PhrasingContent[],
  definitions: Definitions = new Map(),
): readonly InlineNode[] =>
  children.flatMap((child) => {
    const project = NODE_PROJECTORS[child.type] as (
      child: PhrasingContent,
      definitions: Definitions,
    ) => readonly InlineNode[]
    return project(child, definitions)
  })

/** `nodes`, recursively, with every `image` replaced by a `text` node carrying its alt — the compact-row rule (R2): an image collapses to alt text server-side so a compact row can never fire a remote fetch. */
export const collapseImages = (nodes: readonly InlineNode[]): readonly InlineNode[] =>
  nodes.map((node) => {
    if (node.kind === "image") return { kind: "text" as const, value: node.alt }
    if ("children" in node) return { ...node, children: collapseImages(node.children) }
    return node
  })

/** Joins several already-projected inline runs with a single `text: " "` separator, dropping empty runs entirely — mirrors `Blocks.ts`'s own `.join(" ")` flattening, structurally rather than on strings. */
export const joinInlineRuns = (runs: readonly (readonly InlineNode[])[]): readonly InlineNode[] => {
  const nonEmpty = runs.filter((run) => run.length > 0)
  const result: InlineNode[] = []
  nonEmpty.forEach((run, index) => {
    if (index > 0) result.push({ kind: "text", value: " " })
    result.push(...run)
  })
  return result
}
