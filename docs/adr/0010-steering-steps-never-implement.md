# A steering step never implements

An agent step that declares a steering file may write that file and nothing
else, and the file is the only thing it says to the human: no chat questions, no
notes in other files, no replies in source comments. The human answers in the
same file — ticking inputs, editing it directly, or adding footnote annotations
that the next steering step must work in and remove. We chose this over letting
one turn both change code and ask about it, because a turn that does both cannot
be reviewed as either, and feedback scattered over chat, code comments and side
files was regularly lost. Code threads were removed for the same reason.
