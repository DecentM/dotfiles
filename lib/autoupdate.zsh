#!/bin/false
# shellcheck shell=sh

LIBDIR=$(dirname $(realpath "$0"))
builtin cd "$LIBDIR/.."

NEED_PULL=0

LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u})
BASE=$(git merge-base @ @{u})

if [ $LOCAL = $REMOTE ]; then
    git fetch origin >/dev/null &
elif [ $LOCAL = $BASE ]; then
    NEED_PULL=1
elif [ $REMOTE = $BASE ]; then
    echo "[DecentM/dotfiles] Your branch is ahead of its origin. Please cd to $BASEDIR and run 'git push'." >&2
else
    echo "[DecentM/dotfiles] Your branch has diverged from its origin. Please cd to $BASEDIR and resolve the conflict." >&2
fi

if [ $NEED_PULL -eq 1 ]; then
    printf "[DecentM/dotfiles] Your branch is behind its origin. Do you want to pull the latest changes? [y/N] "
    read -r REPLY

    if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
        git stash save -u >/dev/null
        git reset --hard origin/$(git rev-parse --abbrev-ref HEAD) >/dev/null
        git stash pop >/dev/null

        resource

        echo "[DecentM/dotfiles] Update complete"
    fi
fi

builtin cd - >/dev/null
