import { cn } from "./cn.js"

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant
}

/**
 * One control system for every button in `src/web/` (package 02 Task 6) —
 * always `min-h-11 min-w-11` (Tailwind's 4px scale makes that exactly the
 * 44px thumb floor, no literal to retype), with real `active:`/`disabled:`/
 * `focus-visible:` pseudo-class utilities standing in for the hand-rolled
 * default/pressed/disabled states call sites used to fake with inline
 * styles. Tailwind's own preflight reset already strips native button chrome
 * (background/border/font), so nothing here re-erases it — a call site that
 * still does that by hand is the one thing this component exists to make
 * unnecessary.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-page active:bg-accent-pressed disabled:bg-disabled disabled:text-muted",
  secondary:
    "bg-surface text-text border border-border active:bg-border disabled:bg-surface disabled:text-disabled",
  ghost: "bg-transparent text-text active:bg-surface disabled:text-disabled",
  // Destructive actions are never distinguished by position alone — `Delete`
  // sits beside `Edit` in the same row on every FreeForm block.
  danger: "bg-transparent text-danger active:bg-surface disabled:text-disabled",
}

/**
 * `active:scale-96` with a 150ms transition, not a keyframe: a press is a
 * high-frequency interaction, so its feedback has to be interruptible (a
 * transition is, an animation is not) and short enough to never be waited
 * on. The scale is always exactly 0.96 — below ~0.95 a press reads as a
 * bounce rather than a depress. Only `scale` transitions: the pressed COLOUR
 * has to land on the first frame (it is the state cue motion may never be
 * the only carrier of), and it is what the press-state stories sample.
 */
const BASE_CLASSES = [
  "min-h-11 min-w-11 rounded px-3 py-2 text-body font-medium",
  "transition-[scale] duration-150 ease-out active:scale-96",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
  "disabled:pointer-events-none",
].join(" ")

export const Button = ({ variant = "secondary", className, ...props }: ButtonProps) => (
  <button
    type="button"
    className={cn(BASE_CLASSES, VARIANT_CLASSES[variant], className)}
    {...props}
  />
)
