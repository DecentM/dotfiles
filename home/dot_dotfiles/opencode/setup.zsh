#!/bin/false
# shellcheck shell=sh

OPENCODE_CONFIG_DIR="$DOTFILES_BASEDIR/opencode"
OPENCODE_PATH=$(which opencode)

alias pcode="OPENCODE_CONFIG_DIR=$OPENCODE_CONFIG_DIR OPENCODE_CONFIG=$OPENCODE_CONFIG_DIR/personal.jsonc $OPENCODE_PATH"
alias wcode="OPENCODE_CONFIG_DIR=$OPENCODE_CONFIG_DIR OPENCODE_CONFIG=$OPENCODE_CONFIG_DIR/work.jsonc $OPENCODE_PATH"

opencode () {
    echo "[dotfiles] Warn: You're starting opencode without a preset! Press enter to continue..." >&2
    read -n
    echo "Shutting down MCP servers..." >&2
    $OPENCODE_PATH
}
