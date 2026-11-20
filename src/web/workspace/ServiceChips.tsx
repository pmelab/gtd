import { CircleX, ExternalLink } from "lucide-react"
import { cn } from "../cn.js"
import type { Service, WorktreeView } from "./view.js"

const DOT = {
  error: "bg-destructive",
  running: "bg-success",
  stopped: "bg-muted-foreground",
} as const

const Chip = ({ service }: { readonly service: Service }) => {
  const kind = service.error !== undefined ? "error" : service.running ? "running" : "stopped"
  const content = (
    <>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[kind])} />
      <span className="font-medium">{service.name}</span>{" "}
      <span className={kind === "error" ? "text-destructive" : "text-muted-foreground"}>
        {service.error !== undefined ? `error: ${service.error}` : kind}
      </span>
    </>
  )
  const chip =
    "inline-flex min-h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs text-foreground"
  return service.url === undefined ? (
    <span className={chip} data-testid="service-chip">
      {content}
    </span>
  ) : (
    <a
      className={cn(
        chip,
        "hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
      href={service.url}
      target="_blank"
      rel="noreferrer"
      data-testid="service-chip"
    >
      {content}
      <ExternalLink aria-hidden="true" className="size-3 text-muted-foreground" />
    </a>
  )
}

/** The line a services outage leaves in place of the chips. */
export const ServicesFailure = ({ worktree }: { readonly worktree: WorktreeView }) =>
  worktree.servicesFailure === undefined ? null : (
    <p className="flex items-start gap-2 text-sm text-destructive">
      <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span data-testid="services-unavailable">
        services unavailable: {worktree.servicesFailure.message}
      </span>
    </p>
  )

/** A worktree's services: name, running or not, the error; a chip with a URL opens it. */
export const ServiceChips = ({ worktree }: { readonly worktree: WorktreeView }) => {
  if (worktree.servicesFailure !== undefined) return <ServicesFailure worktree={worktree} />
  const services = worktree.services ?? []
  if (services.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Services">
      {services.map((s) => (
        <li key={s.name} className="flex">
          <Chip service={s} />
        </li>
      ))}
    </ul>
  )
}
