#!/bin/false
# shellcheck shell=sh

add_plugins() {
    asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git >/dev/null
    asdf plugin add yarn https://github.com/twuni/asdf-yarn.git >/dev/null
    asdf plugin add bun https://github.com/cometkim/asdf-bun.git >/dev/null
    asdf plugin add php https://github.com/asdf-community/asdf-php.git >/dev/null
    asdf plugin add pnpm https://github.com/jonathanmorley/asdf-pnpm.git >/dev/null
    asdf plugin add yt-dlp https://github.com/duhow/asdf-yt-dlp >/dev/null
}

add_plugins || true

# Make autoswitch use .nvmrc too
echo "legacy_version_file = yes" >"$HOME/.asdfrc"
