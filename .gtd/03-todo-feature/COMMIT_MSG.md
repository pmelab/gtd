feat(todo): open-questions picker, count, statusline, and diagnostics

Implement lua/gtd/todo.lua: parse_open_questions + vim.ui.select picker that
jumps to a question heading, plus a project-wide unanswered count (counting
<!-- user answers here --> within ## Open Questions) exposed via
open_questions_count()/statusline() with git-root caching, and one WARN
vim.diagnostic per unanswered question on its ### line. Covered by specs against
the TODO.md fixture.
