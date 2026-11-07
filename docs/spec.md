# Battery Charging: build spec

What to build. Each section ends with the issues that hold the reasoning; this file is the single source for *what*, and those threads are the record of *why*. Terms in **bold** are defined in [`CONTEXT.md`](../CONTEXT.md).

## 1. Overview

A GNOME Shell extension that switches **Battery Charging** between **Maximize Charge** and **Preserve Battery Health** from Quick Settings, modelled on the built-in Power Mode toggle. Its **Full-battery action** can also offer, or make, the switch to Preserve Battery Health once the battery has stayed **Full** for a while (§5).

- The Battery Charging state lives in UPower, on each battery device. GNOME Settings' Power page uses the same state, so the two always agree. The extension never stores it.
- The extension's own settings are the Full-battery action and its two timings (§5), kept in GSettings and edited in a preferences window. Quick Settings is unchanged by them.
- It keeps running on the lock screen, so the Full-battery action can fire while locked (§5, §9).
- It's for personal use, written to pass extensions.gnome.org review.
- Positioning is out of scope: the toggle and top-bar icon take the shell's default places through `addExternalIndicator()`. Users reorder them with an extension such as Quick Settings Tweaks.

Source: #2 (the map), #49 (the Full-battery action map).

## 2. Supported versions

- GNOME Shell 50 only: `shell-version: ["50"]`.
- UPower 1.90.6 or later (the version GNOME Settings requires).

Source: #4, #15, #54.

## 3. The control

**Structure.** Copy Power Mode's pattern from public APIs:
- A `QuickMenuToggle` held by a `SystemIndicator`, added with `Main.panel.statusArea.quickSettings.addExternalIndicator(indicator)`.
- `checked` comes from UPower state, not `toggleMode`. Lit means Preserve Battery Health.
- Clicking the toggle switches modes (§4).
- The menu: `menu.setHeader(icon, title)` with no subtitle, then a `PopupMenuSection` checklist of two `PopupImageMenuItem`s (the current mode gets `Ornament.CHECK`, the other `Ornament.NONE`), then a `PopupSeparatorMenuItem` and `menu.addSettingsAction(<"Power Settings">, 'gnome-power-panel.desktop')`.
- The indicator shows its top-bar icon while Preserve Battery Health is on, and none otherwise.

**Visibility.** The toggle (and the top-bar icon) is shown while at least one **supporting battery** exists, and hidden otherwise, with no error. The toggle is never hidden or greyed out because the session is inactive or remote. On the lock screen (`Main.sessionMode.currentMode == 'unlock-dialog'`) both are hidden; they come back on unlock.

**Icons.** Bundled symbolic SVGs (`*-symbolic.svg`, loaded with `Gio.FileIcon`; the shell recolours them like theme icons):
- A battery outline with a **heart**: Preserve Battery Health. It's also used for the menu header and the top-bar icon.
- A battery outline with a **lightning bolt**: Maximize Charge.
- Both are derived from Adwaita's `battery-symbolic` outline. They keep Adwaita's licence (LGPL-3.0 / CC-BY-SA-3.0), with an attribution line in the README.

**Text.** Only about 10 characters fit in a one-column toggle, so the toggle itself carries short labels and everything else uses Settings' full wording:

| Where | Maximize Charge | Preserve Battery Health |
|---|---|---|
| Toggle title | Battery | Battery |
| Toggle subtitle | Maximize | Preserve |
| Toggle accessible name | Battery Charging: Maximize Charge | Battery Charging: Preserve Battery Health |
| Menu header | Battery Charging | Battery Charging |
| Checklist items | Maximize Charge | Preserve Battery Health |
| Menu link | Power Settings | Power Settings |

The short labels are display text, not domain terms. §6 says where each string's translation comes from.

Source: #4, #5, #8, #62.

## 4. Behaviour

