#!/bin/false
# shellcheck shell=sh

# Oh-My-Posh with pre-cached init script for faster shell startup
# Cache is automatically regenerated when theme.omp.json changes

_omp_theme="$HOME/.dotfiles/theme.omp.json"
_omp_cache="$HOME/.cache/omp-init.zsh"

_omp_init() {
    if ! vercmd oh-my-posh; then
        curl -s https://ohmyposh.dev/install.sh | bash -s
        echo "oh-my-posh installed, reopen this shell to continue"
        return 1
    fi

    # Ensure cache directory exists
    mkdir -p "${_omp_cache:h}"

    # Regenerate cache if missing or theme is newer
    if [[ ! -f "$_omp_cache" ]] || [[ "$_omp_theme" -nt "$_omp_cache" ]]; then
        oh-my-posh init zsh --config "$_omp_theme" > "$_omp_cache"
    fi

    # Source the cached init script
    source "$_omp_cache"
}

_omp_init
unset -f _omp_init
