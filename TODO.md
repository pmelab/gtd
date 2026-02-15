replace environment variables with a file based hierarchical configuration
system. it should look for .gtdrc.json files in the current directory, parent
directories, $HOME and $XDG_HOME and merge them in this order of preference. use
an existing library if it exists.
