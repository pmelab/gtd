import { useState, type ReactNode } from "react"
import type { InlineNode } from "../../steering/index.js"

/**
 * One projected `image`'s own rendering — its own component (not a case
 * inline in `InlineRun`) because it needs its own `useState`: `onError`
 * swaps the element for its alt text, which is load-bearing, not cosmetic
 * (R5) — the UI is served over TLS in every real path, so a plain `http://`
 * image is mixed content the browser blocks outright, and this swap is the
 * only thing that turns that silent failure into readable text. No fixed
 * aspect box: a loaded image reflows the prose column once, which is
 * accepted.
 */
const ProseImage = ({ src, alt }: { readonly src: string; readonly alt: string }) => {
  const [failed, setFailed] = useState(false)
  if (failed) return <>{alt}</>
  return (
    <img
      src={src}
      alt={alt}
      className="h-auto max-w-full"
      loading="lazy"
      decoding="async"
      // Never leaks the review host's own URL to a third-party origin in
      // the `Referer` header — the UI runs inside a Tailnet.
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

/** One `InlineNode.kind` → its own renderer — a lookup table, not a `switch`, so `InlineRun` itself stays a single dispatch with no per-case branch of its own (mirrors `ProseBlock.tsx`'s own `BLOCK_RENDERERS`). Each entry takes the node (already narrowed to its own kind by the lookup key) and this component's own `key`. */
const INLINE_RENDERERS: {
  readonly [K in InlineNode["kind"]]: (
    node: Extract<InlineNode, { readonly kind: K }>,
    key: number,
  ) => ReactNode
} = {
  text: (node) => node.value,
  strong: (node, key) => (
    <strong key={key}>
      <InlineRun nodes={node.children} />
    </strong>
  ),
  emphasis: (node, key) => (
    <em key={key}>
      <InlineRun nodes={node.children} />
    </em>
  ),
  delete: (node, key) => (
    <s key={key}>
      <InlineRun nodes={node.children} />
    </s>
  ),
  code: (node, key) => (
    <code key={key} className="text-code">
      {node.value}
    </code>
  ),
  link: (node, key) => (
    <a key={key} href={node.href} target="_blank" rel="noreferrer" className="text-link underline">
      <InlineRun nodes={node.children} />
    </a>
  ),
  image: (node, key) => <ProseImage key={key} src={node.src} alt={node.alt} />,
}

/**
 * The shared inline renderer every prose surface (`ProseBlock.tsx`'s block
 * kinds, `Hunk.tsx`'s description, `Plan.tsx`'s row, `Review.tsx`'s chunk
 * row) walks instead of a string — returns a bare fragment of children with
 * NO wrapper element, so a caller's own element (`HeadingBlock`'s own
 * `heading.tagName === "H2"` assertion, every other text-content check)
 * keeps resolving to the SAME element this renders children into.
 */
const InlineRun = ({ nodes }: { readonly nodes: readonly InlineNode[] }): ReactNode =>
  nodes.map((node, index) => {
    const render = INLINE_RENDERERS[node.kind] as (node: InlineNode, key: number) => ReactNode
    return render(node, index)
  })

/** Renders `inline` when present through `InlineRun`, falling back to plain (unparsed) `fallback` text — the malformed-node case where a block carries no inline structure at all. */
export const Inline = ({
  inline,
  fallback,
}: {
  readonly inline: readonly InlineNode[] | undefined
  readonly fallback: string
}): ReactNode => (inline !== undefined ? <InlineRun nodes={inline} /> : fallback)
