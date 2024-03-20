#!/bin/false
# shellcheck shell=sh

HISTFILE="$HOME/.zsh_history"
HISTSIZE=10000
SAVEHIST=10000
setopt appendhistory

[[ -e "$HOME/.zplug" ]] || curl -sL --proto-redir -all,https https://raw.githubusercontent.com/zplug/installer/master/installer.zsh | zsh

source ~/.zplug/init.zsh

path+=("$HOME/bin")
export PATH

export POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD=true
export POWERLEVEL9K_CONFIG_FILE="$BASEDIR/p10k.zsh"

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

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -e $BASEDIR/p10k.zsh ]] || source $BASEDIR/p10k.zsh
[[ ! -e $BASEDIR/aliases.zsh ]] || source $BASEDIR/aliases.zsh
[[ ! -e $BASEDIR/bindkeys.zsh ]] || source $BASEDIR/bindkeys.zsh
