import { Dialog as DialogPrimitive } from "radix-ui"

export const Sheet = DialogPrimitive.Root
export const SheetTitle = DialogPrimitive.Title

/**
 * Portal + blurred scrim + content. No corner close button: the footer's Cancel closes.
 * `closing` flips both parts to `data-state="closed"` while the root stays open,
 * so a caller can play its exit animation before it unmounts the sheet.
 */
export const SheetContent = ({
  children,
  closing = false,
  scrimClassName = "",
  className = "",
  ...props
}: DialogPrimitive.DialogContentProps & {
  readonly closing?: boolean
  readonly scrimClassName?: string
}) => {
  const state = closing ? "closed" : "open"
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-state={state}
        className={`fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] ${scrimClassName}`}
      />
      <DialogPrimitive.Content className={className} {...props} data-state={state}>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}
