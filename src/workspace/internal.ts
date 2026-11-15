// What only gtd's own code uses: the supervisor and the testkit share one poll and the inbox's diff.
export { isFeed, runPoll } from "./feed.js"
export { applyPoll, dismiss, emptyInbox, inboxItems, type Inbox } from "./inbox.js"
