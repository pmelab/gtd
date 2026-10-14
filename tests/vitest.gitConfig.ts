import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Every git the suite spawns would otherwise read the developer's own
// ~/.gitconfig — a signing setup there (e.g. 1Password's op-ssh-sign) blocks
// each commit on an approval prompt nobody answers. Replacing the global and
// system layers (not GIT_CONFIG_COUNT, which outranks repo-local config)
// keeps per-fixture `git config` settings in charge. Runs at config load, so
// workers and every subprocess inherit it.
export const isolateGitConfig = (): void => {
  const path = join(mkdtempSync(join(tmpdir(), "gtd-test-gitconfig-")), "gitconfig")
  writeFileSync(
    path,
    [
      "[user]",
      "\tname = gtd test",
      "\temail = test@gtd.invalid",
      "[init]",
      "\tdefaultBranch = main",
      "[commit]",
      "\tgpgsign = false",
      "[tag]",
      "\tgpgsign = false",
      "",
    ].join("\n"),
  )
  process.env["GIT_CONFIG_GLOBAL"] = path
  process.env["GIT_CONFIG_NOSYSTEM"] = "1"
}
