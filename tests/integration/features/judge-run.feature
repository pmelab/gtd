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

  @live
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

  @live
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

  @live
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
  @live
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

  @live
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

  @live
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
