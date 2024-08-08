#!/bin/false
# shellcheck shell=sh

if vercmd zoxide; then
    eval "$(zoxide init zsh --cmd cd)"
fi
