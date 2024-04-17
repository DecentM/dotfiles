#!/bin/false
# shellcheck shell=sh

HISTFILE="$HOME/.zsh_history"
HISTSIZE=10000
SAVEHIST=10000

setopt appendhistory
setopt LOCAL_OPTIONS NO_NOTIFY NO_MONITOR

path+=("$HOME/bin")
export PATH

BASEDIR=$(dirname $(realpath "$0"))

[[ ! -e $BASEDIR/lib/zplug.zsh ]] || builtin source "$BASEDIR/lib/zplug.zsh"
[[ ! -e $BASEDIR/lib/asdf.zsh ]] || builtin source "$BASEDIR/lib/asdf.zsh"
[[ ! -e $BASEDIR/lib/p10k.zsh ]] || builtin source "$BASEDIR/lib/p10k.zsh"
[[ ! -e $BASEDIR/lib/aliases.zsh ]] || builtin source "$BASEDIR/lib/aliases.zsh"
[[ ! -e $BASEDIR/lib/bindkeys.zsh ]] || builtin source "$BASEDIR/lib/bindkeys.zsh"
[[ ! -e $BASEDIR/lib/autoupdate.zsh ]] || builtin source "$BASEDIR/lib/autoupdate.zsh"
