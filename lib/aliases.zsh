#!/bin/false
# shellcheck shell=sh

colours() {
    for i in {0..255}; do
        print -Pn "%K{$i}  %k%F{$i}${(l:3::0:)i}%f " ${${(M)$((i%6)):#3}:+$'\n'};
    done
}

alias _='sudo'
alias resource='source ~/.zshrc'
alias reload='p10k reload'
alias konsave-commit="mkdir -p $HOME/.config/konsave && cp -f $DOTFILES_BASEDIR/konsave.conf.yaml $HOME/.config/konsave/conf.yaml && rm -rf $DOTFILES_BASEDIR/profile && konsave -s profile && cp -a $HOME/.config/konsave/profiles/profile $DOTFILES_BASEDIR/profile && konsave -r profile"
alias konsave-apply="mkdir -p $HOME/.config/konsave/profiles && cp -a $DOTFILES_BASEDIR/profile $HOME/.config/konsave/profiles/profile && konsave -a profile && konsave -r profile"
alias update-asdf="asdf update && asdf plugin update --all"

alias l='k -h'
alias c='clear'
alias x='exit'

alias dc='docker-compose'
alias ctop='docker run --rm -ti --volume /var/run/docker.sock:/var/run/docker.sock:ro quay.io/vektorlab/ctop:latest'

alias g='git'
alias ga='git add'
alias gaa='git add -A'
alias gd='git diff'
alias gdca='git diff --cached'
alias gp='git push'
alias gp!='git push --force'
alias gap='git add -p'
alias gst='git status'
alias gcm='git checkout main || git checkout master'
alias gcd='git checkout develop'
alias gco='git checkout'
alias gcb='git checkout -b'
alias grb='git rebase'
alias grbi='git rebase -i'
alias grba='git rebase --abort'
alias grbc='git rebase --continue'
alias grbd='git rebase develop'
alias grbm='git rebase main'
alias gl='git pull'
alias gll='git log'
alias gf='git fetch'
alias gc='git commit'
alias gcmsg='git commit --message'
alias gc!='git commit --amend'
alias gaa!='git add -A && git commit --amend'
alias gbs='git bisect'
alias gbsg='git bisect --good'
alias gbsb='git bisect --bad'
alias grh='git reset'
alias grhh='git reset --hard'
