# Testing in GNOME Shell

Lessons from the #11 prototype (PR #12, GNOME Shell 50.1 on Ubuntu). A working example is
`prototype/smoke-test.sh` and `smoke-test.js` on branch `prototype/quick-settings-toggle`.

## `gnome-shell-test-tool --headless --extension <zip> <script.js>` (50+)

It runs a private, invisible shell with the extension installed in a throwaway home, so the
user's session stays untouched. Its gotchas:

- **The `run()` hook can stall.** It only fires once `gnome-shell-perf-helper` registers on the
  bus, and headless that sometimes never happens; `startup-complete` didn't arrive either. Start
  the test from `run()` *or* a fallback `GLib.timeout_add_seconds` in `init()`, whichever comes
  first, and call `global.context.terminate()` when done.
- **It needs the metrics file.** After the shell exits the Python wrapper reads
  `$SHELL_PERF_OUTPUT` and needs the keys `events`, `monitors`, `metrics` and `log`. If you
  terminate early, write `{"events": [], "monitors": [], "metrics": [], "log": []}` there first.
  Otherwise the wrapper's traceback lands in `/var/crash` and the user sees a crash dialog. Tell
  the user and delete the report if one slips through.
- **Log with `console.log`.** Output from `print()` can be lost when the run is killed.
- Wrap runs in `timeout` and in `dbus-run-session`, and kill any background helpers (a mock
  service, `sleep infinity`) on exit.

## Mocking UPower

The shell talks to UPower on the system bus, which can't be faked safely. Give the extension a
switch to use the session bus instead (the prototype reads `BATTERY_CHARGING_PROTO_BUS=session`)
and run a mock that owns `org.freedesktop.UPower` there, inside the same `dbus-run-session`.

## Extension lifecycle

Hook cleanup to the actor's `destroy` signal, not a `destroy()` override: at shutdown the shell
destroys actors from C, which skips JS overrides and leaves D-Bus handlers calling into disposed
objects (`Gjs-CRITICAL ... has been already disposed`).
