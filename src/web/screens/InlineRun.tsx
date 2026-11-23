import { ExternalLink, File, FileDiff } from "lucide-react"
import { createContext, useContext, useState, type ReactNode } from "react"
import type { InlineNode } from "../../steering/index.js"

/** `./path#a` or `./path#a-b`: a hunk pointer that opens in the by-hunk view. */
export const HUNK_HREF_RE = /^\.\/(.+)#(\d+)(?:-(\d+))?$/

/** Set by the document screen: opens the by-hunk view at the tapped link. */
export const HunkOpenContext = createContext<((target: HTMLElement) => void) | undefined>(undefined)

/** A code span that names a repo file: a slash path, or a bare name with a known extension, optionally `:line`. */
const PATH_RE =
  /^(?:\.{1,2}\/)?[\w@.-]+(?:\/[\w@.-]+)+(?::\d+(?:-\d+)?)?$|^[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|ya?ml|toml|sh|py|go|css|html|sql|graphql|feature)(?::\d+(?:-\d+)?)?$/

const PATH = "font-mono text-[0.875em] text-path"

const LINK =
  "text-link underline decoration-muted-foreground underline-offset-4 hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"

const Link = ({ href, children }: { readonly href: string; readonly children: ReactNode }) => {
  const open = useContext(HunkOpenContext)
  if (open !== undefined && HUNK_HREF_RE.test(href)) {
    return (
      <a
        href={href}
        data-hunk={href}
        className={`${LINK} ${PATH} decoration-path`}
        onClick={(e) => {
          e.preventDefault()
          open(e.currentTarget)
        }}
      >
        <FileDiff aria-hidden="true" className="mr-1 inline size-3.5 align-[-0.125em]" />
        {children}
      </a>
    )
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK}>
      {children}
      <ExternalLink aria-hidden="true" className="ml-0.5 inline size-3.5 align-[-0.125em]" />
    </a>
  )
}

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
    <strong key={key} className="font-bold text-heading">
      <InlineRun nodes={node.children} />
    </strong>
  ),
  emphasis: (node, key) => (
    <em key={key} className="text-emphasis italic">
      <InlineRun nodes={node.children} />
    </em>
  ),
  delete: (node, key) => (
    <s key={key}>
      <InlineRun nodes={node.children} />
    </s>
  ),
  code: (node, key) =>
    PATH_RE.test(node.value) ? (
      <code key={key} className={PATH}>
        <File aria-hidden="true" className="mr-1 inline size-3.5 align-[-0.125em]" />
        {node.value}
      </code>
    ) : (
      <code
        key={key}
        className="rounded-sm border border-border bg-code-bg px-1 py-0.5 font-mono text-[0.875em] text-code"
      >
        {node.value}
      </code>
    ),
  link: (node, key) => (
    <Link key={key} href={node.href}>
      <InlineRun nodes={node.children} />
    </Link>
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
