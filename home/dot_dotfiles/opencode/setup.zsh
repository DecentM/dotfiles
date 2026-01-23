#!/bin/false
# shellcheck shell=sh

if vercmd opencode; then
    OPENCODE_CONFIG_DIR="$DOTFILES_BASEDIR/opencode"
    OPENCODE_PATH=$(which opencode)

    if [ -f "$OPENCODE_CONFIG_DIR/.env" ]; then
        export $(cat "$OPENCODE_CONFIG_DIR/.env" | xargs)
    fi

    export AUDIT_DB_PATH="$HOME/.opencode/audit/db.sqlite"

    alias pcode="OPENCODE_CONFIG_DIR=$OPENCODE_CONFIG_DIR OPENCODE_CONFIG=$OPENCODE_CONFIG_DIR/profiles/personal.jsonc $OPENCODE_PATH"
    alias wcode="OPENCODE_CONFIG_DIR=$OPENCODE_CONFIG_DIR OPENCODE_CONFIG=$OPENCODE_CONFIG_DIR/profiles/work.jsonc $OPENCODE_PATH"

    opencode () {
        printf "[dotfiles] Warn: You're starting opencode without a preset! Press enter to continue or CTRL+C to cancel..." >&2
        read -n
        $OPENCODE_PATH "$@"
    }
fi
