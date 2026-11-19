import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "./cn.js"

/*
 * 44px tall below 1024px (the phone thumb floor), 36px from the desktop
 * split up. The press scales on a transition, not a keyframe, so it stays
 * interruptible; the pressed colour lands on the first frame.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap select-none",
    "transition-[scale] duration-150 ease-out active:scale-96",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary-pressed/80 active:bg-primary-pressed",
        secondary:
          "border border-border bg-card text-foreground shadow-[0_1px_2px_rgb(21_26_29/0.05)] hover:bg-accent active:bg-accent",
        ghost: "bg-transparent text-foreground hover:bg-accent active:bg-accent",
        danger:
          "border border-destructive/50 bg-card text-destructive hover:bg-destructive hover:text-destructive-foreground active:bg-destructive active:text-destructive-foreground",
        link: "h-auto min-h-0 px-0 text-foreground underline underline-offset-4 decoration-muted-foreground hover:decoration-foreground active:scale-100",
      },
      size: {
        default: "min-h-11 min-w-11 px-4 lg:min-h-9 lg:min-w-9 lg:px-3",
        sm: "min-h-11 min-w-11 px-3 text-xs lg:min-h-8 lg:min-w-8",
        icon: "size-11 lg:size-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "default" },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  readonly asChild?: boolean
}

export const Button = ({ variant, size, asChild = false, className, ...props }: ButtonProps) => {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="button"
      {...(asChild ? {} : { type: "button" as const })}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
