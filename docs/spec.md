# Battery Charging: build spec

What to build. Each section ends with the issues that hold the reasoning; this file is the single source for *what*, and those threads are the record of *why*. Terms in **bold** are defined in [`CONTEXT.md`](../CONTEXT.md).

## 1. Overview

A GNOME Shell extension that switches **Battery Charging** between **Maximize Charge** and **Preserve Battery Health** from Quick Settings, modelled on the built-in Power Mode toggle.

- The state lives in UPower, on each battery device. GNOME Settings' Power page uses the same state, so the two always agree. The extension stores no setting of its own and has no preferences window.
- It's for personal use, written to pass extensions.gnome.org review.
- Positioning is out of scope: the toggle and top-bar icon take the shell's default places through `addExternalIndicator()`. Users reorder them with an extension such as Quick Settings Tweaks.

Source: #2 (the map).

## 2. Supported versions

- GNOME Shell 48, 49 and 50 from one codebase: `shell-version: ["48", "49", "50"]`.
- The one API break: `menuButtonAccessibleName` (construct property `menu-button-accessible-name`) exists only from 49. On 48, GJS throws on unknown construct properties, so set it only when the property exists.
- The top-bar icon exists on 50 and later only, matching Power Mode.
- UPower 1.90.6 or later (the version GNOME Settings requires).
- If the manual 48/49 check (§7) hasn't been run for a release, that release declares `["50"]` instead.

Source: #4, #15.

## 3. The control

**Structure.** Copy Power Mode's pattern from public APIs:
- A `QuickMenuToggle` held by a `SystemIndicator`, added with `Main.panel.statusArea.quickSettings.addExternalIndicator(indicator)`.
- `checked` comes from UPower state, not `toggleMode`. Lit means Preserve Battery Health.
- Clicking the toggle switches modes (§4).
- The menu: `menu.setHeader(icon, title)` with no subtitle, then a `PopupMenuSection` checklist of two `PopupImageMenuItem`s (the current mode gets `Ornament.CHECK`, the other `Ornament.NONE`), then a `PopupSeparatorMenuItem` and `menu.addSettingsAction(<"Power Settings">, 'gnome-power-panel.desktop')`.
- On 50+, the indicator shows its top-bar icon while Preserve Battery Health is on, and none otherwise. On 48 and 49 there is no top-bar icon.

**Visibility.** The toggle (and the top-bar icon) is shown while at least one **supporting battery** exists, and hidden otherwise, with no error. The toggle is never hidden or greyed out because the session is inactive or remote.

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

The short labels are display text, not domain terms. §5 says where each string's translation comes from.

Source: #4, #5, #8.

## 4. Behaviour

**Which batteries count.** A device is a **supporting battery** when `Type == 2` (Battery), `PowerSupply == true` and `ChargeThresholdSupported == true`.
- Peripheral batteries and batteries without support are ignored.
- The display device's `Type` is the only thing read from `DisplayDevice`, and only for this rule: `Type == 3` (UPS) means the machine has no supporting battery. It is read whenever devices are enumerated, at startup and each time UPower reappears. A display device that changes to or from UPS while UPower is running gets no reaction until the next enumeration.
- `ChargeThresholdSettingsSupported`, `ChargeStartThreshold` and `ChargeEndThreshold` are never read.
- Nothing else on `DisplayDevice` is read, and no method is ever called on it. In particular its `ChargeThreshold*` copies are ignored: UPower 1.90.10+ copies `ChargeThresholdEnabled` onto it while reporting `ChargeThresholdSupported = false`, and `EnableChargeThreshold` isn't wired up there.

**Reading state.**
- Lit, and the menu ticks Preserve Battery Health, when **any** supporting battery has `ChargeThresholdEnabled == true`. There is no third "mixed" state.
- React only to `ChargeThreshold*` property changes on each battery (`g-properties-changed`) and to UPower's `DeviceAdded` / `DeviceRemoved`. Ignore every other property change; percentage and rate updates arrive constantly.
- While UPower is missing, the toggle is hidden. When UPower reappears, the extension enumerates the devices again.
- Changes made elsewhere (GNOME Settings) show up at once, even with the menu open, except while a switch is in flight (see §4 Switching): the display then keeps the latest click's target until its replies have all arrived.
- Never write to UPower from a change handler. In particular, a battery that appears with a different setting is left as it is.

**Switching.**
- A switch calls `org.freedesktop.UPower.Device.EnableChargeThreshold(b)` asynchronously on **every** supporting battery.
- Polkit (`org.freedesktop.UPower.enable-charging-limit`) allows it without a prompt in the active local session.
- Clicking the toggle switches away from what it shows: a lit toggle sets Maximize Charge on every battery.
- A checklist item always applies its mode to every supporting battery, even when that item is already ticked. That's how the user retries after a partial failure or brings a newly arrived battery into line.
- The switch is optimistic: the toggle shows the target mode at once, with no busy hint.
- The last click wins. A reply from a superseded click never changes the display, so there is no flicker. A refusal of a superseded click posts no notification. The toggle re-syncs from UPower when the latest click's replies have all arrived, and that re-sync is when a change made elsewhere during the switch appears.

**Failures.**
- **Refused or failed switch:** the toggle snaps back to what UPower reports and posts a notification. The menu shows no error.
- **Notification text:** the title is "Could not change Battery Charging" and the body is "Switching to <mode> is not allowed." It never contains D-Bus error text, and it names no device when only one battery supports a limit, or when every supporting battery failed.
- **Partial failure:** batteries that switched stay switched, with no rollback. The body names each battery that failed by its UPower native path, e.g. "Switching to Preserve Battery Health is not allowed for one battery (BAT1)."
- **Battery gone mid-switch:** if a battery has disappeared by the time its reply arrives, its error is dropped. Errors from batteries that are still present are reported as usual.
- **Inactive or remote sessions:** refusals there take the same snap-back and notification path. There is no logind tracking.

