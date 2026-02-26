# Extract Commit Prompt into Its Own Prompt File

## Action Items

### Create `src/prompts/commit.md`

- [x] Add `src/prompts/commit.md` with the commit summarization prompt
  - Move the inline `PROMPT` template from `src/services/CommitMessage.ts` into
    a markdown file
  - Replace the `${diff}` string interpolation with a `{{diff}}` placeholder to
    match the project's `interpolate()` convention
  - Content:
    `Summarize this diff as a git commit message (max 60 chars, no emoji, no prefix, lowercase start, imperative mood). Reply with ONLY the commit message, nothing else.\n\n\`\`\`diff\n{{diff}}\n\`\`\``
  - Tests: File exists at `src/prompts/commit.md` and contains the `{{diff}}`
    placeholder and the summarization instruction text

### Export `commitPrompt` from `src/prompts/index.ts`

- [x] Import `commit.md` and re-export it as `commitPrompt`
  - Add `import commitPrompt from "./commit.md"` alongside the existing
    `plan.md` and `build.md` imports
  - Add `commitPrompt` to the named exports
  - Tests: `src/prompts/index.test.ts` — add a test that `commitPrompt` is a
    non-empty string and contains the word `commit`

### Update `CommitMessage.ts` to use the prompt file

- [ ] Replace the inline `PROMPT` function with `commitPrompt` + `interpolate`
  - Remove the `PROMPT` arrow function from `src/services/CommitMessage.ts`
  - Import `{ commitPrompt, interpolate }` from `"../prompts/index.js"`
  - Replace the call `PROMPT(diff)` with `interpolate(commitPrompt, { diff })`
  - Tests: Existing `CommitMessage.test.ts` test "passes diff to agent with
    summarization prompt" continues to pass; `capturedPrompt` still contains the
    diff content and `"commit message"`
