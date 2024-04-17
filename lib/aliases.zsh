#!/bin/false
# shellcheck shell=sh

builtin alias _='sudo'
builtin alias resource='source ~/.zshrc'
builtin alias reload='p10k reload'
builtin alias colours='for i in {0..255}; do print -Pn "%K{$i}  %k%F{$i}${(l:3::0:)i}%f " ${${(M)$((i%6)):#3}:+$'\n'}; done'
builtin alias commit-plasma="konsave -r profile && konsave -s profile -f && konsave -e profile -f -n profile -d \"$BASEDIR/\" && konsave -r profile"

builtin alias l='k -h'
builtin alias c='clear'
builtin alias x='exit'

builtin alias dc='docker-compose'
builtin alias ctop='docker run --rm -ti --volume /var/run/docker.sock:/var/run/docker.sock:ro quay.io/vektorlab/ctop:latest'

builtin alias g='git'
builtin alias ga='git add'
builtin alias gaa='git add -A'
builtin alias gd='git diff'
builtin alias gdca='git diff --cached'
builtin alias gp='git push'
builtin alias gp!='git push --force'
builtin alias gap='git add -p'
builtin alias gst='git status'
builtin alias gcm='git checkout main || git checkout master'
builtin alias gcd='git checkout develop'
builtin alias gco='git checkout'
builtin alias gcb='git checkout -b'
builtin alias grb='git rebase'
builtin alias grbi='git rebase -i'
builtin alias grba='git rebase --abort'
builtin alias grbc='git rebase --continue'
builtin alias grbd='git rebase develop'
builtin alias grbm='git rebase main'
builtin alias gl='git pull'
builtin alias gll='git log'
builtin alias gf='git fetch'
builtin alias gc='git commit'
builtin alias gcmsg='git commit --message'
builtin alias gc!='git commit --amend'
builtin alias gaa!='git add -A && git commit --amend'
builtin alias gbs='git bisect'
builtin alias gbsg='git bisect --good'
builtin alias gbsb='git bisect --bad'
builtin alias grh='git reset'
builtin alias grhh='git reset --hard'
