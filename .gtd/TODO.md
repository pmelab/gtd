i want to make footnotes a commenting tool in planning and review files

- a footnote acts as a longer comment that is attached at a specific context
  (after a word or sentence)
- the agent prompt that receives feedback on those files has to interpret it
  correctly this way
- footnotes can also be attached to review hunks as comments to them (in the
  review.md file)
- there is an lsp action to add a footnote after the current word
  - the footnote markder is intelligently added at that position (after word, or
    at curser if it is after the word already)
  - the footnote itself is added below the current paragraph/list
  - go-to-symbol is used to jump back and forth between the footnote marker and
    the footnote
