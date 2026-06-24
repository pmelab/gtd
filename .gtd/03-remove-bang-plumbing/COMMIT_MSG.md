refactor(gtd): remove dead `!!`/bang plumbing

The marker convention is gone — any human-review working-tree change is now
feedback. Delete the now-unused `hasBangAdded` GitService op and its test
block, and strip the `!!` clause from the await-review human-gate prompt.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