Source: #3, #7, #8.

## 5. Translations

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
  - the notification title, `_('Could not change %s')`;
  - the notification body, `_('Switching to %s is not allowed.')`, plus the partial-failure variant naming the batteries.

Source: #9.

## 6. Architecture

**Core.** A model object in a module with no GNOME Shell imports, so it runs under plain `gjs -m`. It owns all of §4 and the string composition from §5.
- **Input: an injected UPower interface.** It lists batteries with their `ChargeThreshold*` state, reports added and removed batteries and state changes, and switches one battery, returning a Promise.
- **Input: the translation functions** (`_` and a borrowed-string lookup), so the mnemonic stripping and the templates are unit-tested.
- **Output:** what the toggle shows (visible, lit, subtitle, accessible name), plus `changed` and `failed` signals. `failed` carries the finished notification title and body.

**Shell code around the core** stays thin:
- **The UPower interface:**
  - D-Bus proxies for UPower and each battery.
  - The bus comes from `BATTERY_CHARGING_UPOWER_BUS`: `session` points the extension at the test mock; unset means the system bus.
- **UI:** the `QuickMenuToggle` / `SystemIndicator` widgets and the notification call.
- **Translation:** `dgettext` / `_()`.
- **Lifecycle:**
  - `enable()` builds everything, and `disable()` destroys the indicator.
  - Cleanup (disconnecting signals, dropping proxies) hangs off the actor's `destroy` signal. A `destroy()` override isn't enough: at shutdown the shell destroys actors from C and skips JS overrides.

Source: #11 (prototype), #15.

## 7. Testing

Three layers. See `docs/agents/gnome-shell-testing.md` before running a headless shell.

1. **Unit tests, written test-first (TDD).**
   - They cover the core under `gjs -m`, using a small homemade runner (no GJS test framework is packaged).
   - A fake UPower interface resolves or rejects replies by hand, in any order.
   - This layer is the only one that covers several batteries, the mixed state, last-click-wins, partial failure, vanished batteries, mnemonic stripping and the composed messages.
2. **Headless integration tests** with `gnome-shell-test-tool --headless --extension` (50), against a session-bus UPower mock.
   - They assert on the toggle's actual properties. Screenshots are saved on failure only.
   - The seven tests:
     1. **Appears and shows state:** shown, lit, subtitle "Preserve", heart icon in the top bar, menu ticked.
     2. **A click switches:** it calls `EnableChargeThreshold(false)` on the mock, and the toggle follows.
     3. **External change:** a change made on the mock (as GNOME Settings would make it) is followed.
     4. **Refusal:** the toggle snaps back and the notification with the expected title is posted.
     5. **UPower goes away and returns:** the toggle hides, then comes back in the right state.
     6. **Clean disable:** after disable and re-enable, the log has no `Gjs-CRITICAL` / "already disposed" lines.
     7. **Translations:** under `LANGUAGE=de`, with the German GNOME language pack installed, the menu header reads "Batterieladung".
3. **Manual checks.**
   - On the dev machine's real battery and system bus, before each release.
   - On GNOME 48 and 49, in Fedora 42 and Fedora 43 VMs: shown, lit, click switches, menu, disable / re-enable. Run them before the first release, and again only when code that depends on the version changes (§2).

**Layout.**
- `tests/unit/*.test.js`
- `tests/integration/`: the shell-side test script, the mock and a wrapper that runs under `dbus-run-session` and `timeout`.
- The mock is the prototype's `mock-upower.py`, carried over from branch `prototype/quick-settings-toggle`. It models the charge-limit API, failures, delays and UPower going away and returning. Integration tests drive it through its FIFO.

There is no CI. Everything runs locally.

Source: #15.

## 8. Build and packaging

**Metadata.**
- `uuid`: `battery-charging@stanleygoldman.github.io`
- `name`: "Battery Charging"
- `shell-version`: per §2
- `gettext-domain`: the uuid
- `url`: the GitHub repo
- No `settings-schema`

**Makefile targets.**

| Target | What it does |
|---|---|
| `make test` | Runs the unit tests. Fast. |
| `make test-integration` | Packs the extension, then runs the seven headless tests. |
| `make pot` | Regenerates `po/<uuid>.pot` from `_()` strings only. `xgettext`'s JavaScript mode extracts `dgettext` calls by default, so reset the keywords: `xgettext -k --keyword=_ --keyword=C_:1c,2 --keyword=ngettext:1,2`. The `.pot` is committed. |
| `make pack` | `gnome-extensions pack` with `--podir=po`, the icons and any extra sources. |
| `make install` | Installs the packed zip for the current user. |
| `make check-deps` | Lists missing tools (`gjs`, `xgettext` from `gettext`, `python3-gi`, the German GNOME language pack) and the `apt` line that installs them. It never runs `sudo` itself. |

**README.** It covers what the extension does, installing it, the `make` targets, where translators put a `.po` file, and the icon attribution.

Source: #5, #9, #15.

## 9. Out of scope

- Positioning or reordering the toggle and icon (§1).
- Preferences, and any setting stored by the extension.
- Charge thresholds as numbers: the extension switches the mode only.
- Automatically aligning a newly arrived battery with the others (§4).
- Error states inside the toggle's menu; failures go to notifications (§4).
- CI (§7).
