import type { WriteRefusalInfo } from "./api.js"

/** One persisted draft: the human's own unsent text, plus the banner naming what changed when the write that produced it was refused. */
export interface Draft {
  readonly text: string
  readonly banner: string
}

/**
 * The storage `drafts.ts` writes through — `window.localStorage`'s own shape,
 * injected so tests never touch a real browser API (mirrors `ui/Write.ts`'s
 * `WriteDeps` / `ui/Beat.ts`'s `BeatDeps` dependency-injection pattern used
 * throughout this codebase).
 */
export interface DraftStorage {
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
  readonly removeItem: (key: string) => void
}

/**
 * The real, DOM-backed `DraftStorage` — `window.localStorage` itself, wrapped
 * so every function in this module (which only ever depends on the
 * `DraftStorage` shape) can be pointed at real persistence in production.
 * References `window.localStorage` lazily, inside each method, rather than
 * once at module load — so importing this module never requires a `window`
 * to exist (this repo's unit test tier runs under Node, no DOM); only
 * actually CALLING one of these methods does, exactly like the real API.
 */
export const localStorageDraftStorage: DraftStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
}

const KEY_PREFIX = "gtd:draft:"

/** Keyed on worktree id PLUS file path — two files in one worktree (or the same file path in two worktrees) never share a draft. */
const draftKey = (worktreeId: string, filePath: string): string =>
  `${KEY_PREFIX}${worktreeId}:${filePath}`

/** The banner text naming what changed — one sentence per refusal reason, distinguishing WHICH half of the compare-and-swap token moved when that's the reason. */
export const bannerFor = (refusal: WriteRefusalInfo): string => {
  switch (refusal.reason) {
    case "stale-token":
      return refusal.moved === "sha"
        ? "Someone committed to this worktree while you were editing."
        : "This file changed on disk while you were editing."
    case "not-resting":
      return "This worktree moved on — it's no longer waiting on a human."
    case "file-vanished":
      return "This file no longer exists."
    case "anchor-unresolved":
      return "What you were editing no longer exists in this document."
    case "note-collision":
      return "This already has a note attached — refresh to see it."
    case "unsupported-mode":
      return "This file's mode isn't configured on the server."
  }
}

/** Persists `text` as a draft for `(worktreeId, filePath)`, banner derived from `refusal` — survives a page reload since it's `localStorage`-backed, never in-memory only. */
export const saveDraft = (
  storage: DraftStorage,
  worktreeId: string,
  filePath: string,
  text: string,
  refusal: WriteRefusalInfo,
): void => {
  const draft: Draft = { text, banner: bannerFor(refusal) }
  storage.setItem(draftKey(worktreeId, filePath), JSON.stringify(draft))
}

/** The persisted draft for `(worktreeId, filePath)`, or `undefined` when there is none (or the stored value is corrupt — never throws). */
export const loadDraft = (
  storage: DraftStorage,
  worktreeId: string,
  filePath: string,
): Draft | undefined => {
  const raw = storage.getItem(draftKey(worktreeId, filePath))
  if (raw === null) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<Draft>
    if (typeof parsed.text !== "string" || typeof parsed.banner !== "string") return undefined
    return { text: parsed.text, banner: parsed.banner }
  } catch {
    return undefined
  }
}

/** Discards the draft for `(worktreeId, filePath)` — after this, `hasDraft` is `false` and the next background refresh is let through. */
export const discardDraft = (storage: DraftStorage, worktreeId: string, filePath: string): void => {
  storage.removeItem(draftKey(worktreeId, filePath))
}

export const hasDraft = (storage: DraftStorage, worktreeId: string, filePath: string): boolean =>
  loadDraft(storage, worktreeId, filePath) !== undefined

/** A background refresh replaces the screen only when NO draft exists for it — the one rule the phone UI applies before swapping in freshly-polled content over whatever the human might be typing. */
export const shouldApplyBackgroundRefresh = (
  storage: DraftStorage,
  worktreeId: string,
  filePath: string,
): boolean => !hasDraft(storage, worktreeId, filePath)
