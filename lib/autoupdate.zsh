#!/bin/false
# shellcheck shell=sh

builtin set +e

LIBDIR=$(dirname $(realpath "$0"))
builtin cd "$LIBDIR/.."

git stash save -u 2>/dev/null >/dev/null

if [ $? -eq 0 ]; then
    git pull >/dev/null

    if [ $? -eq 0 ]; then
        git stash pop 2>/dev/null >/dev/null
    fi
fi

builtin cd - >/dev/null

builtin set -e
