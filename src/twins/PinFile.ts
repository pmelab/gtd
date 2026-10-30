import { join } from "node:path"
import type { PinFile } from "../platform/index.js"
import type { InMemRepo } from "./InMemRepo.js"

export const inMemPinFile =
  (repo: InMemRepo, root: string, path: string): PinFile =>
  () => {
    const content = repo.readFile(path) ?? repo.fileAtRef("HEAD", path) ?? undefined
    return content === undefined
      ? undefined
      : { path: join(root, path), bytes: Buffer.from(content) }
  }
