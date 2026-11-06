#!/usr/bin/env bash
# Lists the tools the make targets need that aren't installed, with the apt
# line, and the other commands, that install them. Never runs sudo itself.
set -euo pipefail

missing=()
# Tools apt doesn't carry: "name: install command".
others=()

have() { command -v "$1" >/dev/null 2>&1; }

have gjs || missing+=("gjs: gjs")
have gnome-extensions || missing+=("gnome-extensions: gnome-shell")
have xgettext || missing+=("xgettext: gettext")
python3 -c 'import gi' >/dev/null 2>&1 || missing+=("python3-gi: python3-gi")
# The integration tests check German strings borrowed from GNOME Settings.
[[ -e /usr/share/locale-langpack/de/LC_MESSAGES/gnome-control-center-2.0.mo \
    || -e /usr/share/locale/de/LC_MESSAGES/gnome-control-center-2.0.mo ]] \
    || missing+=("German GNOME language pack: language-pack-gnome-de")
# make lint, format and typos. npm installs ESLint and Prettier into node_modules.
have npm || missing+=("npm: npm")
have shellcheck || missing+=("shellcheck: shellcheck")
have shfmt || missing+=("shfmt: shfmt")
have ruff || others+=("ruff: uv tool install ruff")
have typos || others+=("typos: cargo install typos-cli")

if [[ ${#missing[@]} -eq 0 && ${#others[@]} -eq 0 ]]; then
    echo "All dependencies are installed."
    exit 0
fi

echo "Missing:"
packages=()
for entry in "${missing[@]}"; do
    echo "  ${entry%%: *} (package ${entry##*: })"
    packages+=("${entry##*: }")
done
for entry in "${others[@]}"; do
    echo "  ${entry%%: *}"
done
echo
echo "Install them with:"
[[ ${#packages[@]} -eq 0 ]] || echo "  sudo apt install ${packages[*]}"
for entry in "${others[@]}"; do
    echo "  ${entry##*: }"
done
exit 1
