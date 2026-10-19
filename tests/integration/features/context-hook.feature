@inmem
Feature: gtd context-hook stops an agent turn at its context limit

  `gtd context-hook` is a Claude Code settings hook for PostToolUse and
  PreCompact. It reads the hook's input on stdin and the context the
  transcript's latest assistant message used — its input, cache-read and
  cache-creation tokens — and compares it with shares of `--window`. Past
  `--soft` (default 0.6) it blocks with a request for a handoff note; past
  `--hard` (default 0.7), or whenever compaction is about to happen, it stops
  the turn. Below the soft limit it prints nothing.

  Background:
    Given a test project
    And a file outside the repository at "/transcripts/session.jsonl" with:
      """
      {"type":"user","message":{"role":"user","content":"build it"}}
      {"type":"assistant","message":{"id":"msg_1","role":"assistant","usage":{"input_tokens":2,"cache_read_input_tokens":100,"cache_creation_input_tokens":20,"output_tokens":9}}}
      {"type":"user","message":{"role":"user","content":[{"type":"tool_result"}]}}
      {"type":"assistant","message":{"id":"msg_2","role":"assistant","usage":{"input_tokens":1,"cache_read_input_tokens":599,"cache_creation_input_tokens":50,"output_tokens":12}}}
      """

  Scenario: below the soft limit the turn goes on
    When I run gtd with args "context-hook --window 1000 --soft 0.7 --hard 0.8" and stdin:
      """
      {"hook_event_name":"PostToolUse","transcript_path":"/transcripts/session.jsonl","tool_name":"Bash"}
      """
    Then it succeeds
    And stdout is empty

  Scenario: past the soft limit the agent is asked for a handoff note
    When I run gtd with args "context-hook --window 1000" and stdin:
      """
      {"hook_event_name":"PostToolUse","transcript_path":"/transcripts/session.jsonl","tool_name":"Bash"}
      """
    Then it succeeds
    And stdout contains "\"decision\":\"block\""
    And stdout contains "650 of 1000 tokens used, past the 60% soft limit"
    And stdout contains "end your turn with a short handoff note as your answer: what you touched, and what was next."

  Scenario: past the hard limit the turn stops behind the context-limit marker
    When I run gtd with args "context-hook --window 900" and stdin:
      """
      {"hook_event_name":"PostToolUse","transcript_path":"/transcripts/session.jsonl","tool_name":"Bash"}
      """
    Then it succeeds
    And stdout contains "{\"continue\":false,\"stopReason\":\"gtd: context limit: 650 of 900 tokens, past the 70% hard limit\"}"

  Scenario: compaction about to happen stops the turn whatever the count
    When I run gtd with args "context-hook --window 1000000" and stdin:
      """
      {"hook_event_name":"PreCompact","transcript_path":"/transcripts/session.jsonl","trigger":"auto","custom_instructions":null}
      """
    Then it succeeds
    And stdout contains "\"continue\":false"
    And stdout contains "gtd: context limit: the context is about to be compacted"

  Scenario: a subagent's tool call is left alone
    When I run gtd with args "context-hook --window 900" and stdin:
      """
      {"hook_event_name":"PostToolUse","transcript_path":"/transcripts/session.jsonl","agent_id":"a1","agent_type":"general-purpose","tool_name":"Bash"}
      """
    Then it succeeds
    And stdout is empty

  Scenario: a soft limit at or above the hard one is refused
    When I run gtd with args "context-hook --soft 0.8" and stdin:
      """
      {"hook_event_name":"PostToolUse","transcript_path":"/transcripts/session.jsonl"}
      """
    Then it fails
    And stderr contains "gtd context-hook: context.soft (0.8) must be below context.hard (0.7)"
