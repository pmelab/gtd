Feature: gtd judge run — an answerer a driver chooses to pipe through

  `gtd judge run` reads the `gtd judge --json` document on stdin and writes a
  verdict `[{ id, answer, p }]` on stdout — the same shape `gtd judge answer`
  decodes. The `fixed` provider answers from `--answers <path>` or the
  `GTD_JUDGE_ANSWERS` env var; a question the file does not cover is left out,
  so the flow takes its conservative branch.

  Background:
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judge } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        const { answers } = await judge("review", {
          questions: [
            { id: "q1", primitive: "noul", instructions: "i", criteria: "c" },
            { id: "q2", primitive: "noul", instructions: "i", criteria: "c" },
          ],
          evidence: { note: "review" },
          message: "run `gtd judge run`, or land with a clean tree",
        })
        if (answers.q1?.answer === "yes" && answers.q2?.answer === "yes") {
          await agent("confident", "both answered yes")
        } else {
          await agent("conservative", "the conservative path")
        }
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And a file "answers.json" with:
      """
      [{"id":"q1","answer":true,"p":0.9},{"id":"q2","answer":true,"p":0.8},{"id":"unasked","answer":"x","p":1}]
      """

  @inmem
  Scenario: judge | judge run | judge answer round-trips and lands the Gtd-Judge: trailer
    When I run gtd land
    Then it succeeds
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider fixed --answers answers.json | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): review → confident"
    And the last commit body contains "Gtd-Judge:"

  @inmem
  Scenario: an answers file covering one of two questions lands the conservative branch
    Given a file "answers.json" with:
      """
      [{"id":"q1","answer":true,"p":0.9}]
      """
    When I run gtd land
    Then it succeeds
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider fixed --answers answers.json | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): review → conservative"

  @inmem
  Scenario: GTD_JUDGE_ANSWERS answers when no --answers is given
    Given an environment variable "GTD_JUDGE_ANSWERS" set to "[{\"id\":\"q1\",\"answer\":true,\"p\":0.9},{\"id\":\"q2\",\"answer\":true,\"p\":0.8}]"
    When I run gtd land
    Then it succeeds
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider fixed | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): review → confident"

  @inmem
  Scenario: an unknown --provider exits 2
    When I run gtd with args "judge run --provider nope" and stdin:
      """
      {"state":{},"questions":[]}
      """
    Then the exit code is 2
    And stdout is empty

  @inmem
  Scenario: a stdin that is not a judgment document exits 2, like judge answer
    When I run gtd with args "judge run --provider fixed" and stdin:
      """
      not json
      """
    Then the exit code is 2
    And stdout is empty
    And stderr contains "gtd judge run: stdin is not valid JSON"
    When I run gtd with args "judge run --provider fixed" and stdin:
      """
      {"state":{}}
      """
    Then the exit code is 2
    And stderr contains "gtd judge run: stdin has no \"questions\" array"

  @inmem
  Scenario: --json on judge run exits 2
    When I run gtd with args "judge run --provider fixed --json" and stdin:
      """
      {"state":{},"questions":[]}
      """
    Then the exit code is 2

  @inmem
  Scenario: a malformed p exits 1 with empty stdout
    Given an environment variable "GTD_JUDGE_ANSWERS" set to "[{\"id\":\"q1\",\"answer\":true,\"p\":2}]"
    When I run gtd with args "judge run --provider fixed" and stdin:
      """
      {"state":{},"questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}
      """
    Then the exit code is 1
    And stdout is empty
    And stderr contains "q1"

  # The `jev` provider, against a local stub server (no real network).
  @inmem
  Scenario: jev | judge answer round-trips a noul at 0.1 as "no" and lands the conservative branch
    Given an environment variable "TYPESAFE_API_KEY" set to "k"
    And a judge stub server answering 200 with:
      """
      {"answers":{"q1":{"type":"noul","noul":0.9},"q2":{"type":"noul","noul":0.1}}}
      """
    When I run gtd land
    Then it succeeds
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider jev | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): review → conservative"

  @inmem
  Scenario: jev | two noul answers above 0.5 land the confident branch
    Given an environment variable "TYPESAFE_API_KEY" set to "k"
    And a judge stub server answering 200 with:
      """
      {"answers":{"q1":{"type":"noul","noul":0.9},"q2":{"type":"noul","noul":0.8},"extra":{"type":"noul","noul":0}}}
      """
    When I run gtd land
    Then it succeeds
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider jev | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): review → confident"

  @inmem
  Scenario: jev maps choice and score answers to the answer given and its probability
    Given an environment variable "TYPESAFE_API_KEY" set to "k"
    And a judge stub server answering 200 with:
      """
      {"answers":{"c":{"type":"choice","choice":"b","probabilities":{"a":0.2,"b":0.8}},"s":{"type":"score","probabilities":{"1":0.1,"2":0.7,"3":0.2}}}}
      """
    When I run gtd with args "judge run --provider jev" and stdin:
      """
      {"state":{},"questions":[{"id":"c","primitive":"choice","instructions":"i","criteria":"a: first. b: second"},{"id":"s","primitive":"score","instructions":"i","criteria":"L1: bad. L2: ok. L3: good"}]}
      """
    Then the exit code is 0
    And stdout contains "\"id\":\"c\",\"answer\":\"b\",\"p\":0.8"
    And stdout contains "\"id\":\"s\",\"answer\":2,\"p\":0.7"

  @inmem
  Scenario: jev without TYPESAFE_API_KEY exits 1 with empty stdout
    When I run gtd with args "judge run --provider jev" and stdin:
      """
      {"state":{},"questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}
      """
    Then the exit code is 1
    And stdout is empty
    And stderr contains "TYPESAFE_API_KEY"

  @inmem
  Scenario: a jev 500 exits 1 with the body on stderr and empty stdout
    Given an environment variable "TYPESAFE_API_KEY" set to "k"
    And a judge stub server answering 500 with:
      """
      {"error":"model exploded"}
      """
    When I run gtd with args "judge run --provider jev" and stdin:
      """
      {"state":{},"questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}
      """
    Then the exit code is 1
    And stdout is empty
    And stderr contains "model exploded"

  @inmem
  Scenario: jev answering one of two questions exits 1 with empty stdout
    Given an environment variable "TYPESAFE_API_KEY" set to "k"
    And a judge stub server answering 200 with:
      """
      {"answers":{"q1":{"type":"noul","noul":0.9}}}
      """
    When I run gtd with args "judge run --provider jev" and stdin:
      """
      {"state":{},"questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"},{"id":"q2","primitive":"noul","instructions":"i","criteria":"c"}]}
      """
    Then the exit code is 1
    And stdout is empty
    And stderr contains "q2"

  @inmem
  Scenario: jev | choice and score answers round-trip through judge answer and route
    Given a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, judge } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start a process" })
        const { answers } = await judge("review", {
          questions: [
            { id: "c", primitive: "choice", instructions: "i", criteria: "alpha: first. beta: second" },
            { id: "s", primitive: "score", instructions: "i", criteria: "L1: bad. L2: ok. L3: good" },
          ],
          evidence: { note: "review" },
          message: "run `gtd judge run`, or land with a clean tree",
        })
        if (answers.c?.answer === "beta" && answers.s?.answer === "2") {
          await agent("matched", "beta and 2")
        } else {
          await agent("conservative", "the conservative path")
        }
      }
      """
    And an environment variable "TYPESAFE_API_KEY" set to "k"
    And a judge stub server answering 200 with:
      """
      {"answers":{"c":{"type":"choice","choice":"beta","probabilities":{"alpha":0.2,"beta":0.8}},"s":{"type":"score","probabilities":{"1":0.1,"2":0.7,"3":0.2}}}}
      """
    When I run gtd land
    Then it succeeds
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider jev | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): review → matched"

  # The `llm` provider, against a scripted `claude` (no real model).
  @inmem
  Scenario: llm | judge answer round-trips and lands the confident branch
    Given claude answers with:
      """
      {"type":"result","is_error":false,"structured_output":{"q1":{"answer":"yes","p":0.9},"q2":{"answer":"yes","p":0.8}}}
      """
    When I run gtd land
    Then it succeeds
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider llm | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): review → confident"

  @inmem
  Scenario: no --provider with an empty TYPESAFE_API_KEY answers through claude
    Given an environment variable "TYPESAFE_API_KEY" set to ""
    And claude answers with:
      """
      {"type":"result","is_error":false,"structured_output":{"q1":{"answer":"yes","p":0.9},"q2":{"answer":"yes","p":0.8}}}
      """
    When I run gtd land
    Then it succeeds
    When I run in the shell:
      """
      gtd judge --json | gtd judge run | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): review → confident"

  @inmem
  Scenario: no --provider with TYPESAFE_API_KEY set answers through jev, not claude
    Given an environment variable "TYPESAFE_API_KEY" set to "k"
    And a judge stub server answering 200 with:
      """
      {"answers":{"q1":{"type":"noul","noul":0.9},"q2":{"type":"noul","noul":0.1}}}
      """
    And claude answers with:
      """
      {"type":"result","is_error":false,"structured_output":{"q1":{"answer":"yes","p":0.9},"q2":{"answer":"yes","p":0.8}}}
      """
    When I run gtd land
    Then it succeeds
    When I run in the shell:
      """
      gtd judge --json | gtd judge run | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): review → conservative"

  @inmem
  Scenario: --model reaches claude's argv
    Given an environment variable "TYPESAFE_API_KEY" set to ""
    And claude answers with:
      """
      {"type":"result","is_error":false,"structured_output":{"q1":{"answer":"yes","p":0.9},"q2":{"answer":"yes","p":0.8}}}
      """
    When I run gtd land
    Then it succeeds
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --model opus | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): review → confident"
    And claude was run with "--model opus"

  @inmem
  Scenario: sonnet is the llm default and the verdict round-trips
    Given an environment variable "TYPESAFE_API_KEY" set to ""
    And claude answers with:
      """
      {"type":"result","is_error":false,"structured_output":{"q1":{"answer":"yes","p":0.9},"q2":{"answer":"yes","p":0.8}}}
      """
    When I run gtd land
    Then it succeeds
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider llm | gtd judge answer --json=script | sh
      """
    Then it succeeds
    And the last commit subject is "gtd(judge): review → confident"
    And claude was run with "--model sonnet"

  @inmem
  Scenario: a failing claude exits 1 with empty stdout
    Given claude fails with exit 1 and stderr "no login"
    When I run gtd land
    Then it succeeds
    When I run in the shell:
      """
      gtd judge --json | gtd judge run --provider llm
      """
    Then the exit code is 1
    And stdout is empty
    And stderr contains "claude exited 1: no login"

  # The user-level judge.json, then GTD_JUDGE_PROVIDER, then the flag — per field.
  @inmem
  Scenario: without flags, the provider comes from the user-level judge.json
    Given a user-level judge config with:
      """
      {"provider": "fixed"}
      """
    And an environment variable "GTD_JUDGE_ANSWERS" set to "[{\"id\":\"q1\",\"answer\":true,\"p\":0.9}]"
    When I run gtd with args "judge run" and stdin:
      """
      {"state":{},"questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}
      """
    Then it succeeds
    And stdout contains "\"id\":\"q1\""

  @inmem
  Scenario: GTD_JUDGE_PROVIDER beats the judge.json provider
    Given a user-level judge config with:
      """
      {"provider": "fixed"}
      """
    And an environment variable "GTD_JUDGE_PROVIDER" set to "jev"
    When I run gtd with args "judge run" and stdin:
      """
      {"state":{},"questions":[]}
      """
    Then it fails
    And stderr contains "--provider jev needs TYPESAFE_API_KEY"

  @inmem
  Scenario: a --provider flag beats both GTD_JUDGE_PROVIDER and judge.json
    Given a user-level judge config with:
      """
      {"provider": "jev"}
      """
    And an environment variable "GTD_JUDGE_PROVIDER" set to "jev"
    And an environment variable "GTD_JUDGE_ANSWERS" set to "[{\"id\":\"q1\",\"answer\":true,\"p\":0.9}]"
    When I run gtd with args "judge run --provider fixed" and stdin:
      """
      {"state":{},"questions":[{"id":"q1","primitive":"noul","instructions":"i","criteria":"c"}]}
      """
    Then it succeeds
    And stdout contains "\"id\":\"q1\""

  @inmem
  Scenario: a model from judge.json with a non-llm provider is the resolved-pair error
    Given a user-level judge config with:
      """
      {"model": "sonnet"}
      """
    When I run gtd with args "judge run --provider jev" and stdin:
      """
      {"state":{},"questions":[]}
      """
    Then it fails
    And stderr contains "a model only applies to provider llm, not jev"

  @inmem
  Scenario: an invalid GTD_JUDGE_PROVIDER names the variable and exits 1
    Given an environment variable "GTD_JUDGE_PROVIDER" set to "gpt"
    When I run gtd with args "judge run" and stdin:
      """
      {"state":{},"questions":[]}
      """
    Then the exit code is 1
    And stderr contains "GTD_JUDGE_PROVIDER"
