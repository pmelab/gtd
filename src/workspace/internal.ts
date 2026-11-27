// What only gtd's own code uses: the supervisor and the testkit share one poll and the inbox's diff.
export { isFeed, runPoll, type PollOutcome } from "./feed.js"
export { isReaction, runReaction } from "./reaction.js"
export {
  applyPoll,
  dropGoneFeeds,
  dispatchableItems,
  dismiss,
  emptyInbox,
  idOf,
  inboxItems,
  setDispatch,
  type Dispatch,
  type Entry,
  type Inbox,
} from "./inbox.js"

export {
  detailText,
  nowView,
  reasonText,
  statusText,
  waitingText,
  worktreeName,
  worktreeBranch,
  worktreeSubtitle,
  worktreeTitle,
  type NowEntry,
} from "./now.js"
