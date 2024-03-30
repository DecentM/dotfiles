#!/bin/false
# shellcheck shell=sh

HISTFILE="$HOME/.zsh_history"
HISTSIZE=10000
SAVEHIST=10000

setopt appendhistory
setopt LOCAL_OPTIONS NO_NOTIFY NO_MONITOR

if [[ ! -e "$HOME/.zplug" ]]; then
  curl -sL --proto-redir -all,https https://raw.githubusercontent.com/zplug/installer/master/installer.zsh | zsh
  exit
fi

source ~/.zplug/init.zsh

path+=("$HOME/bin")
export PATH

export POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD=true
export POWERLEVEL9K_CONFIG_FILE="$HOME/.dotfiles/lib/p10k.zsh"

zplug romkatv/powerlevel10k, as:theme, depth:1
zplug "hlissner/zsh-autopair", defer:2
zplug zsh-users/zsh-autosuggestions
#zplug "djui/alias-tips"
zplug "lukechilds/zsh-nvm"
zplug tomsquest/nvm-auto-use.zsh
zplug wintermi/zsh-gcloud
zplug "supercrabtree/k"
zplug 'jgogstad/zsh-mask'

zplug hkupty/ssh-agent
zstyle :omz:plugins:ssh-agent agent-forwarding on
zstyle :omz:plugins:ssh-agent identities id_rsa id_rsa2 id_github id_ed25519
zstyle :omz:plugins:ssh-agent lifetime 8h

zplug joshskidmore/zsh-fzf-history-search
zplug zsh-users/zsh-syntax-highlighting
zplug cmuench/zsh-miniconda
zplug se-jaeger/zsh-activate-py-environment

# Colours
zplug zuxfoucault/colored-man-pages_mod
#zplug fdellwing/zsh-bat
zplug Freed-Wu/zsh-colorize-functions
zplug "zpm-zsh/colorize"
zplug Freed-Wu/zsh-help

# Install plugins if there are plugins that have not been installed
if ! zplug check; then
  zplug install
fi

# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

# Then, source plugins and add commands to $PATH
zplug load

BASEDIR=$(dirname $(realpath "$0"))

[[ ! -e $BASEDIR/lib/p10k.zsh ]] || source "$BASEDIR/lib/p10k.zsh"
[[ ! -e $BASEDIR/lib/aliases.zsh ]] || source "$BASEDIR/lib/aliases.zsh"
[[ ! -e $BASEDIR/lib/bindkeys.zsh ]] || source "$BASEDIR/lib/bindkeys.zsh"
[[ ! -e $BASEDIR/lib/autoupdate.zsh ]] || source "$BASEDIR/lib/autoupdate.zsh" &
