import { Button } from "./Button.js"
import { Notice } from "./Notice.js"

/**
 * `ui/Write.ts#WriteFormatNotice`'s mirror, kept as a plain local type (never
 * importing `ui/Write.ts`) so this stays a thin client-side shape — exactly
 * like `api.ts#WriteRefusalInfo`'s own identical convention.
 */
export interface FormatNotice {
  readonly command: string
  readonly exitCode: number | null
}

/**
 * The one `ui.format` failure surface, shared by every screen that writes
 * through `setValue`/`writeNote`/`done` (`Plan.tsx`, `Review.tsx`,
 * `FreeForm.tsx`): a `ui.format` command runs on EVERY ui write regardless of
 * which screen made it, so Task 5's own bullet — "that failure is reported to
 * the client as a notice naming the command and its exit code" — is
 * unqualified by screen. Never a refusal (the write itself already
 * succeeded): a distinct `Notice`, dismissible on its own, never routed
 * through `Refusal.tsx#RefusalBanner`.
 */
export const FormatNoticeBanner = ({
  notice,
  onDismiss,
}: {
  readonly notice: FormatNotice | undefined
  readonly onDismiss: () => void
}) => {
  if (notice === undefined) return null
  return (
    <Notice
      tone="error"
      role="status"
      aria-live="polite"
      data-testid="format-notice"
      className="flex items-center justify-between gap-2"
    >
      <span>
        {`ui.format failed (exit ${notice.exitCode ?? "spawn error"}): ${notice.command}`}
      </span>
      <Button variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </Notice>
  )
}
