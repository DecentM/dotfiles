#!/bin/false
# shellcheck shell=sh

export OPENCODE_CONFIG_DIR="$DOTFILES_BASEDIR/opencode"

OPENCODE_PATH=$(which opencode)

alias pcode="OPENCODE_CONFIG=$OPENCODE_CONFIG_DIR/personal.jsonc $OPENCODE_PATH"
alias wcode="OPENCODE_CONFIG=$OPENCODE_CONFIG_DIR/work.jsonc $OPENCODE_PATH"

opencode () {
    printf "Error: Use either pcode or wcode for personal/work profiles\n" >&2
    return 1
}
