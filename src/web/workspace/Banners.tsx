import type { Banner } from "./view.js"

/** Problems with the workspace itself, above every view. */
export const Banners = ({ banners }: { readonly banners: readonly Banner[] }) =>
  banners.length === 0 ? null : (
    <div className="flex flex-col gap-2" role="alert">
      {banners.map((b) => (
        <p
          key={`${b.kind}:${b.message}`}
          className="rounded border border-danger bg-surface p-3 text-small text-danger"
          data-testid="banner"
        >
          {b.message}
        </p>
      ))}
    </div>
  )
