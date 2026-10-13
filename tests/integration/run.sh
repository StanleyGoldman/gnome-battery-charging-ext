#!/usr/bin/env bash
# Runs the integration tests: a headless GNOME Shell (50+) with the packed extension,
# against the mock UPower, on a private session bus. Nothing touches the real session.
#
#   run.sh ZIP [OUT_DIR]     logs, and screenshots of failures, land in OUT_DIR
set -euo pipefail

# Headless shells share one Wayland display, so only one can run per user session.
# Queue behind any other run; the kernel drops the lock when this process exits.
exec 9>"${XDG_RUNTIME_DIR:-/tmp}/battery-charging-integration.lock"
flock 9

here=$(cd "$(dirname "$0")" && pwd)
zip=$(realpath "$1")
out=$(realpath -m "${2:-$here/out}")
rm -rf "$out"
mkdir -p "$out"
expected=6

export BATTERY_CHARGING_TEST_OUT=$out
timeout 180 dbus-run-session -- bash -c '
    here=$1 zip=$2 out=$3
    mkfifo "$out/mock.fifo"
    python3 -u "$here/mock-upower.py" --fifo "$out/mock.fifo" BAT0:enabled > "$out/mock.log" 2>&1 &
    mock=$!
    trap "kill $mock 2>/dev/null || true" EXIT
    sleep 1
    BATTERY_CHARGING_UPOWER_BUS=session \
    BATTERY_CHARGING_MOCK_FIFO="$out/mock.fifo" \
    BATTERY_CHARGING_MOCK_LOG="$out/mock.log" \
        gnome-shell-test-tool --headless --disable-animations --extension "$zip" \
        "$here/shell-test.js" > "$out/shell.log" 2>&1 || true
' _ "$here" "$zip" "$out" 2>/dev/null || true

grep -E "INTEGRATION|Gjs-CRITICAL|JS ERROR|already disposed" "$out/shell.log" || true

failed=0
passed=$(grep -c "INTEGRATION PASS" "$out/shell.log" || true)
grep -q "INTEGRATION FAIL" "$out/shell.log" && failed=1
grep -qE "Gjs-CRITICAL|already disposed" "$out/shell.log" && { echo "FAIL: the log has Gjs-CRITICAL lines"; failed=1; }
if [[ $passed -ne $expected ]]; then
    echo "FAIL: $passed of $expected tests passed (logs in $out)"
    failed=1
fi
[[ $failed -eq 0 ]] && echo "All $expected integration tests passed."
exit $failed
