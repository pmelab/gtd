feat(init): wire setup, keymaps, autocmds, refresh triggers, and docs

Implement lua/gtd/init.lua setup(): merge configurable opts (overridable keys),
register global pickers (<leader>gq/<leader>gp), attach buffer-local maps for
*/TODO.md and */REVIEW.md (gd jump, <leader>gc/<cr> toggle), and refresh the
open-questions count + diagnostics on BufWritePost/FocusGained/timer. Apply
mini.icons/which-key niceties when present, and finalize the README (install,
key overrides, statusline wiring, keymap table).
