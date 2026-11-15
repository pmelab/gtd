import type { ProjectView, WorktreeView } from "./Scan.js"

const escape = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  )

const STATUS_TEXT: Readonly<Record<WorktreeView["status"], string>> = {
  needsYou: "needs you",
  working: "working",
  error: "error",
  idle: "idle",
}

const worktreeRow = (w: WorktreeView): string => {
  const name = w.branch ?? w.path.split("/").at(-1) ?? w.path
  const detail = [w.label, w.message].filter((s) => s !== undefined && s !== "").join(" — ")
  return `<li class="${w.status}"><span class="status">${STATUS_TEXT[w.status]}</span> <b>${escape(name)}</b> <span class="label">${escape(detail)}</span></li>`
}

const projectSection = (p: ProjectView): string =>
  `<section><h2>${escape(p.name)}</h2>${
    p.failure !== undefined
      ? `<p class="failure">${escape(`${p.failure.adapter} unavailable: ${p.failure.message}`)}</p>`
      : ""
  }<ul>${p.worktrees.map(worktreeRow).join("")}</ul></section>`

// The palette is gtd ui's (src/web/styles.css): Radix dark steps.
const STYLE = `body{background:#111111;color:#eeeeee;font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:48rem;padding:1rem}
h1{font-size:1.25rem}h2{font-size:1rem;border-bottom:1px solid #3a3a3a;padding-bottom:.25rem}
ul{list-style:none;padding:0}li{background:#222222;border-radius:.5rem;margin:.25rem 0;padding:.5rem .75rem}
.status{font-size:.8rem;text-transform:uppercase}.label,.idle .status,.working .status{color:#b4b4b4}
.needsYou .status{color:#ffca16}.error .status,.failure{color:#ff9592}`

/** The Projects view: every worktree of every project, grouped by project. */
export const projectsPage = (projects: readonly ProjectView[]): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>gtd workspace</title><style>${STYLE}</style></head><body><h1>Projects</h1>${
    projects.length === 0 ? "<p>No projects found.</p>" : projects.map(projectSection).join("")
  }</body></html>`