**Which batteries count.** A device is a **supporting battery** when `Type == 2` (Battery), `PowerSupply == true` and `ChargeThresholdSupported == true`.
- Peripheral batteries and batteries without support are ignored.
- The display device's `Type` is the only thing read from `DisplayDevice`, and only for this rule: `Type == 3` (UPS) means the machine has no supporting battery. It is read whenever devices are enumerated, at startup and each time UPower reappears. A display device that changes to or from UPS while UPower is running gets no reaction until the next enumeration.
- `ChargeThresholdSettingsSupported`, `ChargeStartThreshold` and `ChargeEndThreshold` are never read.
- Nothing else on `DisplayDevice` is read, and no method is ever called on it. In particular its `ChargeThreshold*` copies are ignored: UPower 1.90.10+ copies `ChargeThresholdEnabled` onto it while reporting `ChargeThresholdSupported = false`, and `EnableChargeThreshold` isn't wired up there.

**Reading state.**
- Lit, and the menu ticks Preserve Battery Health, when **any** supporting battery has `ChargeThresholdEnabled == true`. There is no third "mixed" state.
- React only to changes of `ChargeThreshold*`, `State` and `Percentage` on each battery (`g-properties-changed`) and to UPower's `DeviceAdded` / `DeviceRemoved`. `State` and `Percentage` feed **Full** (§5) only. Ignore every other property change; in particular the notices that touch only `UpdateTime` (about every 30 s) and rate updates.
- While UPower is missing, the toggle is hidden. When UPower reappears, the extension enumerates the devices again.
- Changes made elsewhere (GNOME Settings) show up at once, even with the menu open, except while a switch is in flight (see Switching): the display then keeps the latest click's target until its replies have all arrived.

**Writing state.** UPower is written only by a user's choice (a checklist click, the toggle, a notification button) or by the Full-battery action when its wait expires (§5). A change handler never writes; it only starts, keeps or cancels the wait. In particular, a battery that appears with a different setting is left as it is.

**Switching.**
- A switch calls `org.freedesktop.UPower.Device.EnableChargeThreshold(b)` asynchronously on **every** supporting battery.
- Polkit (`org.freedesktop.UPower.enable-charging-limit`) allows it without a prompt in the active local session, locked or not.
- Clicking the toggle switches away from what it shows: a lit toggle sets Maximize Charge on every battery.
- A checklist item always applies its mode to every supporting battery, even when that item is already ticked. That's how the user retries after a partial failure or brings a newly arrived battery into line.
- The switch is optimistic: the toggle shows the target mode at once, with no busy hint.
- The last click wins. A reply from a superseded click never changes the display, so there is no flicker. A refusal of a superseded click posts no notification. The toggle re-syncs from UPower when the latest click's replies have all arrived, and that re-sync is when a change made elsewhere during the switch appears.
- The Full-battery action's switches (§5) take this same path as a click on **Preserve Battery Health**, and take part in last-click-wins.

**Failures.**
- **Refused or failed switch:** the toggle snaps back to what UPower reports and posts a notification. The menu shows no error.
- **Notification text:** the title is "Could not change Battery Charging" and the body is "Switching to <mode> is not allowed." It never contains D-Bus error text, and it names no device when only one battery supports a limit, or when every supporting battery failed.
- **Partial failure:** batteries that switched stay switched, with no rollback. The body names each battery that failed by its UPower native path, e.g. "Switching to Preserve Battery Health is not allowed for one battery (BAT1)."
- **Battery gone mid-switch:** if a battery has disappeared by the time its reply arrives, its error is dropped. Errors from batteries that are still present are reported as usual.
- **Inactive or remote sessions:** refusals there take the same snap-back and notification path. There is no logind tracking.

Source: #3, #7, #8, #53, #56.

## 5. Full-battery action

**Settings.** One GSettings schema, `org.gnome.shell.extensions.battery-charging`, at path `/org/gnome/shell/extensions/battery-charging/`:

| Key | Type | Default | Range | Meaning |
|---|---|---|---|---|
| `full-battery-action` | enum, nicks `off` / `notify` / `switch` | `off` | | The **Full-battery action**: Off, Notify or Switch automatically |
| `full-wait` | `u`, minutes | 30 | 0–1440 | How long the battery stays Full before the action fires. Shared by Notify and Switch automatically. 0 acts as soon as it is Full. |
| `renotify-interval` | `u`, minutes | 60 | 0–1440 | Notify only: the time from one notification to the next. 0 notifies once, with no reminders. |

- Unset keys serve their defaults, so an upgraded install behaves as before (Off). There is no migration code, now or later: a key never changes its type or meaning; if one must, add a new key and leave the old one unread.
- The shell side follows changes through `changed::<key>`.

