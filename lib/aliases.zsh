#!/bin/false
# shellcheck shell=sh

alias _='sudo'
alias resource='source ~/.zshrc'
alias reload='p10k reload'
alias colours='for i in {0..255}; do print -Pn "%K{$i}  %k%F{$i}${(l:3::0:)i}%f " ${${(M)$((i%6)):#3}:+$'\n'}; done'
alias konsave-commit="konsave -s profile -f && konsave -e profile -f -n profile -d \"$BASEDIR/\" && konsave -r profile"
alias konsave-apply="konsave -i \"$BASEDIR/profile.knsv\" -f && konsave -a profile && konsave -r profile"
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
