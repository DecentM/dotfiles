#!/bin/false
# shellcheck shell=sh

# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

if [[ ! -e "$HOME/.zplug" ]]; then
  curl -sL --proto-redir -all,https https://raw.githubusercontent.com/zplug/installer/master/installer.zsh | zsh
  exit
fi

source "$HOME/.zplug/init.zsh"

zplug romkatv/powerlevel10k, as:theme, depth:1
zplug hlissner/zsh-autopair, defer:2
zplug zsh-users/zsh-autosuggestions
zplug zsh-users/zsh-completions
# zplug djui/alias-tips
zplug zimfw/asdf
zplug wintermi/zsh-gcloud
zplug supercrabtree/k
zplug jgogstad/zsh-mask

zplug hkupty/ssh-agent
zstyle :omz:plugins:ssh-agent agent-forwarding on
zstyle :omz:plugins:ssh-agent identities id_rsa id_rsa2 id_github id_ed25519
zstyle :omz:plugins:ssh-agent lifetime 8h

zplug Aloxaf/fzf-tab
# zplug joshskidmore/zsh-fzf-history-search
zplug zsh-users/zsh-syntax-highlighting
zplug cmuench/zsh-miniconda
zplug se-jaeger/zsh-activate-py-environment

# Colours
zplug zuxfoucault/colored-man-pages_mod
zplug Freed-Wu/zsh-colorize-functions
zplug zpm-zsh/colorize
zplug Freed-Wu/zsh-help

# Install plugins if there are plugins that have not been installed
if ! zplug check; then
  zplug install
fi

# Then, source plugins and add commands to $PATH
zplug load