**Preferences window.** `prefs.js`, an `ExtensionPreferences` whose `fillPreferencesWindow(window)` adds one page and group:
- **"When Fully Charged"**: an `Adw.ComboRow` with **Do Nothing** / **Notify** / **Switch to Preserve Battery Health**. An enum key won't `bind()` to `selected`, so sync the row by hand or with `bind_with_mapping`.
- **The wait**: an `Adw.SpinRow` in minutes, 0–1440, step 5 (any whole number may be typed).
- **The re-notify interval**: an `Adw.SpinRow` in minutes, 0–1440, whose subtitle says 0 notifies once. It is insensitive unless the action is Notify.
- No reset button: `gsettings reset-recursively` covers it, and uninstall leaves the values in dconf, as for any extension.

**Full.** A supporting battery is **Full** when its charge limit is off (`ChargeThresholdEnabled == false`) and it reports `State == FullyCharged` (4), or `State == Charging` (1) with `Percentage >= 100`. This is GNOME Shell 50's "charged" battery-icon rule. "All Full" holds when every supporting battery is Full; with no supporting batteries (none present, or UPower gone) it is false. A battery with its limit on never counts, so the action is inert in Preserve Battery Health.

**The wait.**
- The wait runs while "all Full" holds. Any break cancels it, and when "all Full" holds again a fresh wait starts from zero.
- It starts when the extension first sees "all Full": at enable, when a change makes it true, and when the action changes from Off. UPower keeps no "full since" time.
- It runs on wall-clock time: the extension records the real time when "all Full" began, so time spent suspended counts. GLib's timers stop during suspend, so the extension checks the wall clock at least once a settings minute: on resume, if the wait has passed, the action fires within a minute; if the battery stopped being Full while suspended, UPower's re-read breaks the condition as usual.
- Changing `full-wait` mid-wait measures the time already spent Full against the new value; if it has already passed, the action fires at once. The same holds for `renotify-interval` against the time since the last notification.
- Batteries coming and going: only the condition matters. An added battery that isn't Full cancels the wait; a removal that leaves only Full batteries keeps it running or starts one.
- With the wait at 0, the action still runs from a zero-delay timer, never inside a change handler (§4 Writing state).

**One full charge.** The extension keeps an **acted or overridden** flag for the current full charge. It is set by a dismiss (Notify), by the automatic switch's attempt (Switch automatically), or by the user switching to Maximize Charge (from anywhere) while every supporting battery is already Full. While it is set, nothing more happens until "all Full" breaks, which clears it. Switching to Maximize Charge at a lower charge sets nothing, so the action still fires once the battery fills.

**Notify.**
- After the wait, post a notification on the extension's own `MessageTray.Source`: title "Battery Fully Charged", body "Switch to Preserve Battery Health to slow battery wear.", icon `battery-full-charged-symbolic`, `NORMAL` urgency, not transient.
- Buttons (`addAction`): **Preserve Battery Health** and **Remind Me Later**. Remind Me Later is left out when `renotify-interval` is 0.
- **Reminders:** while "all Full" holds and the flag is unset, the same notification comes back as a fresh banner every re-notify interval (`acknowledged = false`, or destroy with `REPLACED` and post anew), with no limit. There is only ever one entry in the list. Under Do Not Disturb the entry refreshes silently.
- **Dismiss** (✕, Clear all, Delete, or a body click; all report `DISMISSED`): sets the flag, so no reminders until the next full charge.
- **Remind Me Later:** the notification closes, and the next reminder comes one interval later.
- **Preserve Battery Health:** switches through §4's path. The limit turns on, "all Full" breaks, and the cycle ends. If the switch fails, §4's failure notification appears and the cycle carries on as if Remind Me Later had been clicked; with the interval at 0 the cycle ends.
- **Withdrawn:** the extension destroys the notification and ends the cycle when "all Full" breaks, when the action leaves Notify, or on `disable()`. Teardown passes `SOURCE_CLOSED` (or disconnects its handlers first), so it isn't read as a dismiss.

