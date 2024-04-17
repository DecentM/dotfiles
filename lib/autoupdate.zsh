#!/bin/false
# shellcheck shell=sh

cd "$BASEDIR"

NEED_PULL=0

LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u})
BASE=$(git merge-base @ @{u})

if [ $LOCAL = $REMOTE ]; then
    git fetch origin 2>/dev/null >/dev/null &
elif [ $LOCAL = $BASE ]; then
    NEED_PULL=1
elif [ $REMOTE = $BASE ]; then
    echo "[DecentM/dotfiles] Your branch is ahead of its origin. Please cd to $BASEDIR and run 'git push'." >&2
else
    echo "[DecentM/dotfiles] Your branch has diverged from its origin. Please cd to $BASEDIR and resolve the conflict." >&2
fi

if [ $NEED_PULL -eq 1 ]; then
    clear
    read "REPLY?[DecentM/dotfiles] Your branch is behind its origin. Do you want to pull the latest changes? [y/N] "

    if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
        git stash save -u >/dev/null
        git reset --hard origin/$(git rev-parse --abbrev-ref HEAD) >/dev/null
        git stash pop >/dev/null

        if [ $? -ne 0 ]; then
            git checkout --ours . >/dev/null
            git add . >/dev/null
            git stash save -u "Conflicts saved by autoupdate.zsh" >/dev/null

            echo "[DecentM/dotfiles] Conflict detected during update, and the conflict has been saved. Please cd to $BASEDIR and resolve the conflict from the stash." >&2
        fi

        echo "[DecentM/dotfiles] Update complete, will take effect after shell restart"
    fi
fi

cd - >/dev/null
