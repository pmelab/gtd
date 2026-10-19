/** A Claude Code transcript whose latest assistant message used `tokens` of context, as the hook reads it from `transcript_path`. */
export const transcriptAt = (tokens: number): string =>
  [
    { type: "user", message: { role: "user", content: "build it" } },
    {
      type: "assistant",
      message: {
        id: "msg_1",
        role: "assistant",
        usage: { input_tokens: 3, cache_read_input_tokens: 10, cache_creation_input_tokens: 7 },
      },
    },
    { type: "user", message: { role: "user", content: [{ type: "tool_result" }] } },
    {
      type: "assistant",
      message: {
        id: "msg_2",
        role: "assistant",
        usage: {
          input_tokens: 1,
          cache_read_input_tokens: tokens - 1001,
          cache_creation_input_tokens: 1000,
          output_tokens: 500,
        },
      },
    },
    { type: "attachment", attachment: { type: "hook_success" } },
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n") + "\n"