**Switch automatically.**
- After the wait, switch to Preserve Battery Health through §4's path and set the flag.
- On success, post an information notification on the extension's own source: title "Switched to Preserve Battery Health", no buttons, `NORMAL` urgency. It stays until the user dismisses it and isn't withdrawn on later changes. Undo is Quick Settings.
- On a refused or failed switch, §4's failure notification is posted instead, and nothing retries until the next full charge.
- A user click while the automatic switch is in flight supersedes it: the superseded switch posts no failure and doesn't set the flag; the click's own effect decides what follows.
- Changing the action away from Switch automatically cancels a pending wait. A switch already in flight finishes.

**Changing the action mid-charge.** Changing between Notify and Switch automatically clears the flag and keeps the time already spent Full: the new action fires when the wait is up, or at once if it already is. Changing from Off starts a fresh wait. Changing to Off cancels the wait and withdraws any Notify notification.

**Locking.** `metadata.json` declares `"session-modes": ["user", "unlock-dialog"]`, so the extension stays enabled while locked. The wait, the Notify cycle and the flag survive a lock, and the action fires while locked: Switch automatically switches (its notice is in the list after unlock), and Notify posts as usual, shown on the lock screen per the user's Lock Screen Notifications setting. Only the UI hides (§3). A real `disable()` (the user turns the extension off, logout, shell restart, update) tears down the wait, the notification and the flag, and nothing is persisted; the next `enable()` starts fresh.

Source: #50, #51, #52, #53, #54, #55, #56, #62.

## 6. Translations

The extension's own strings go through `_()` in its own gettext domain (`gettext-domain` in `metadata.json`). It ships no `.po` files yet. A translator adds `po/<lang>.po` later, with no code change.

**Borrowed strings.** These come from GNOME's catalogs via `Gettext.dgettext(domain, msgid)`, so the wording matches GNOME Settings in every language:

| String | Domain | msgid |
|---|---|---|
| Battery Charging | `gnome-control-center-2.0` | `Battery Charging` |
| Maximize Charge | `gnome-control-center-2.0` | `_Maximize Charge` |
| Preserve Battery Health | `gnome-control-center-2.0` | `Preserve Battery _Health` |
| Power Settings | `gnome-shell` | `Power Settings` |

- **Mnemonic stripping:** the two mode names carry Settings' mnemonic (keyboard-shortcut) underscore. Look them up with the underscore, then strip the mnemonic from the result in both forms translations use: a trailing `(_X)` (common in CJK) and an inline `_` (de: `Batterie_gesundheit erhalten`).
- **Fallback:** when a lookup misses, `dgettext` returns the English msgid, which reads correctly once stripped.

**Our strings**, through `_()`:
- The short labels "Battery", "Maximize" and "Preserve". Settings' own "Preserve" is a network-panel string meaning "keep", so it isn't reused.
- The composed strings. Each is a template of ours, with the borrowed names as placeholders and a translator comment:
  - the accessible name, `_('%s: %s')`;
  - the failure notification title, `_('Could not change %s')`;
  - the failure notification body, `_('Switching to %s is not allowed.')`, plus the partial-failure variant naming the batteries.
- The Full-battery action's strings (§5), none of which has a GNOME translation to borrow: "Battery Fully Charged", its body, "Remind Me Later", "Switched to Preserve Battery Health", and the prefs window's titles, options and subtitles. Strings in `prefs.js` use the `gettext` exported by `ExtensionPreferences`.
- `make pot` regenerates the template after these are added.

Source: #9, #54, #55.

## 7. Architecture

**Core.** Modules with no GNOME Shell imports, so they run under plain `gjs -m`. They own all of §4 and §5's logic and the string composition from §6.
- **Input: an injected UPower interface.** It lists batteries with their `ChargeThreshold*`, `State` and `Percentage`, reports added and removed batteries and changes, and switches one battery, returning a Promise.
- **Input: the translation functions** (`_` and a borrowed-string lookup), so the mnemonic stripping and the templates are unit-tested.
- **Input: the settings, as plain values** (the action, the wait and the interval) with a way to report changes. The core never touches `Gio.Settings`.
- **Input: a clock.** `now()` (wall-clock milliseconds) and a one-shot timer (start, cancel), as `UPowerClient` takes `newProxy`. Unit tests drive both by hand.
- **Output:** what the toggle shows (visible, lit, subtitle, accessible name), plus `changed` and `failed` signals. `failed` carries the finished notification title and body. For §5 it also says when to post, re-show and withdraw the Notify notification, and when to post the "Switched…" notice; the shell side reports a dismiss or a button back to the core.

