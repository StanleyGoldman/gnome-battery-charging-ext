#!/usr/bin/env bash
# PROTOTYPE for issue #11: build the installable zip.
#   ./pack.sh [OUT_DIR]     (default: ./dist)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=$(realpath -m "${1:-$here/dist}")
mkdir -p "$out"
gnome-extensions pack "$here/extension" --extra-source=icons --force --out-dir="$out"
echo "$out/battery-charging-prototype@stanleygoldman.github.io.shell-extension.zip"
