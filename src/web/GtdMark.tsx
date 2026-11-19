import { cn } from "./cn.js"

/** The gtd app mark, drawn from the icon pack's small-size master. Brand colours are fixed: it is the same tile in both themes. */
export const GtdMark = ({ className }: { readonly className?: string }) => (
  <svg
    viewBox="0 0 64 64"
    aria-hidden="true"
    focusable="false"
    className={cn("size-5 shrink-0", className)}
  >
    <rect width="64" height="64" rx="13" fill="#151A1D" />
    <path d="M18 19V47" stroke="#FAFAF7" strokeWidth="3" strokeLinecap="round" />
    <circle cx="18" cy="17" r="7" fill="#FFC328" />
    <path
      d="m14.5 17 2.5 2.5 5-5.5"
      fill="none"
      stroke="#151A1D"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="18" cy="32" r="5.5" fill="#151A1D" stroke="#FAFAF7" strokeWidth="2.5" />
    <circle cx="18" cy="32" r="2.5" fill="#FFC328" />
    <circle cx="18" cy="47" r="5.5" fill="#151A1D" stroke="#FAFAF7" strokeWidth="2.5" />
    <path d="M30 17H52M30 32H52" stroke="#FAFAF7" strokeWidth="3.5" strokeLinecap="round" />
    <path d="M30 47H52" stroke="#C9CBCD" strokeWidth="3.5" strokeLinecap="round" />
  </svg>
)
