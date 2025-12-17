#!/bin/false
# shellcheck shell=sh

add_plugins() {
    asdf plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git >/dev/null 2>/dev/null
    asdf plugin add yarn https://github.com/twuni/asdf-yarn.git >/dev/null 2>/dev/null
    asdf plugin add bun https://github.com/cometkim/asdf-bun.git >/dev/null 2>/dev/null
    asdf plugin add php https://github.com/asdf-community/asdf-php.git >/dev/null 2>/dev/null
    asdf plugin add pnpm https://github.com/jonathanmorley/asdf-pnpm.git >/dev/null 2>/dev/null
    asdf plugin add yt-dlp https://github.com/duhow/asdf-yt-dlp >/dev/null 2>/dev/null
    asdf plugin add dotnet https://github.com/hensou/asdf-dotnet.git >/dev/null 2>/dev/null
    asdf plugin add poetry https://github.com/asdf-community/asdf-poetry.git >/dev/null 2>/dev/null
    asdf plugin add deno https://github.com/asdf-community/asdf-deno.git >/dev/null 2>/dev/null
}

if vercmd asdf; then
    add_plugins

    # Read the existing contents of .asdfrc
    existing_asdfrc=$(cat "$HOME/.asdfrc")

    # Append the new configuration to the existing contents
    new_asdfrc="
legacy_version_file = yes
always_keep_download = no
"

    # Deduplicate by the part before " = "
    updated_asdfrc=$(echo "$new_asdfrc$existing_asdfrc" | awk -F " = " '!seen[$1]++')

    # Write the updated .asdfrc back to the file
    echo "$updated_asdfrc" >"$HOME/.asdfrc"
fi
