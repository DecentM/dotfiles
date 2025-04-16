#!/bin/false
# shellcheck shell=sh

if [[ ! -e "$HOME/.zplug" ]]; then
  curl -sL --proto-redir -all,https https://raw.githubusercontent.com/zplug/installer/master/installer.zsh | zsh
  echo "Reopen this shell to load plugins!"
else
  source "$HOME/.zplug/init.zsh"

  zplug romkatv/powerlevel10k, as:theme, depth:1
  zplug hlissner/zsh-autopair, defer:2
  zplug zimfw/asdf

  # Fuzzy stuff
  zplug supercrabtree/k
  zplug jgogstad/zsh-mask
  zplug Aloxaf/fzf-tab

  # SSH
  zplug hkupty/ssh-agent
  zstyle :omz:plugins:ssh-agent agent-forwarding on
  zstyle :omz:plugins:ssh-agent identities id_rsa id_rsa2 id_github id_ed25519
  zstyle :omz:plugins:ssh-agent lifetime 8h

  # Convenience
  zplug zsh-users/zsh-autosuggestions
  zplug zsh-users/zsh-completions
  zplug zsh-users/zsh-syntax-highlighting

  # Language support
  if vercmd python; then
    zplug cmuench/zsh-miniconda
    zplug MichaelAquilina/zsh-autoswitch-virtualenv
  fi

  # Install plugins if there are plugins that have not been installed
  if ! zplug check; then
    zplug install
  fi

  # Then, source plugins and add commands to $PATH
  zplug load
fi
