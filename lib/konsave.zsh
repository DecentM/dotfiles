#!/bin/false
# shellcheck shell=sh

if ! type "konsave" >/dev/null; then
    notify-send -u critical -t 15000 -a "DecentM/dotfiles" "konsave not found!" "Install 'konsave' to apply the theme."
else
    konsave -r profile >/dev/null
    konsave -i "$BASEDIR/profile.knsv" -f >/dev/null
    konsave -a profile >/dev/null
    konsave -r profile >/dev/null
fi
