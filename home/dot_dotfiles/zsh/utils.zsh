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
