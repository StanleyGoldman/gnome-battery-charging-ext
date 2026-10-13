#!/usr/bin/env bash
# PROTOTYPE for issue #11: run the #7 / #8 scenarios in scenarios.js headlessly
# against the mock UPower, which takes its commands from a FIFO the test writes to.
#   ./scenarios.sh [OUT_DIR]     (default: ./smoke-out/scenarios)
# Prints the SCENARIO log; screenshots land in OUT_DIR.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=$(realpath -m "${1:-$here/smoke-out/scenarios}")
mkdir -p "$out"
rm -f "$out"/*.png "$out/mock.fifo"
mkfifo "$out/mock.fifo"

"$here/pack.sh" "$out" >/dev/null

BATTERY_CHARGING_PROTO_OUT=$out BATTERY_CHARGING_PROTO_MOCK_FIFO=$out/mock.fifo \
timeout 240 dbus-run-session -- bash -c '
    exec 3<>"$2/mock.fifo"   # held open read-write so the mock never sees EOF
    python3 "$1/mock-upower.py" BAT0 <&3 > "$2/mock.log" 2>&1 &
    sleep 1
    BATTERY_CHARGING_PROTO_BUS=session gnome-shell-test-tool --headless --disable-animations \
        --extension "$2/battery-charging-prototype@stanleygoldman.github.io.shell-extension.zip" \
        "$1/scenarios.js" > "$2/shell.log" 2>&1 || true
    kill %1 2>/dev/null || true
    grep -E "SCENARIO|Gjs-CRITICAL|JS ERROR" "$2/shell.log" | sed "s/.*SCENARIO/SCENARIO/" || true
' _ "$here" "$out" 2>/dev/null
rm -f "$out/mock.fifo"
