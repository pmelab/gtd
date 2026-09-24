import { cn } from "./cn.js"

export type NoticeTone = "info" | "error"

export interface NoticeProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly tone?: NoticeTone
  readonly children: React.ReactNode
}

/**
 * One designed block for every text-only state (package 02 Task 7) — the
 * five `App.tsx` states, its read-error branch, and `Refusal.tsx`'s banner
 * all route through this rather than a bare `<div style={{ padding: 16 }}>`.
 * `tone` is what makes a refusal read visually distinct from a `Saved` label
 * sharing the same live region — `error` is the only tone with a border,
 * asserted on computed style rather than by eye.
 */
const TONE_CLASSES: Record<NoticeTone, string> = {
  info: "bg-surface text-text",
  error: "bg-surface text-text border border-accent",
}

export const Notice = ({ tone = "info", className, children, ...props }: NoticeProps) => (
  <div className={cn("m-3 rounded p-4 text-body", TONE_CLASSES[tone], className)} {...props}>
    {children}
  </div>
)
