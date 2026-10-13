# How GNOME Shell's Power Mode Quick Settings toggle is built (GNOME 48–50)

Research for issue #4 (part of map #2). Researched 2026-10-13.

**Sources** (all primary):

- gnome-shell source at tags `48.0`, `49.0`, `50.0`, `50.1` from `gitlab.gnome.org/GNOME/gnome-shell`:
  `js/ui/status/powerProfiles.js`, `js/ui/quickSettings.js`, `js/ui/popupMenu.js`, `js/ui/panel.js`.
  Links below use the `50.1` tag, e.g.
  <https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/ui/status/powerProfiles.js>.
- The dev machine's installed GNOME Shell 50.1: `powerProfiles.js` extracted from
  `/usr/lib/gnome-shell/libshell-18.so` (`gresource extract`) is byte-identical to the `50.1` tag.
- gjs.guide: [Quick Settings](https://gjs.guide/extensions/topics/quick-settings.html),
  port guides for [48](https://gjs.guide/extensions/upgrading/gnome-shell-48.html),
  [49](https://gjs.guide/extensions/upgrading/gnome-shell-49.html),
  [50](https://gjs.guide/extensions/upgrading/gnome-shell-50.html).

## 1. Anatomy of the Power Mode toggle (50.1)

Source: `js/ui/status/powerProfiles.js` @ 50.1 (152 lines).

### Class

`PowerProfilesToggle extends QuickMenuToggle` (imported from `../quickSettings.js`). It is wrapped by
`Indicator extends SystemIndicator`, which pushes the toggle onto `this.quickSettingsItems`.

```js
super._init({
    title: C_('Quick settings button title', 'Power Mode'),
    menuButtonAccessibleName: _('Open power profiles menu'),
});
```

- `title` is fixed ("Power Mode").
- `subtitle` and `iconName` are set together in `_sync()` from the active profile:
  `this.set({subtitle, iconName})`. So **the subtitle names the current mode** and **the toggle icon
  changes with the mode**.
- `toggleMode` is **not** set. The click handler drives state itself, and `checked` is derived from
  D-Bus state in `_sync()`:
  `this.checked = activeProfile !== 'balanced'`.
- Click handler: `this._proxy.ActiveProfile = this.checked ? 'balanced' : <last non-balanced profile>`.
  The last non-balanced profile is kept in `global.settings` key `last-selected-power-profile`
  (a shell-owned key that extensions can't reuse).
- Visibility: `this.visible = this._proxy.g_name_owner !== null`, so the toggle hides when the D-Bus
  service is absent.
- `menuEnabled = this._profileItems.size > 2`: the arrow is hidden when fewer than 3 profiles exist.

### Icons

| Profile | Name (msgctxt `Power profile`) | Icon name |
|---|---|---|
| `performance` | Performance | `power-profile-performance-symbolic` |
| `balanced` | Balanced | `power-profile-balanced-symbolic` |
| `power-saver` | Power Saver | `power-profile-power-saver-symbolic` |
| unknown (fallback, 49+) | Custom | `gnome-power-manager-symbolic` |

The menu header always uses `power-profile-balanced-symbolic`. On the dev machine the three
`power-profile-*` icons are in `/usr/share/icons/Adwaita/symbolic/status/`, and
`gnome-power-manager-symbolic` is in `.../symbolic/legacy/`. Adwaita ships **no** battery-health or
charge-limit icon. The nearest battery icons there are `battery-level-N[-charging|-plugged-in]-symbolic`,
`battery-full-charged-symbolic` (legacy), `battery-action-symbolic`, `battery-caution-symbolic`,
`battery-low-symbolic` and `battery-missing-symbolic`.

### Menu: header, checklist, Power Settings link

Built in `_init()` in this order:

```js
this._profileSection = new PopupMenu.PopupMenuSection();
this.menu.addMenuItem(this._profileSection);
this.menu.setHeader('power-profile-balanced-symbolic',
    C_('Quick settings menu header', 'Power Mode'));
this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
this.menu.addSettingsAction(_('Power Settings'), 'gnome-power-panel.desktop');
```

- **Header**: `QuickToggleMenu.setHeader(icon, title, subtitle = '')` (`quickSettings.js`). `icon` is an
  icon-name string or a `Gio.Icon`. The subtitle is hidden when empty. Power Mode passes no subtitle.
  `addHeaderSuffix(actor)` also exists.
- **Checklist**: `_syncProfiles()` empties the section and adds one
  `new PopupMenu.PopupImageMenuItem(name, iconName)` per profile (in reverse D-Bus order). Each item
  has its own icon, and `activate` sets `ActiveProfile`. `_sync()` marks the active item with
  `item.setOrnament(PopupMenu.Ornament.CHECK)` and the others with `Ornament.NONE`. So the checklist
  is a set of image menu items with a check ornament, not radio items.
- **Power Settings link**: `PopupMenuBase.addSettingsAction(title, desktopFile)` (`popupMenu.js`). It
  adds a plain item that looks up `Shell.AppSystem...lookup_app(desktopFile)`, hides the overview,
  calls `Main.panel.closeQuickSettings()` and activates the app. It sets
  `menuItem.visible = Main.sessionMode.allowSettings` (hidden on the lock screen) and registers the
  item in `this._settingsActions[desktopFile]`, which the menu uses to keep it in step with the session
  mode. `gnome-power-panel.desktop` exists on the dev machine
  (`/usr/share/applications/gnome-power-panel.desktop`). An extension can call `addSettingsAction`
  directly with the same desktop file, so it doesn't need gjs.guide's hand-rolled
  `addAction` + `_settingsActions[uuid]` pattern (that pattern exists because extension prefs have no
  desktop file).

### Top-bar indicator (new in 50)

In 48 and 49, `Indicator` only pushes the toggle, so Power Mode has no top-bar icon. In **50.0** it gains:

```js
this._indicator = this._addIndicator();
this._powerProfilesToggle.bind_property('icon-name', this._indicator, 'icon-name', SYNC_CREATE);
this._powerProfilesToggle.bind_property('checked', this._indicator, 'visible', SYNC_CREATE);
```

So from GNOME 50 the top bar shows the profile icon whenever Power Mode is not Balanced. (The map says
"no top-bar indicator" for our extension, which now differs from Power Mode on 50.)

## 2. What an extension must copy vs. import

The building blocks are all public ES-module exports that extensions can import:

```js
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
```

- **Import**: `QuickMenuToggle`, `SystemIndicator`, `PopupMenu.PopupMenuSection`,
  `PopupImageMenuItem` (or `PopupMenuItem`), `PopupSeparatorMenuItem`, `Ornament`,
  `menu.setHeader`, `menu.addSettingsAction`.
- **Copy (write our own)**: the toggle class itself, about 60 lines. `PowerProfilesToggle` is not
  exported (only `Indicator` is), it is hard-wired to the PowerProfiles D-Bus proxy, and it keeps state
  in a shell-owned GSettings key. Our version replaces the proxy with UPower's battery device
  (`ChargeThresholdEnabled` / `EnableChargeThreshold`). It is simpler because there are exactly two
  modes, so no "last selected" memory is needed: click flips the mode and `checked` = Preserve Battery Health.
- **Strings**: the shell's `_()`/`C_()` resolve in the `gnome-shell` gettext domain. An extension
  uses its own domain, so it cannot borrow "Power Settings" translations implicitly. It would ship
  its own strings (or call `Gettext.dgettext('gnome-shell', ...)` / `'gnome-control-center-2.0'` for
  exact-match wording, which is a design choice to settle).

Minimal wiring (gjs.guide Quick Settings page):

```js
enable() {
    this._indicator = new MyIndicator(this);   // SystemIndicator subclass
    Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
}
disable() {
    this._indicator.quickSettingsItems.forEach(i => i.destroy());
    this._indicator.destroy();
    this._indicator = null;
}
```

gjs.guide says every quick-settings extension should have a `SystemIndicator`, even with no icon. If
`_addIndicator()` is never called, the indicator box has no children and stays `visible: false`,
which gives us "no top-bar icon" for free.

## 3. API differences across 48, 49, 50

`addExternalIndicator(indicator, colSpan = 1)` in `panel.js` is **identical** in 48.0 and 50.1. It inserts
the indicator before `_brightness` in the top bar, and the items before the Background Apps item in the
grid. `SystemIndicator` (`quickSettingsItems`, `_addIndicator()`) is unchanged.

`quickSettings.js` diffs:

| From → to | Change | Impact on us |
|---|---|---|
| 48 → 49 | `QuickMenuToggle` and `QuickSlider` gain a `menu-button-accessible-name` property (default `_('Open menu')`). It replaces a hard-coded `accessible_name` on the arrow button. | Passing `menuButtonAccessibleName` to the constructor on **48** sets an unknown GObject property. GJS **throws** on an unknown construct property (verified with local gjs 1.88: `new GObject.Object({fooBar: 1})` → "No property fooBar on GObject"), so set it only when `'menu-button-accessible-name' in toggle` / version ≥ 49 (or set `this._menuButton.accessible_name` on 48, a private field). **The one real 48-vs-49 API break for our toggle.** |
| 48 → 49 | Menu open animation `LINEAR` → `EASE_OUT_QUAD` | None |
| 49 → 50 | `POPUP_ANIMATION_TIME` exported; `QuickToggleMenu` registers with `global.focus_manager` | None |
| 50.0 → 50.1 | `QuickSettingsMenu` overlay layout fixes (height for width, X constraint) | None |

`popupMenu.js` 48 → 50.1: `PopupBaseMenuItem` uses `Clutter.ClickGesture` instead of `ClickAction`
(the 49 port guide says `Clutter.ClickAction`/`TapAction` were removed). The separator gains an
accessible role, and `PopupSwitchMenuItem` drag moves to `Clutter.PanGesture`. `addAction`,
`addSettingsAction`, `setOrnament`, `Ornament.CHECK`, `PopupImageMenuItem` and `PopupMenuSection`
are unchanged. Our extension wouldn't touch the changed parts.

`powerProfiles.js` changes: 49 added `FALLBACK_PARAMS`, a guard for unknown profiles, and
`menuButtonAccessibleName`. 50 changed the strings to `C_()` contexts and added the top-bar indicator.

gjs.guide port guides: 48, 49 and 50 all say there were "no relevant changes" to `metadata.json`,
`extension.js` or `prefs.js`. The 48 guide notes the QuickMenuToggle style-class renames
(`quick-menu-toggle` → `quick-toggle-has-menu`, `quick-toggle-arrow` → `quick-toggle-menu-button`).
Those are already in place at 48.0, so 48–50 share class names. Other notes from the guides that matter
for testing: 49 drops nested X11 mode (use `dbus-run-session gnome-shell --devkit --wayland`), and 50
adds `gnome-shell-test-tool --extension <zip> <test.js>` and removes X11 support.

**Conclusion:** one codebase can target 48–50 with `"shell-version": ["48", "49", "50"]`. The only
version-sensitive point found is `menuButtonAccessibleName` (49+).
