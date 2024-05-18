#!/bin/false
# shellcheck shell=sh

setopt LOCAL_OPTIONS NO_NOTIFY NO_MONITOR

path+=("$HOME/bin")
export PATH

DOTFILES_BASEDIR=$(dirname $(realpath "$0"))

[[ ! -e $DOTFILES_BASEDIR/lib/instant-prompt.zsh ]] || source "$DOTFILES_BASEDIR/lib/instant-prompt.zsh"

verlte() {
    [ "$1" = "$(echo -e "$1\n$2" | sort -V | head -n1)" ]
}

verlt() {
    [ "$1" = "$2" ] && return 1 || verlte $1 $2
}

[[ ! -e $DOTFILES_BASEDIR/lib/zplug.zsh ]] || source "$DOTFILES_BASEDIR/lib/zplug.zsh"
[[ ! -e $DOTFILES_BASEDIR/lib/completion.zsh ]] || source "$DOTFILES_BASEDIR/lib/completion.zsh"
[[ ! -e $DOTFILES_BASEDIR/lib/aliases.zsh ]] || source "$DOTFILES_BASEDIR/lib/aliases.zsh"
[[ ! -e $DOTFILES_BASEDIR/lib/autoupdate.zsh ]] || source "$DOTFILES_BASEDIR/lib/autoupdate.zsh"
[[ ! -e $DOTFILES_BASEDIR/lib/bindkeys.zsh ]] || source "$DOTFILES_BASEDIR/lib/bindkeys.zsh"
[[ ! -e $DOTFILES_BASEDIR/lib/asdf.zsh ]] || source "$DOTFILES_BASEDIR/lib/asdf.zsh"
[[ ! -e $DOTFILES_BASEDIR/lib/history.zsh ]] || source "$DOTFILES_BASEDIR/lib/history.zsh"
[[ ! -e $DOTFILES_BASEDIR/lib/p10k.zsh ]] || source "$DOTFILES_BASEDIR/lib/p10k.zsh"
