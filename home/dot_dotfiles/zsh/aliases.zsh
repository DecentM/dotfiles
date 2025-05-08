#!/bin/false
# shellcheck shell=sh

colours() {
    for i in {0..255}; do
        print -Pn "%K{$i}  %k%F{$i}${(l:3::0:)i}%f " ${${(M)$((i%6)):#3}:+$'\n'};
    done
}

list-usb-controllers() {
    for usb_ctrl in /sys/bus/pci/devices/*/usb*; do
        pci_path=${usb_ctrl%/*}
        iommu_group=$(readlink $pci_path/iommu_group)

        echo "Bus $(cat $usb_ctrl/busnum) --> ${pci_path##*/} (IOMMU group ${iommu_group##*/})"
        lsusb -s ${usb_ctrl#*/usb}:
        echo;
    done
}

list-iommu-groups() {
    for g in `find /sys/kernel/iommu_groups/* -maxdepth 0 -type d | sort -V`; do
        echo "IOMMU Group ${g##*/}:"

        for d in $g/devices/*; do
            echo -e "\t$(lspci -nns ${d##*/})"
        done

        echo
    done;
}

kdelf() {
    kubectl get "$1" -n "$2" "$3" -o=json | jq '.metadata.finalizers = null' | kubectl apply -f -
}

alias _='sudo'
alias resource='source ~/.zshrc'
alias reload='p10k reload'
alias update-asdf="asdf update && asdf plugin update --all"
alias fly='fly -t default'

alias l='k -h'
alias c='clear'
alias x='exit'

alias dc='docker compose'
alias ctop='docker run --rm -ti --volume /var/run/docker.sock:/var/run/docker.sock:ro quay.io/vektorlab/ctop:latest'

alias ku='kubectl'
alias kaf='kubectl apply -f'
alias kg='kubectl get'
alias kgew='kubectl get events --watch'
alias kga='kubectl get all'
alias kgn='kubectl get nodes'
alias kgs='kubectl get svc'
alias kdp='kubectl describe pod'
alias kds='kubectl describe svc'
alias kdel='kubectl delete'
alias kdelall='kubectl delete all --all'
alias kdelns='kubectl delete ns'
alias kl='kubectl logs'
alias klf='kubectl logs -f'
alias kex='kubectl exec -it'
alias kexsh='kubectl exec -it -- /bin/sh'
alias kexshpod='kubectl exec -it $(k get pods -o=name | grep $1) -- /bin/sh'

# Basic Aliases
alias g='git'
alias ga='git add'
alias gaa='git add -A'
alias gap='git add -p'
alias gst='git status'
alias gc='git commit'
alias gcmsg='git commit --message'
alias gc!='git commit --amend'
alias gaa!='git add -A && git commit --amend'
alias gf='git fetch'
alias gl='git pull'
alias gp='git push'
alias gp!='git push --force'
alias gll='git log'
alias gcl='git clean -fd'
alias gcln='git clean -fdx'

# Branch Management
alias gb='git branch'
alias gbr='git branch -m'
alias gbd='git branch -d'
alias gbD='git branch -D'
alias gcm='git checkout main || git checkout master'
alias gcd='git checkout develop'
alias gco='git checkout'
alias gcb='git checkout -b'

# Merge & Rebase
alias gm='git merge'
alias gmc='git merge --continue'
alias gma='git merge --abort'
alias grb='git rebase'
alias grbi='git rebase -i'
alias grba='git rebase --abort'
alias grbc='git rebase --continue'
alias grbd='git rebase develop'
alias grbm='git rebase main'
alias gmf='git merge --ff'
alias gmff='git merge --ff-only'

# Diff & Reset
alias gd='git diff'
alias gdca='git diff --cached'
alias grh='git reset'
alias grhh='git reset --hard'
alias grs='git reset'
alias grsh='git reset --soft'

# Stash Management
alias gss='git stash --save -u'
alias gsp='git stash pop'
alias gsl='git stash clear'
alias gssq='git stash push -m "$1"'
alias gsqa='git stash apply stash@{$1} && git stash drop stash@{$1}'

# Submodule Management
alias gsu='git submodule update --init --recursive'
alias gssu='git submodule foreach git pull origin master'

# Remote Management
alias grm='git remote -v'
alias grma='git remote add'
alias grmr='git remote remove'
alias grmu='git remote rename'

# Tag Management
alias gt='git tag'
alias gta='git tag -a'
alias gtp='git push --tags'
alias gtd='git tag -d'
alias gtD='git push origin :refs/tags/'

# Bisect & Blame
alias gbs='git bisect'
alias gbsg='git bisect good'
alias gbsb='git bisect bad'
alias gbm='git blame'

# Cherry-Pick
alias gcp='git cherry-pick'
alias gcpa='git cherry-pick --abort'
alias gcpc='git cherry-pick --continue'

# Reflog
alias grfl='git reflog'

# Git Ignore & Config
alias gignore='git config --global core.excludesfile'
alias gconfig='git config --global -e'
alias gcred='git config --global credential.helper store'

# GitHub Integration
alias gh='git open'
alias ghb='git open -b'
alias gclpr='git checkout -b $1 && git push origin $1 && gh pr create --fill'

# Shortcut for Commit Messages
alias gfix='git commit -m "fix:"'
alias gfeat='git commit -m "feat:"'
alias gdocs='git commit -m "docs:"'
alias gstyle='git commit -m "style:"'
alias grefactor='git commit -m "refactor:"'
alias gtest='git commit -m "test:"'
alias gchore='git commit -m "chore:"'

# Shortcuts for Tagging Versions
alias grel='git tag -a v$(date +%Y%m%d) -m "Release on $(date +%Y-%m-%d)"'
alias gver='git tag -a v$1 -m "Version $1"'

# Pull & Fetch with Rebase
alias gpf='git pull --rebase'
alias gplm='git pull origin main --rebase'
alias gpld='git pull origin develop --rebase'
