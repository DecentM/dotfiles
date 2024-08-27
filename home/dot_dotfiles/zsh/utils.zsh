#!/bin/false
# shellcheck shell=sh

verlte() {
    [ "$1" = "$(echo -e "$1\n$2" | sort -V | head -n1)" ]
}

verlt() {
    [ "$1" = "$2" ] && return 1 || verlte $1 $2
}

vercmd() {
    # Set +e to avoid crashing the script if the command is not found
    local e_was_set=false

    if [[ $- == *e* ]]; then
        e_was_set=true
        set +e
    fi

    command -v "$1" >/dev/null
    local exitstatus=$?

    # Restore the errexit option
    if [ "$e_was_set" = true ]; then
        set -e
    fi

    return $exitstatus
}

glob_matches() {
    local dir="."
    [ $# -gt 1 ] && dir="$2"

    if [ ! -d "$dir" ]; then
        echo "Directory '$dir' does not exist or is not accessible." >&2
        return 2
    fi

    if find "$dir" -name "$1" -print -quit 2>/dev/null | grep -q -e .; then
        return 0
    else
        return 1
    fi
}