**Shell code around the core** stays thin:
- **The UPower interface:**
  - D-Bus proxies for UPower and each battery.
  - The bus comes from `BATTERY_CHARGING_UPOWER_BUS`: `session` points the extension at the test mock; unset means the system bus.
- **The clock:** `GLib.get_real_time()` and `GLib.timeout_add`. `BATTERY_CHARGING_MINUTE_MS`, when set, is how many milliseconds a settings minute lasts (the integration tests set `1000`); unset means 60000.
- **Settings:** `this.getSettings()` and its `changed::` signals, passed to the core as plain values.
- **UI:** the `QuickMenuToggle` / `SystemIndicator` widgets, hidden in `unlock-dialog` mode (`Main.sessionMode` `updated`); the failure notification call; the extension's own `MessageTray.Source` for §5's notifications, built on demand and dropped when its `destroy` signal fires.
- **Translation:** `dgettext` / `_()`.
- **Preferences:** `prefs.js` (§5), in its own process; it shares nothing with the shell side but the schema.
- **Lifecycle:**
  - `enable()` builds everything, and `disable()` destroys the indicator, the source (with `SOURCE_CLOSED`) and the timer.
  - `disable()` carries the comment extensions.gnome.org review requires for `unlock-dialog`: the extension runs on the lock screen so the Full-battery action can fire while locked and its per-charge state survives a lock.
  - Cleanup (disconnecting signals, dropping proxies) hangs off the actor's `destroy` signal. A `destroy()` override isn't enough: at shutdown the shell destroys actors from C and skips JS overrides.

Source: #11 (prototype), #15, #51, #52, #56, #62, #74.

## 8. Testing

Three layers. See `docs/agents/gnome-shell-testing.md` before running a headless shell.

1. **Unit tests, written test-first (TDD).**
   - They cover the core under `gjs -m`, using a small homemade runner (no GJS test framework is packaged).
   - A fake UPower interface resolves or rejects replies by hand, in any order.
   - `UPowerClient` takes a `newProxy` factory, so `upower.test.js` resolves D-Bus proxies by hand and covers its races: a device removed, or UPower restarted, while a proxy loads, and destroy mid-load.
   - A fake clock (`now()` and the timer) is advanced by hand.
   - The schema compiles with `glib-compile-schemas --strict --dry-run`, and a test checks each key's default and range.
   - This layer is the only one that covers several batteries, the mixed state, last-click-wins, partial failure, vanished batteries, mnemonic stripping and the composed messages. For §5 it is the only one that covers: Full reached as `Charging` at 100 %, `UpdateTime`-only notices ignored, the wait's exact expiry and reset, a wall-clock jump after suspend, a timing changed mid-wait, a body click, a failed switch, a click superseding the automatic switch, and a change of action mid-charge keeping the time spent Full.
2. **Headless integration tests** with `gnome-shell-test-tool --headless --extension`, against a session-bus UPower mock.
   - They assert on the toggle's actual properties. Screenshots are saved on failure only.
   - Tests 8–12 set `BATTERY_CHARGING_MINUTE_MS=1000` and change keys through `Gio.Settings`. They act on notifications through the objects, never the banner actors: find the extension's source in `Main.messageTray.getSources()`, read title, urgency and action labels, call an action's callback, and `destroy(DISMISSED)` for ✕. "Shown again" is read from the object (`acknowledged` reset, or replaced).
   - The twelve tests:
     1. **Appears and shows state:** shown, lit, subtitle "Preserve", heart icon in the top bar, menu ticked.
     2. **A click switches:** it calls `EnableChargeThreshold(false)` on the mock, and the toggle follows.
     3. **External change:** a change made on the mock (as GNOME Settings would make it) is followed.
     4. **Refusal:** the toggle snaps back and the notification with the expected title is posted.
     5. **UPower goes away and returns:** the toggle hides, then comes back in the right state.
     6. **Clean disable:** after disable and re-enable, the log has no `Gjs-CRITICAL` / "already disposed" lines.
     7. **Translations:** under `LANGUAGE=de`, with the German GNOME language pack installed, the menu header reads "Batterieladung".
     8. **Off by default:** the battery stays Full past the wait; no notification, and the mock logs no write.
     9. **Notify and its buttons:** after the wait, "Battery Fully Charged" appears, `NORMAL`, with **Preserve Battery Health** / **Remind Me Later**. Remind Me Later shows it again after the interval. Preserve Battery Health logs `EnableChargeThreshold(true)`, the toggle reads Preserve, and the notification is withdrawn.
     10. **Notify dismissed, then a new full charge:** after ✕, no reminder once the interval has passed. The battery leaves Full and becomes Full again, and the notification returns after the wait.
     11. **Switch automatically:** after the wait, `EnableChargeThreshold(true)` is logged, the toggle reads Preserve, and the button-less "Switched to Preserve Battery Health" notice is posted.
     12. **Survives a lock:** Switch automatically with a short wait and the battery Full, then `Main.screenShield.lock(false)`. The extension stays enabled, the toggle is hidden, the wait expires while locked, and `EnableChargeThreshold(true)` is logged. After `Main.screenShield.deactivate(false)` the toggle is back and reads Preserve.
