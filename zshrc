#!/bin/false
# shellcheck shell=sh

setopt LOCAL_OPTIONS NO_NOTIFY NO_MONITOR

path+=("$HOME/bin")
export PATH

DOTFILES_BASEDIR=$(dirname $(realpath "$0"))

source "$DOTFILES_BASEDIR/lib/instant-prompt.zsh"
source "$DOTFILES_BASEDIR/lib/utils.zsh"
source "$DOTFILES_BASEDIR/lib/zplug.zsh"
source "$DOTFILES_BASEDIR/lib/completion.zsh"
source "$DOTFILES_BASEDIR/lib/aliases.zsh"
source "$DOTFILES_BASEDIR/lib/bindkeys.zsh"
source "$DOTFILES_BASEDIR/lib/asdf.zsh"
source "$DOTFILES_BASEDIR/lib/zoxide.zsh"
source "$DOTFILES_BASEDIR/lib/history.zsh"
source "$DOTFILES_BASEDIR/lib/p10k.zsh"
