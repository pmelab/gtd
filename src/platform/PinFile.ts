/** A process's pin as the launcher found it: the file's bytes and where its engine runs from. */
export interface FoundPin {
  readonly path: string
  readonly bytes: Uint8Array
}

/**
 * Where the launcher looks for a pin: the worktree's copy, else HEAD's — so
 * the landing after an unpin beat deleted the file still runs on the pin.
 */
export type PinFile = () => FoundPin | undefined
