#!/bin/false
# shellcheck shell=sh

function varhome_to_home_hook() {
    local current_dir="${PWD}"

    if [[ "$current_dir" == /var/home/* ]]; then
        local new_dir="${current_dir#/var/home/}"
        if [[ -n "$new_dir" ]]; then
            local target_dir="/home/$new_dir"

            if [[ -d "$target_dir" ]]; then
                cd "$target_dir" || return 1
            fi
        fi
    fi
}

autoload -U add-zsh-hook
# add-zsh-hook chpwd varhome_to_home_hook # on every cd

# only at startup
varhome_to_home_hook
