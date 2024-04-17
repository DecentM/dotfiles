#!/bin/false
# shellcheck shell=sh

eval "$(ssh-agent -s)" >/dev/null
ssh-add ~/.ssh/id_* >/dev/null
export SSH_AGENT_SOCK=$SSH_AUTH_SOCK

BASEDIR=$(dirname $(realpath "$0"))

builtin set +e

if ! type "konsave" >/dev/null; then
    notify-send -u critical -t 15000 -a "DecentM/dotfiles" "konsave not found!" "Install 'konsave' to apply the theme."
else
    konsave -r profile >/dev/null
    konsave -i "$BASEDIR/profile.knsv" -f >/dev/null
    konsave -a profile >/dev/null
    konsave -r profile >/dev/null
fi

builtin set -e
