#!/bin/false
# shellcheck shell=sh

if vercmd oh-my-posh; then
    eval "$(oh-my-posh --init --shell zsh --config ~/.dotfiles/theme.omp.json)"
else
    echo 'Please install oh-my-posh with "brew install jandedobbeleer/oh-my-posh/oh-my-posh"'
fi
