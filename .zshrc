#!/bin/false
# shellcheck shell=sh

setopt LOCAL_OPTIONS NO_NOTIFY NO_MONITOR

path+=("$HOME/bin")
export PATH

DOTFILES_BASEDIR=$(dirname $(realpath "$0"))

source "$DOTFILES_BASEDIR/.dotfiles/lib/instant-prompt.zsh"
source "$DOTFILES_BASEDIR/.dotfiles/lib/utils.zsh"
source "$DOTFILES_BASEDIR/.dotfiles/lib/zplug.zsh"
source "$DOTFILES_BASEDIR/.dotfiles/lib/completion.zsh"
source "$DOTFILES_BASEDIR/.dotfiles/lib/aliases.zsh"
source "$DOTFILES_BASEDIR/.dotfiles/lib/bindkeys.zsh"
source "$DOTFILES_BASEDIR/.dotfiles/lib/asdf.zsh"
source "$DOTFILES_BASEDIR/.dotfiles/lib/zoxide.zsh"
source "$DOTFILES_BASEDIR/.dotfiles/lib/history.zsh"
source "$DOTFILES_BASEDIR/.dotfiles/lib/p10k.zsh"
