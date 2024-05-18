#!/bin/false
# shellcheck shell=sh

autoload -Uz compinit && compinit

zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'
zstyle ':completion:*' list-colors "${(s.:.)LS_COLORS}"

if command -v fzf >/dev/null && verlt '0.48.0' $(fzf --version); then
    zstyle ':completion:*' menu no
    zstyle ':fzf-tab:complete:cd:*' fzf-preview 'ls --color $realpath'

    eval "$(fzf --zsh)"
fi
