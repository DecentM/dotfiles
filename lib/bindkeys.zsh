#!/bin/false
# shellcheck shell=sh

builtin bindkey "^[[1;5C" forward-word
builtin bindkey "^[[1;5D" backward-word
builtin bindkey "^[[H" beginning-of-line
builtin bindkey "^[[F" end-of-line
builtin bindkey "^[[3~" delete-char-or-list
