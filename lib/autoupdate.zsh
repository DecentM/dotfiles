#!/bin/false
# shellcheck shell=sh

LIBDIR=$(dirname $(realpath "$0"))

cd "$LIBDIR/.."

git stash save -u 2>/dev/null >/dev/null

git pull >/dev/null

git stash pop 2>/dev/null >/dev/null

cd - >/dev/null
