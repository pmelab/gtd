# Steering files

A steering file is how an agent and a person talk during a process: the agent
writes it, the person reads and answers it — on the phone (`gtd ui`), in an
editor (`gtd lsp`), or by hand — and the next step reads the answers back. A
step names it with its `file` option. Every steering file has the same format: a
markdown document of **widgets**.

## Widgets

A heading of any level that opens with one of four emoji starts an input widget.
The text between the heading and the checkboxes is the widget's description; the
widget ends with its first checkbox list.

| Emoji | Widget           | Checkboxes                                         | Must be answered         |
| ----- | ---------------- | -------------------------------------------------- | ------------------------ |
| 🔘    | single select    | the options; the person ticks one                  | yes                      |
| ☑️    | multi select     | the options; the person ticks any                  | no                       |
| ❔    | boolean          | exactly one                                        | no — unticked means "no" |
| 🔍    | review checklist | hunk pointers, `./path#start-end` or `./path#line` | yes — every hunk ticked  |

A select may end with a `- [ ] ✏️` item: the person writes their own answer
after the emoji. Everything else in the file — headings without one of the four
emoji, prose, lists, code, tables, and text after a widget's checkboxes — is
static content.

```markdown
# Plan: rate limiting

The API has no limit today. This plan adds one per token.

## 🔘 Where is the counter stored?

Redis is already deployed; memory is lost on restart.

- [ ] Redis
- [ ] In process memory
- [ ] ✏️

### ☑️ Which endpoints?

- [x] `/search`
- [ ] `/upload`

## 🔍 Middleware

Adds the limiter in front of every route.

- [ ] ./src/middleware/limit.ts#1-40
- [ ] ./src/app.ts#12-14 — wires it in

## ❔ Ship behind a flag?

- [ ] Yes
```

## Annotations

The person may attach a footnote to any paragraph or widget:

```markdown
## 🔘 Where is the counter stored?[^1]

[^1]: Why store a counter at all?
```

An annotation sends the file back: a person may land with required widgets
unanswered as soon as the file holds one. The next steering step works what each
annotation says into the document and removes it — a steering step's turn may
not leave one behind.

## Steering steps

An agent step with a `file` is a steering step. gtd checks its turn itself:

- the file exists, and every widget in it is well formed;
- no annotation is left in it;
- with the step's `widgets` option, it holds only those widget kinds;
- every hunk pointer lies in the change since the step's review base, and with
  `coverage: true` every changed range is listed;
- the turn changed no other path — a steering step writes its file and nothing
  else.

A turn that fails any of these goes back to the agent in the same session with
each problem as `file:line: message`; after `cap` tries the process rests at
`<step>.invalid`. gtd opens the step's prompt with these rules, a reference of
every widget, and the lines the person last changed in the file.

## Formatting

gtd writes every steering file it lands in one canonical form: paragraphs
refilled to 80 columns, a task item's continuation lines under its text,
headings, links, hunk pointers, code and tables left as written.
`gtd check --write <file>` does the same by hand.
