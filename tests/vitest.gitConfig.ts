import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Every git the suite spawns would otherwise read the developer's own
// ~/.gitconfig — a signing setup there (e.g. 1Password's op-ssh-sign) blocks
// each commit on an approval prompt nobody answers. Replacing the global and
// system layers (not GIT_CONFIG_COUNT, which outranks repo-local config)
// keeps per-fixture `git config` settings in charge. Runs at config load, so
// workers and every subprocess inherit it. One fixed path inside the
// checkout, never a shared tmpdir another user could pre-seed with a symlink,
// so runs leave nothing behind; staged in a private directory and renamed in,
// so a parallel run's git never reads it half-written.
export const isolateGitConfig = (): void => {
  const cache = fileURLToPath(new URL("../node_modules/.cache/", import.meta.url))
  mkdirSync(cache, { recursive: true })
  const path = `${cache}gtd-test-gitconfig`
  const stage = mkdtempSync(`${cache}gtd-test-gitconfig-`)
  const staged = `${stage}/gitconfig`
  writeFileSync(
    staged,
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
  renameSync(staged, path)
  rmSync(stage, { recursive: true, force: true })
  process.env["GIT_CONFIG_GLOBAL"] = path
  process.env["GIT_CONFIG_NOSYSTEM"] = "1"
}
