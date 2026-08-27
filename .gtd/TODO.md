we need to improve the prompt emitted by "install". it should:

- look for agents and ask the user which one to use
- create the loop as a "gtd-build" command
- make sure model variables are configured correctly. also ask the user if in
  doubt which one to use
- create a "gtd-edit" command that opens the steering file in the users editor
- create a "gtd-review" command that takes a commitish argument and starts the
  review process
- create a "gtd-fix" command that enters the fix process
- first check if any of the commands already exist and see if they have to be
  updated due to changes in gtd
- check if there are lsp-enabled editors available and propose to configure the
  gtd-lsp for the user. explain briefly what it does
