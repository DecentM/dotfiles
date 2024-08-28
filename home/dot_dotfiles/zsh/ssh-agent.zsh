#!/bin/false
# shellcheck shell=sh

# If ssh-agent is available, and we have keys, start it
if vercmd ssh-agent && [ "$(id -u)" -ne "0" ] && [ ! -z "$SSH_AUTH_SOCK" ]; then
    eval "$(ssh-agent -s)" >/dev/null

    if glob_matches "id_*" "$HOME/.ssh"; then
        ssh-add ~/.ssh/id_* >/dev/null
    fi

    export SSH_AGENT_SOCK="$SSH_AUTH_SOCK"
fi
