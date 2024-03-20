#!/bin/false
# shellcheck shell=sh

eval "$(ssh-agent -s)" >/dev/null
ssh-add ~/.ssh/id_* >/dev/null
export SSH_AGENT_SOCK=$SSH_AUTH_SOCK
