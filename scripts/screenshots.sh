#!/usr/bin/env bash
# Takes the README screenshots: a headless GNOME Shell (50+) with the packed extension,
# against the mock UPower, on a private session bus. Nothing touches the real session.
#
#   screenshots.sh ZIP OUT_DIR     PNGs land in OUT_DIR
set -euo pipefail

# Headless shells share one Wayland display; queue behind any integration run.
exec 9>"${XDG_RUNTIME_DIR:-/tmp}/battery-charging-integration.lock"
flock -n 9 || { echo "Waiting for another headless shell to finish..."; flock 9; }

here=$(cd "$(dirname "$0")" && pwd)
mock=$here/../tests/integration/mock-upower.py
zip=$(realpath "$1")
out=$(realpath -m "$2")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

timeout 180 dbus-run-session -- bash -c '
    here=$1 mock=$2 zip=$3 out=$4 work=$5
    mkfifo "$work/fifo"
    python3 -u "$mock" --fifo "$work/fifo" BAT0:enabled > "$work/mock.log" 2>&1 &
    pid=$!
    trap "kill $pid 2>/dev/null || true" EXIT
    sleep 1
    BATTERY_CHARGING_UPOWER_BUS=session \
    BATTERY_CHARGING_TEST_OUT="$out" \
    LANGUAGE=en LANG=en_US.UTF-8 \
        gnome-shell-test-tool --headless --disable-animations --extension "$zip" \
        "$here/screenshots.js" > "$work/shell.log" 2>&1 || true
' _ "$here" "$mock" "$zip" "$out" "$work" 9>&- 2>/dev/null || true

grep -E "SCREENSHOT|JS ERROR" "$work/shell.log" || true
grep -q "SCREENSHOTS DONE" "$work/shell.log" && ! grep -q "SCREENSHOT FAIL" "$work/shell.log"
