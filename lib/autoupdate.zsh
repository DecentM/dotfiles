#!/bin/false
# shellcheck shell=sh

cd "$DOTFILES_BASEDIR"

NEED_PULL=0

if command -v git >/dev/null; then
    LOCAL=$(git rev-parse @)
    REMOTE=$(git rev-parse @{u})
    BASE=$(git merge-base @ @{u})

    if [ $LOCAL = $REMOTE ]; then
        git fetch origin 2>/dev/null >/dev/null &
    elif [ $LOCAL = $BASE ]; then
        NEED_PULL=1
    elif [ $REMOTE = $BASE ]; then
        echo "[DecentM/dotfiles] Your branch is ahead of its origin. Please cd to $DOTFILES_BASEDIR and run 'git push'." >&2
    else
        echo "[DecentM/dotfiles] Your branch has diverged from its origin. Please cd to $DOTFILES_BASEDIR and resolve the conflict." >&2
    fi

    if [ $NEED_PULL -eq 1 ]; then
        clear
        read "REPLY?[DecentM/dotfiles] Update to the latest commit? [y/N] "

        if [ "$REPLY" = "y" ] || [ "$REPLY" = "Y" ]; then
            git stash save -u -q 2>/dev/null >/dev/null
            git reset --hard origin/$(git rev-parse --abbrev-ref HEAD) >/dev/null
            STASH_RESULT=$(git stash pop 2>&1)

            if [ $? -ne 0 ] && [ $STASH_RESULT != "No stash entries found." ]; then
                git checkout --ours . 2>/dev/null >/dev/null
                git add . 2>/dev/null >/dev/null
                git stash save -u "Conflicts saved by autoupdate.zsh" -q 2>/dev/null >/dev/null

                echo "[DecentM/dotfiles] Conflict detected during update, and the conflict has been saved. Please cd to $DOTFILES_BASEDIR and resolve the conflict from the stash." >&2
            fi

            echo "[DecentM/dotfiles] Update complete, will take effect after shell restart"
        fi
    fi
fi

cd - >/dev/null
