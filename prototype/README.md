# PROTOTYPE: Battery Charging Quick Settings toggle

Throwaway code for [#11](https://github.com/StanleyGoldman/gnome-battery-charging-ext/issues/11)
(map [#2](https://github.com/StanleyGoldman/gnome-battery-charging-ext/issues/2)). It never merges.
The questions it answers, and its findings, live in the draft PR's description.

## What's here

| Path | What it is |
|---|---|
| `extension/` | An installable GNOME Shell extension (48–50): the toggle, its menu, and the top-bar icon on 50+. |
| `mock-upower.py` | A mock of UPower's charge-limit API on the **session** bus, with a stdin prompt (`help`) to add and remove batteries, flip the limit and inject failures or delays. |
| `pack.sh` | Builds the installable zip into `dist/`. |
| `smoke-test.sh` / `smoke-test.js` | A headless run (50+) against the mock: it clicks the toggle and opens the menu, writing screenshots to `smoke-out/`. No display or installs needed. |
| `variants.sh` | Screenshots #5's text variants (two columns, short title, truncate) headlessly into one comparison image. |
| `scenarios.sh` / `scenarios.js` | Headless runs of the #7 / #8 cases (refusals, slow replies, double clicks, several batteries, batteries and UPower coming and going), driving the mock through a FIFO. It prints a `SCENARIO` log and writes screenshots to `smoke-out/scenarios/`. |
| `scenario-sheet.py` | Crops the scenario screenshots into one labelled sheet (`sheet.png`). Needs Pillow. |
| `run-nested.sh` | Opens a nested GNOME Shell window to try the prototype by hand against the mock. Needs `sudo apt install mutter-dev-bin`. **Untested so far.** |
| `screenshots/` | Output of the smoke and variant runs on GNOME Shell 50.1. |

The extension uses the real system-bus UPower unless the shell starts with
`BATTERY_CHARGING_PROTO_BUS=session`, which both scripts set. Every state change is logged with
the prefix `[battery-charging]`.

## Running it

- **Headless (quickest):** `./smoke-test.sh`, then look in `smoke-out/`.
- **#7 / #8 scenarios, headless:** `./scenarios.sh && python3 scenario-sheet.py`.
- **Nested window, by hand:** `./run-nested.sh BAT0:enabled BAT1`. That terminal becomes the mock's
  prompt (try `fail BAT1`, `delay 3`, `remove BAT0`, `vanish`, `return`, `quit`).
- **Your real session, against your real battery:**
  ```sh
  gnome-extensions install --force "$(./pack.sh)"
  # Wayland: log out and back in so the shell discovers the new extension, then:
  gnome-extensions enable battery-charging-prototype@stanleygoldman.github.io
  journalctl --user -f -o cat /usr/bin/gnome-shell | grep battery-charging
  ```
  Remove it afterwards with `gnome-extensions uninstall battery-charging-prototype@stanleygoldman.github.io`.
