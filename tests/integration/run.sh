#!/usr/bin/env bash
# Runs the integration tests: a headless GNOME Shell (50+) with the packed extension,
# against the mock UPower, on a private session bus (and a private system bus where there's
# none, as in a container). Nothing touches the real session.
#
#   run.sh ZIP [OUT_DIR]     logs, and screenshots of failures, land in OUT_DIR
set -euo pipefail

# Headless shells share one Wayland display, so only one can run per user session.
# Queue behind any other run. The children don't inherit the lock, so the kernel drops it
# when this process exits.
exec 9>"${XDG_RUNTIME_DIR:-/tmp}/battery-charging-integration.lock"
flock -n 9 || {
    echo "Waiting for another integration run to finish..."
    flock 9
}

here=$(cd "$(dirname "$0")" && pwd)
zip=$(realpath "$1")
out=$(realpath -m "${2:-$here/out}")
rm -rf "$out"
mkdir -p "$out"

export BATTERY_CHARGING_TEST_OUT=$out

# The shell opens the system bus at startup and aborts without one, as in a container.
# There, give each pass a private bus as its system bus: an outer dbus-run-session,
# whose address becomes DBUS_SYSTEM_BUS_ADDRESS before the inner one replaces the
# session address. Only mock-gdm.py owns a name on it, so the shell builds its screen
# shield (test 12 locks); its calls to logind and the rest fail softly. With a real
# system bus, the prefix is empty.
system_bus=()
if [[ -z ${DBUS_SYSTEM_BUS_ADDRESS:-} && ! -S /run/dbus/system_bus_socket ]]; then
    # shellcheck disable=SC2016 # Expanded by the outer bus's shell.
    system_bus=(dbus-run-session -- bash -c '
        export DBUS_SYSTEM_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS
        python3 "$0/mock-gdm.py" "$DBUS_SYSTEM_BUS_ADDRESS" &
        gdm=$!
        trap "kill $gdm 2>/dev/null || true" EXIT
        gdbus wait --address "$DBUS_SYSTEM_BUS_ADDRESS" --timeout 10 org.gnome.DisplayManager
        "$@"
    ' "$here")
fi

# One shell per pass: the language is fixed when the shell starts.
#   run_pass NAME LANGUAGE   logs to OUT/NAME.log
run_pass() {
    local name=$1 language=$2
    # shellcheck disable=SC2016 # The inner script expands its own variables, from its arguments.
    timeout 180 "${system_bus[@]}" dbus-run-session -- bash -c '
        here=$1 zip=$2 out=$3 name=$4 language=$5
        mkfifo "$out/$name.fifo"
        python3 -u "$here/mock-upower.py" --fifo "$out/$name.fifo" BAT0:enabled > "$out/$name-mock.log" 2>&1 &
        mock=$!
        trap "kill $mock 2>/dev/null || true" EXIT
        sleep 1
        BATTERY_CHARGING_UPOWER_BUS=session \
        BATTERY_CHARGING_MINUTE_MS=1000 \
        BATTERY_CHARGING_MOCK_FIFO="$out/$name.fifo" \
        BATTERY_CHARGING_MOCK_LOG="$out/$name-mock.log" \
        BATTERY_CHARGING_TEST_PASS=$name \
        LANGUAGE=$language LANG=en_US.UTF-8 \
            gnome-shell-test-tool --headless --disable-animations --extension "$zip" \
            "$here/shell-test.js" > "$out/$name.log" 2>&1 || true
    ' _ "$here" "$zip" "$out" "$name" "$language" 9>&- 2>/dev/null || true
}

failed=0
#   check_pass NAME EXPECTED_TESTS
check_pass() {
    local name=$1 expected=$2 passed
    grep -E "INTEGRATION|Gjs-CRITICAL|JS ERROR|already disposed" "$out/$name.log" || true
    passed=$(grep -c "INTEGRATION PASS" "$out/$name.log" || true)
    grep -q "INTEGRATION FAIL" "$out/$name.log" && failed=1
    grep -qE "Gjs-CRITICAL|already disposed" "$out/$name.log" && {
        echo "FAIL: the $name log has Gjs-CRITICAL lines"
        failed=1
    }
    if [[ $passed -ne $expected ]]; then
        echo "FAIL: $passed of $expected $name tests passed (logs in $out)"
        failed=1
    fi
}

run_pass english en
run_pass german de
check_pass english 11
check_pass german 1
[[ $failed -eq 0 ]] && echo "All 12 integration tests passed."
exit $failed
