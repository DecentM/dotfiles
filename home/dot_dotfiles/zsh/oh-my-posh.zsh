#!/bin/false
# shellcheck shell=sh

if vercmd oh-my-posh; then
    eval "$(oh-my-posh --init --shell zsh --config ~/.dotfiles/theme.omp.json)"
else
    curl -s https://ohmyposh.dev/install.sh | bash -s
    echo "oh-my-posh installed, reopen this shell to continue"
fi
