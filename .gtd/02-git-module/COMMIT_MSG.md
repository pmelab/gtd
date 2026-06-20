feat(git): add git runner, root/path resolution, and base extraction

Implement lua/gtd/git.lua: git_command with safety flags, get_root toplevel
lookup, get_todo_path/get_review_path resolution, and get_base parsing of the
<!-- base: <full-hash> --> marker from REVIEW.md. Covered by specs against the
fixtures.
