# Testing in GNOME Shell

Lessons from the #11 prototype (PR #12, GNOME Shell 50.1 on Ubuntu). The working harness is
`make test-integration`: `tests/integration/run.sh`, `shell-test.js` and `mock-upower.py`.

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
- **Call `global.context.terminate()` on every path**, including when `run()` fires. A run that
  never terminates leaves a headless `gnome-shell --automation-script` holding the Wayland display
  lock, and every later run then dies at "Failed to create_socket" with no tests logged. Look for
  it with `ps -eo pid,args | awk '/[a]utomation-script/'` and `kill -9` it. Don't `pkill -f` from
  the Bash tool: the pattern matches the tool's own command line.
- Wrap runs in `timeout` and in `dbus-run-session`, and kill any background helpers (a mock
  service, `sleep infinity`) on exit.

## Mocking UPower

The shell talks to UPower on the system bus, which can't be faked safely. Give the extension a
switch to use the session bus instead (`BATTERY_CHARGING_UPOWER_BUS=session`)
and run a mock that owns `org.freedesktop.UPower` there, inside the same `dbus-run-session`.

## Extension lifecycle

Hook cleanup to the actor's `destroy` signal, not a `destroy()` override: at shutdown the shell
destroys actors from C, which skips JS overrides and leaves D-Bus handlers calling into disposed
objects (`Gjs-CRITICAL ... has been already disposed`).

## The mock

`tests/integration/mock-upower.py --fifo PATH` takes its commands from a FIFO; `help` lists them.
The shell-side script writes to the FIFO and reads the mock's log (`EnableChargeThreshold(false)
on BAT0`) to see which calls arrived. `return` is a no-op while the mock still owns the name.

## Translations and parallel runs

- **`make test-integration` runs two shells**, one per language (the language is fixed at shell start): English for tests 1 to 6, `LANGUAGE=de` for test 7. Each writes `dist/integration/<pass>.log`.
- **A young headless shell is another session's live run** (the display-lock bullet above): wait for it, and kill only an old one. `ps -eo pid,etime,args | awk '/[a]utomation-script/'` shows the age.
- **`LANGUAGE` only works under a generated non-C locale**, so `run.sh` sets `LANG=en_US.UTF-8`.
- **`gnome-extensions pack --podir` is relative to the source directory** (`src`), so the Makefile passes `--podir=../po`.
