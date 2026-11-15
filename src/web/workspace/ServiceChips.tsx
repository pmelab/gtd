import { cn } from "../cn.js"
import type { Service, WorktreeView } from "./view.js"

const stateOf = (s: Service): string =>
  s.error !== undefined ? `error: ${s.error}` : s.running ? "running" : "stopped"

const COLOR = { error: "text-danger", running: "text-success", stopped: "text-muted" } as const

const Chip = ({ service }: { readonly service: Service }) => {
  const kind = service.error !== undefined ? "error" : service.running ? "running" : "stopped"
  const state = <span className={COLOR[kind]}>({stateOf(service)})</span>
  const chip = "rounded-full border border-divider bg-surface px-2 py-0.5 text-small"
  return service.url === undefined ? (
    <span className={chip} data-testid="service-chip">
      {service.name} {state}
    </span>
  ) : (
    <a
      className={cn(chip, "text-link")}
      href={service.url}
      target="_blank"
      rel="noreferrer"
      data-testid="service-chip"
    >
      {service.name} {state}
    </a>
  )
}

/** A worktree's services: name, running or not, the error; a chip with a URL opens it. */
export const ServiceChips = ({ worktree }: { readonly worktree: WorktreeView }) => {
  if (worktree.servicesFailure !== undefined) {
    return (
      <span className="text-small text-danger" data-testid="services-unavailable">
        services unavailable: {worktree.servicesFailure.message}
      </span>
    )
  }
  const services = worktree.services ?? []
  if (services.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {services.map((s) => (
        <Chip key={s.name} service={s} />
      ))}
    </div>
  )
}
