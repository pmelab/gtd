export type ButtonVariant = "primary" | "secondary" | "ghost"

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
}

export const Button = ({ variant = "secondary", className, ...props }: ButtonProps) => (
  <button
    type="button"
    className={[
      "min-h-11 min-w-11 rounded px-3 py-2 text-body font-medium",
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
      "disabled:pointer-events-none",
      VARIANT_CLASSES[variant],
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...props}
  />
)
