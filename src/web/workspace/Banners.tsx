import { CircleX, TriangleAlert } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "../ui/alert.js"
import type { Banner } from "./view.js"

// A stale main checkout or an unknown project leaves the worktrees working; the rest break something.
const WARNING: ReadonlySet<Banner["kind"]> = new Set(["mainStale", "unknownProject"])

const TITLE: Readonly<Record<Banner["kind"], string>> = {
  configError: "Workspace settings not reloaded",
  unknownProject: "Unknown project in settings",
  mainStale: "A main checkout could not be brought up to date",
  adapterUnavailable: "An adapter is unavailable",
  reactionFailed: "A reaction failed",
}

/** Problems with the workspace itself, above every view. */
export const Banners = ({ banners }: { readonly banners: readonly Banner[] }) =>
  banners.length === 0 ? null : (
    <div className="flex flex-col gap-2" role="alert">
      {banners.map((b) => {
        const warning = WARNING.has(b.kind)
        return (
          <Alert
            key={`${b.kind}:${b.message}`}
            variant={warning ? "warning" : "destructive"}
            data-testid="banner"
          >
            {warning ? <TriangleAlert aria-hidden="true" /> : <CircleX aria-hidden="true" />}
            <AlertTitle>{TITLE[b.kind]}</AlertTitle>
            <AlertDescription className="font-mono text-xs break-words" data-testid="banner-detail">
              {b.message}
            </AlertDescription>
          </Alert>
        )
      })}
    </div>
  )
