#!/bin/false
# shellcheck shell=sh

if ! vercmd brew && [[ -d /home/linuxbrew/.linuxbrew ]]; then
    eval $(/home/linuxbrew/.linuxbrew/bin/brew shellenv)
fi
