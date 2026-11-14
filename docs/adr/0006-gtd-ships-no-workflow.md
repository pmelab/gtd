# gtd ships no workflow

gtd is an engine, not a method. Every workflow is the consumer's own code in
their `gtd.config.ts`. gtd once bundled a default workflow and later kept one in
a separate repository; both were removed, because a shipped workflow's step
names and conventions became gtd's public API and pulled the engine toward one
way of working.
