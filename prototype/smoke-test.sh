#!/usr/bin/env bash
# PROTOTYPE for issue #11: run the extension in a headless GNOME Shell (50+)
# against the mock UPower, on a private session bus. Nothing touches your real
# session: gnome-shell-test-tool installs the extension into a temporary home.
#
#   ./smoke-test.sh [OUT_DIR]     screenshots land in OUT_DIR (default: ./smoke-out)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=$(realpath -m "${1:-$here/smoke-out}")
mkdir -p "$out"

"$here/pack.sh" "$out" >/dev/null

BATTERY_CHARGING_PROTO_OUT=$out timeout 120 dbus-run-session -- bash -c '
    sleep infinity | python3 "$1/mock-upower.py" BAT0 > "$2/mock.log" 2>&1 &
    trap "pkill -P $$ sleep" EXIT
    sleep 1
    BATTERY_CHARGING_PROTO_BUS=session gnome-shell-test-tool --headless --disable-animations \
        --extension "$2/battery-charging-prototype@stanleygoldman.github.io.shell-extension.zip" \
        "$1/smoke-test.js" > "$2/shell.log" 2>&1 || true
    grep -E "SMOKE|battery-charging|Gjs-CRITICAL|JS ERROR" "$2/shell.log" || true
' _ "$here" "$out" 2>/dev/null
echo "--- mock log ($out/mock.log)"
cat "$out/mock.log"
