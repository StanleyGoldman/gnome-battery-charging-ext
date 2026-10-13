#!/usr/bin/env bash
# PROTOTYPE for issue #11: try the extension by hand in a nested GNOME Shell
# window (49+, needs `sudo apt install mutter-dev-bin` for --devkit), against the
# mock UPower. Uses a throwaway home so your real session and settings are untouched.
#
#   ./run-nested.sh [BATTERY[:flags] ...]     e.g. ./run-nested.sh BAT0:enabled BAT1
#
# This terminal becomes the mock's prompt: type `help`. The shell's log, including
# every "[battery-charging] state:" line, goes to $home/shell.log.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
home=$(mktemp -d -t battery-charging-proto.XXXXXX)
zip=$("$here/pack.sh" "$home")
uuid=battery-charging-prototype@stanleygoldman.github.io

export XDG_DATA_HOME=$home/data XDG_CONFIG_HOME=$home/config XDG_CACHE_HOME=$home/cache
export GSETTINGS_BACKEND=keyfile BATTERY_CHARGING_PROTO_BUS=session
mkdir -p "$XDG_CONFIG_HOME/glib-2.0/settings"
printf "[org/gnome/shell]\nenabled-extensions=['%s']\n" "$uuid" > "$XDG_CONFIG_HOME/glib-2.0/settings/keyfile"
gnome-extensions install --force "$zip"

echo "throwaway home: $home   shell log: $home/shell.log"
exec dbus-run-session -- bash -c '
    gnome-shell --devkit --wayland > "$1/shell.log" 2>&1 &
    python3 "$2/mock-upower.py" "${@:3}"
    kill %1 2>/dev/null || true
' _ "$home" "$here" "$@"
