Move the cache to a shared directory.

## Open Questions

### Where does the cache live?

The cache is per worktree today.

- [ ] In `$XDG_CACHE_HOME`
  - Shared by every worktree
- [x] Next to the repository[^th1]
  - Survives a worktree removal
- [ ] _your answer_

[^th1]:
    - H: Is this the git common dir?
    - A: Yes, the directory every worktree shares.

### How is it invalidated?

- [ ] By content hash
- [ ] By modification time
- [x] Keep both, hash wins on conflict