3. **Manual checks**, on the dev machine's real battery and system bus, before each release: [`docs/release-checklist.md`](release-checklist.md). They cover what the mock can't: the real battery, a real full charge, the banner's buttons, and the prefs window.

**Layout.**
- `tests/unit/*.test.js`
- `tests/integration/`: the shell-side test script, the mock and a wrapper that runs under `dbus-run-session` and `timeout`.
- The mock is `mock-upower.py`. It models the charge-limit API, failures, delays and UPower going away and returning, plus each battery's `State` and `Percentage` and change notices that touch only `UpdateTime`. Integration tests drive it through its FIFO.

CI runs `make ci`'s checks on every pull request; see the README.

Source: #15, #74.

## 9. Build and packaging

**Metadata.**
- `uuid`: `battery-charging@stanleygoldman.github.io`
- `name`: "Battery Charging"
- `description`: also mentions the Full-battery action.
- `shell-version`: per §2
- `gettext-domain`: the uuid
- `settings-schema`: `org.gnome.shell.extensions.battery-charging`
- `session-modes`: `["user", "unlock-dialog"]`, justified in `disable()`'s comment (§7)
- `url`: the GitHub repo

**Schema.** `src/schemas/org.gnome.shell.extensions.battery-charging.gschema.xml`. `gnome-extensions pack` picks it up uncompiled; `gnome-extensions install` (and extensions.gnome.org, and `gnome-shell-test-tool`) compile it on install, so `gschemas.compiled` is never committed or shipped. `prefs.js` at the top of `src/` is packed automatically.

**Makefile targets.**

| Target | What it does |
|---|---|
| `make test` | Runs the unit tests and the schema's `--strict` dry-run compile. Fast. |
| `make test-integration` | Packs the extension, then runs the twelve headless tests. |
| `make pot` | Regenerates `po/<uuid>.pot` from `_()` strings only. `xgettext`'s JavaScript mode extracts `dgettext` calls by default, so reset the keywords: `xgettext -k --keyword=_ --keyword=C_:1c,2 --keyword=ngettext:1,2`. The `.pot` is committed. |
| `make pack` | `gnome-extensions pack` with `--podir=po`, the icons and any extra sources. The schema is a dependency of the zip, so editing it rebuilds. |
| `make install` | Installs the packed zip for the current user. |
| `make uninstall` | Uninstalls the extension for the current user. |
| `make check-deps` | Lists missing tools (`gjs`, `xgettext` from `gettext`, `glib-compile-schemas`, `python3-gi`, the German GNOME language pack) and the `apt` line that installs them. It never runs `sudo` itself. |

The README lists the CI targets.

**README.** It covers what the extension does (including the Full-battery action and where to set it), installing it, the `make` targets, where translators put a `.po` file, and the icon attribution.

Source: #5, #9, #15, #51, #62.

## 10. Out of scope

- Positioning or reordering the toggle and icon (§1).
- Settings beyond the Full-battery action and its timings (§5), and any Full-battery control in Quick Settings.
- Charge thresholds as numbers: the extension switches the mode only.
- Automatically aligning a newly arrived battery with the others (§4).
- Error states inside the toggle's menu; failures go to notifications (§4).
- Remembering the Full-battery action's per-charge state across a real disable (§5).
