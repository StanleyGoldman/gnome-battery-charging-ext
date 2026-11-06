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
  it with `ps -eo pid,args | awk '/[a]utomation-script/'` and `kill -9` it once no `run.sh` is
  running. Don't `pkill -f` from the Bash tool: the pattern matches the tool's own command line.
- **Runs queue.** `run.sh` holds a `flock` on `$XDG_RUNTIME_DIR/battery-charging-integration.lock`
  for the whole run, so concurrent `make test-integration` runs wait their turn ("Waiting for
  another integration run..."), and a timed-out run's lock is free while its stuck shell lingers.
- Wrap runs in `timeout` and in `dbus-run-session`, and kill any background helpers (a mock
  service, `sleep infinity`) on exit.

## In a container (the CI image)

`.github/in-image.sh make test-integration` runs the tests in the CI image, as the workflow's
`integration` job does. A shell that aborts there is caught by the **host's** apport: the report
lands in the host's `/var/crash`, and its `ProcCmdline` names `/work/...`. Delete it after a
failed in-image run. What the shell needs in a container, and where each is provided:

- **`XDG_RUNTIME_DIR`**, for the Wayland socket. Without it: `XDG_RUNTIME_DIR is invalid or not
  set` then `Failed to create_socket`. `in-image.sh` mounts a private tmpfs at `/run/user/<uid>`.
- **A generated `en_US.UTF-8` locale**, for `run.sh`'s `LANG`. Without it: `Locale not understood
  by C library`, and `LANGUAGE=de` has no effect. The Dockerfile runs `locale-gen`.
- **A passwd entry for the caller's uid.** `in-image.sh` runs as the caller's uid, and
  `dbus-daemon` refuses an unknown one: `Could not get password database information for UID`,
  then `dbus-run-session: EOF reading address from bus daemon`. A local run as uid 1000 hides
  this, since the image's `ubuntu` user owns 1000; the GitHub runner is 1001. The image's
  entrypoint, `.github/entrypoint.sh`, adds the entry. To reproduce the runner, run the image
  with `--user 1001:1001` on a copy of the checkout it can write.
- **A system bus.** `/run/systemd/seats` exists in the image, so the shell assumes logind and
  opens the system bus synchronously at startup. Without one: `JS ERROR: Gio.IOErrorEnum: Could
  not connect` from `loginManager.js`, then `free(): invalid pointer` and a core dump. `run.sh`
  starts an empty private bus as `DBUS_SYSTEM_BUS_ADDRESS` when no system bus exists; the
  shell's calls on it fail softly (`ServiceUnknown` for login1, PolicyKit, GDM).

A pass whose bus fails to start leaves no `<pass>.log`, only `grep: ... No such file` and
`FAIL:  of 6`: `run.sh` sends `dbus-run-session`'s own stderr to `/dev/null`. Run
`dbus-run-session -- true` in the container to see why.

Harmless in the container's logs: no Xwayland, colord, AT-SPI bus, GeoClue or backgrounds.

## Locking the screen

`Main.screenShield.lock(false)` locks a headless shell: the session mode becomes `unlock-dialog`, and `Main.screenShield.deactivate(false)` unlocks it. `Main.sessionMode.pushMode('unlock-dialog')` / `popMode` switches the mode alone. On lock, the shell disables every extension whose `metadata.json` lacks `"session-modes": [..., "unlock-dialog"]` and re-enables it on unlock, so a lock test fails if that key goes missing. Read the extension's state with `Main.extensionManager.lookup(uuid).state` (`1` enabled, `2` disabled). Checked on GNOME Shell 50.1 (#74).

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
- **`LANGUAGE` only works under a generated non-C locale**, so `run.sh` sets `LANG=en_US.UTF-8`.
- **`gnome-extensions pack --podir` is relative to the source directory** (`src`), so the Makefile passes `--podir=../po`.
