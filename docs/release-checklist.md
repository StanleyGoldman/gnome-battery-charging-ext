# Release checklist

The manual checks from [spec](spec.md) §8. The automated tests cover the logic and GNOME Shell 50 against a mock UPower. These checks cover what they can't: a real battery on the system bus, a real full charge, the notification banner's buttons, and the preferences window.

Copy this file's checklists into the release's PR or issue and tick them there.

## Before every release

- [ ] `make test` passes.
- [ ] `make test-integration` passes.
- [ ] `make pot` leaves `po/*.pot` unchanged apart from its `POT-Creation-Date` (otherwise commit the new template).

### The real battery

On the dev machine, with the extension installed by `make install` and nothing in the environment pointing it at the mock (`BATTERY_CHARGING_UPOWER_BUS` unset). Keep GNOME Settings' Power page open alongside.

- [ ] The toggle shows in Quick Settings. Its subtitle and lit state match Settings.
- [ ] Clicking the toggle switches the mode, with no password prompt. Settings follows.
- [ ] The menu: header "Battery Charging", the current mode ticked, "Power Settings" opens Settings' Power page.
- [ ] Picking the unticked mode in the menu switches. Picking the ticked one changes nothing visible.
- [ ] Switching in Settings moves the toggle at once, with its menu open too.
- [ ] The heart icon shows in the top bar while Preserve Battery Health is on, and not otherwise.
- [ ] Restarting UPower (`sudo systemctl restart upower`) hides the toggle briefly, then it returns in the right state.
- [ ] `gnome-extensions disable` then `enable`: the toggle goes and comes back. `journalctl --user -b | grep -iE 'battery-charging|Gjs-CRITICAL'` shows no errors.

### The Full-battery action

Same setup. Open the preferences with `gnome-extensions prefs battery-charging@stanleygoldman.github.io`.

- [ ] The window shows "When Fully Charged" (Do Nothing), the wait (30) and the re-notify interval (60). The re-notify row is greyed out unless Notify is chosen.
- [ ] Changed values are still there after closing and reopening the window.
- [ ] **Notify:** set the wait to 0 and the interval to 1, with the battery at 100 % and Maximize Charge on. A "Battery Fully Charged" banner appears. **Remind Me Later** brings it back about a minute later. **Preserve Battery Health** switches, and the toggle and Settings follow.
- [ ] **Switch automatically:** same setup, back in Maximize Charge at 100 %. It switches to Preserve Battery Health, and a "Switched to Preserve Battery Health" notification appears.
- [ ] Set "When Fully Charged" back to what it was, and the timings to their defaults.
- [ ] Leave the machine in the mode it started in.
