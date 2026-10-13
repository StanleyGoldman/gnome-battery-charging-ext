# Release checklist

The manual checks from spec §7. The automated tests cover the logic and GNOME Shell 50 against a mock UPower. These checks cover what they can't: a real battery on the system bus, and GNOME 48 and 49.

Copy this file's checklists into the release's PR or issue and tick them there.

## Before every release

- [ ] `make test` passes.
- [ ] `make test-integration` passes.
- [ ] `make pot` leaves `po/*.pot` unchanged apart from its `POT-Creation-Date` (otherwise commit the new template).
- [ ] `shell-version` in `src/metadata.json` lists only versions checked below. If the GNOME 48 / 49 checks weren't run for this release, it is `["50"]` (spec §2).

### The real battery

On the dev machine, with the extension installed by `make install` and nothing in the environment pointing it at the mock (`BATTERY_CHARGING_UPOWER_BUS` unset). Keep GNOME Settings' Power page open alongside.

- [ ] The toggle shows in Quick Settings. Its subtitle and lit state match Settings.
- [ ] Clicking the toggle switches the mode, with no password prompt. Settings follows.
- [ ] The menu: header "Battery Charging", the current mode ticked, "Power Settings" opens Settings' Power page.
- [ ] Picking the unticked mode in the menu switches. Picking the ticked one changes nothing visible.
- [ ] Switching in Settings moves the toggle at once, with its menu open too.
- [ ] GNOME 50: the heart icon shows in the top bar while Preserve Battery Health is on, and not otherwise.
- [ ] Restarting UPower (`sudo systemctl restart upower`) hides the toggle briefly, then it returns in the right state.
- [ ] `gnome-extensions disable` then `enable`: the toggle goes and comes back. `journalctl --user -b | grep -iE 'battery-charging|Gjs-CRITICAL'` shows no errors.
- [ ] Leave the machine in the mode it started in.

## GNOME 48 and 49

Run before the first release that claims 48 or 49, and again only when code that depends on the shell version changes (spec §2): today, `menuButtonAccessibleName` (49+) and the top-bar icon (50+) in `src/extension.js`.

| GNOME | VM |
|---|---|
| 48 | Fedora 42 Workstation |
| 49 | Fedora 43 Workstation |

A VM has no battery that supports a charge limit, so the toggle would stay hidden. Run the mock on the guest's session bus and point the shell at it:

1. Copy the zip from `make pack` and `tests/integration/mock-upower.py` into the VM.
2. `gnome-extensions install --force battery-charging@stanleygoldman.github.io.shell-extension.zip`
3. `mkdir -p ~/.config/environment.d && echo BATTERY_CHARGING_UPOWER_BUS=session > ~/.config/environment.d/battery-charging.conf`
4. Log out and back in.
5. `mkfifo /tmp/mock && python3 mock-upower.py --fifo /tmp/mock &` (it needs `python3-gobject`). Write commands with `echo <command> > /tmp/mock`; `help` lists them.
6. `gnome-extensions enable battery-charging@stanleygoldman.github.io`

Then, on each version:

- [ ] **Shown:** the toggle is in Quick Settings. `journalctl --user -b | grep -i battery-charging` shows no errors (on 48 especially, no complaint about `menu-button-accessible-name`).
- [ ] **Lit:** it matches the mock's state, and follows a change written through the FIFO.
- [ ] **Click switches:** clicking it flips the mode, and the mock logs `EnableChargeThreshold`.
- [ ] **Menu:** header, two items with the current one ticked, separator, "Power Settings".
- [ ] **No top-bar icon** on 48 or 49.
- [ ] **Disable / re-enable:** the toggle goes and comes back; the journal shows no `Gjs-CRITICAL` or "already disposed" lines.

Afterwards, remove `~/.config/environment.d/battery-charging.conf`. When both versions pass, set `shell-version` to `["48", "49", "50"]`.
