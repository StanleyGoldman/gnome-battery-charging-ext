# How a GNOME 50 extension stores settings and shows a preferences window

Research for issue #51 (part of map #49). Researched 2026-11-06.

**Sources** (all primary):

- gnome-shell source at tag `50.1` from `gitlab.gnome.org/GNOME/gnome-shell`:
  [`js/extensions/sharedInternals.js`](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/extensions/sharedInternals.js),
  [`js/extensions/prefs.js`](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/extensions/prefs.js),
  [`js/extensions/extension.js`](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/extensions/extension.js),
  [`js/dbusServices/extensions/extensionPrefsDialog.js`](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/dbusServices/extensions/extensionPrefsDialog.js),
  [`js/ui/extensionSystem.js`](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/ui/extensionSystem.js),
  [`js/ui/extensionDownloader.js`](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/ui/extensionDownloader.js),
  [`js/ui/popupMenu.js`](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/ui/popupMenu.js),
  [`js/ui/quickSettings.js`](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/ui/quickSettings.js),
  [`js/ui/status/network.js`](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/ui/status/network.js),
  [`subprojects/extensions-tool/src/command-pack.c`](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/subprojects/extensions-tool/src/command-pack.c),
  [`subprojects/extensions-tool/src/command-install.c`](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/subprojects/extensions-tool/src/command-install.c).
- gjs.guide: [Preferences](https://gjs.guide/extensions/development/preferences.html),
  [Extension (ESModule)](https://gjs.guide/extensions/topics/extension.html),
  [Quick Settings](https://gjs.guide/extensions/topics/quick-settings.html),
  [Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html),
  port guides for [47](https://gjs.guide/extensions/upgrading/gnome-shell-47.html) and
  [50](https://gjs.guide/extensions/upgrading/gnome-shell-50.html).
- libadwaita 1.9 docs (GNOME 50 ships Adw 1.9):
  [`ComboRow`](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/1.9/class.ComboRow.html),
  [`SpinRow`](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/1.9/class.SpinRow.html),
  [`ToggleGroup`](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/1.9/class.ToggleGroup.html),
  [`PreferencesWindow`](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/1.9/class.PreferencesWindow.html).
- Experiments on the dev machine (Ubuntu, GNOME Shell 50.1, `libadwaita-1-0` 1.9.1, gjs): `gnome-extensions pack`
  on a scratch copy of `src/` with a schema and a `prefs.js` added, and gjs scripts that bind a compiled test schema
  (memory backend) to Adw widgets. The test schema was an enum key `full-battery-action` (`off`/`notify`/`switch`)
  and a `u` key `full-timeout`.
- Precedent: Caffeine's
  [`extension.js`](https://github.com/eonpatapon/gnome-shell-extension-caffeine/blob/master/caffeine%40patapon.info/extension.js)
  (default branch, last pushed 2026-10-08).

"Verified" means checked by running it here. "Inference" marks conclusions not stated by a source.

## 1. Shipping a GSettings schema

### Layout and metadata

- Put the schema at `schemas/<schema-id>.gschema.xml` inside the extension directory. For us that's
  `src/schemas/org.gnome.shell.extensions.battery-charging.gschema.xml`. The ID must start with
  `org.gnome.shell.extensions` and the path with `/org/gnome/shell/extensions/` (review guidelines, "GSettings Schemas":
  "MUST use org.gnome.shell.extensions as a base ID", "MUST use /org/gnome/shell/extensions as a base path", "MUST be
  included in the extension ZIP file", filename "MUST follow pattern of <schema-id>.gschema.xml").
- Add `"settings-schema": "org.gnome.shell.extensions.battery-charging"` to `metadata.json`. `getSettings()` with no
  argument then reads the ID from metadata (`sharedInternals.js`: `schema ||= this.metadata['settings-schema']`).
  `gnome-extensions pack` does **not** add the key (verified: the packed `metadata.json` matched the source), so it has
  to be in `src/metadata.json`.
- A suggested path is `/org/gnome/shell/extensions/battery-charging/` (inference: gjs.guide's example uses
  `/org/gnome/shell/extensions/<name>/`, and nothing requires the path to contain the UUID).
- Enum keys work: `<enum id="...">` with nicks, read with `get_enum()`/`get_string()` (verified with
  `glib-compile-schemas --strict`).

### Compiling: nothing to ship

- `getSettings()` loads `<extension dir>/schemas/` with `Gio.SettingsSchemaSource.new_from_directory()`, which needs a
  `gschemas.compiled` there at runtime (`sharedInternals.js` `getSettings`).
- Since GNOME 44, installers compile the schema, so the zip doesn't need `gschemas.compiled` (gjs.guide Preferences:
  "settings schemas are compiled automatically for extensions installed with the `gnome-extensions` tool"):
  - `gnome-extensions install` runs `glib-compile-schemas --strict <dst>/schemas` after unpacking
    (`command-install.c`), and it **fails the install** if compilation fails.
  - An install from extensions.gnome.org runs the same command (`extensionDownloader.js`, `compileSchema`).
  - `gnome-shell-test-tool --extension <zip>` installs through `gnome-extensions install` (`/usr/bin/gnome-shell-test-tool`,
    `install_extension()`), so `make test-integration` gets a compiled schema too.

### `gnome-extensions pack` and the current Makefile

`gnome-extensions pack --help` on 50.1 lists `--schema=SCHEMA` ("A GSettings schema that should be included").
`command-pack.c` shows that without `--schema` it runs `find_schemas()` and picks up every `schemas/*.gschema.xml` in the
source directory. Verified on a scratch copy:

- With `src/schemas/<id>.gschema.xml` present and **no new flags**, the zip contains `schemas/<id>.gschema.xml` (not
  compiled).
- `prefs.js` at the top of the source directory is packed automatically. The Makefile's `EXTRA_SOURCES` would also pass
  `--extra-source=prefs.js`, and that duplicate is harmless (verified: rc 0, one `prefs.js` in the zip).

What the Makefile needs (inference from the above):

- `SOURCES` should add `$(wildcard src/schemas/*.gschema.xml)` so a schema edit rebuilds the zip. Nothing else in
  `pack` changes.
- A `--strict` dry-run compile (`glib-compile-schemas --strict --dry-run src/schemas`) belongs in `make test`, or as
  its own target. Otherwise a schema error only shows up when `gnome-extensions install` fails. `glib-compile-schemas` is
  already present here (`/usr/bin`, from `libglib2.0-bin`), and `scripts/check-deps.sh` should list it.
- Unit tests that need real settings can compile the schema into a temp dir and use
  `Gio.memory_settings_backend_new()`, which is how the experiments here ran. Keeping settings behind a small interface
  so the model gets plain values is simpler still.
- `make pot` already scans `src/*.js`, so strings in `prefs.js` are extracted with no change.
- Don't commit `gschemas.compiled`. Add `src/schemas/gschemas.compiled` to `.gitignore` if anyone compiles in place.
- `make uninstall` removes files but not the user's values under `/org/gnome/shell/extensions/battery-charging/` in
  dconf (inference: nothing in the uninstall paths touches dconf). That's normal for extensions.

## 2. `getSettings()`, `ExtensionPreferences` and `fillPreferencesWindow` on 50

- `getSettings(schema?)` lives on `ExtensionBase` (`sharedInternals.js`), so `Extension` (shell process) and
  `ExtensionPreferences` (prefs process) both have it. It throws `Schema ... could not be found` if the schema is missing.
- **Two processes.** Prefs run in a separate GTK4/Adw process (`org.gnome.Shell.Extensions`, `js/dbusServices/extensions/`).
  The shell side sees changes through `Gio.Settings` signals (`changed::<key>`) or `settings.bind()`, not by
  calling into prefs (gjs.guide Preferences).
- **Prefs class shape** (`js/extensions/prefs.js` @ 50.1):

  ```js
  import Adw from 'gi://Adw';
  import Gio from 'gi://Gio';
  import Gtk from 'gi://Gtk';
  import {ExtensionPreferences, gettext as _} from
      'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

  export default class BatteryChargingPrefs extends ExtensionPreferences {
      async fillPreferencesWindow(window) {
          window._settings = this.getSettings();
          const page = new Adw.PreferencesPage();
          const group = new Adw.PreferencesGroup({title: _('...')});
          page.add(group);
          window.add(page);
      }
  }
  ```

  Override either `fillPreferencesWindow(window)` (recommended) or `getPreferencesWidget()`. The default
  `fillPreferencesWindow` wraps the widget in a page/group. Both are awaited since GNOME 47 (47 port guide). Storing the
  settings object as `window._settings` is gjs.guide's pattern. The import path is
  `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js` (capital S in `Shell`, unlike the shell-side
  `resource:///org/gnome/shell/extensions/extension.js`).
- **The window is still `Adw.PreferencesWindow` on 50.** `ExtensionPrefsDialog extends Adw.PreferencesWindow`
  (`extensionPrefsDialog.js`), created with `search_enabled: false`. `Adw.PreferencesWindow` is "Deprecated since: 1.6"
  in favour of `AdwPreferencesDialog`, but the shell chooses the window and the extension only fills it, so the
  deprecation doesn't affect us. Don't call `window.destroy()` or `set_titlebar()`: the dialog overrides both to show an
  error page. If the extension adds no page, it shows "Extension did not provide any UI".
- **Opening prefs from the extension:** `Extension.openPreferences()` calls
  `extensionManager.openExtensionPrefs(this.uuid, '', {})` (`extension.js`). Users also reach prefs from the Extensions
  app and with `gnome-extensions prefs <uuid>`.
- The 48, 49 and 50 port guides list no changes to `metadata.json` or `prefs.js`. 47 is the last that changed prefs (the
  awaiting).

## 3. Adw widgets for a three-value choice and two durations (Adw 1.9)

| Need | Widget | Since | Binding to an enum / `u` key (verified) |
|---|---|---|---|
| Three-value choice, row style | `Adw.ComboRow` with `model: Gtk.StringList.new([...])` | 1.0 | **`settings.bind()` to `selected` fails.** GLib logs `g_settings_bind: property 'selected' ... has type 'guint' which is not compatible with type 's' of key`, because an enum key is stored as a string. Sync by hand (`selected = settings.get_enum(key)`, and `notify::selected` → `set_enum`), or use `settings.bind_with_mapping()`, which exists in this GJS (not tested). An int key (`i`/`u`) would bind directly, but then the schema doesn't validate the nicks. |
| Three-value choice, segmented | `Adw.ToggleGroup` with three `Adw.Toggle({name, label})` | 1.7 | **Binds directly:** `settings.bind(key, group, 'active-name', ...)` round-trips the enum nick both ways. It's a button group, not a row, so put it in an `Adw.ActionRow` suffix or under a group. "Switch automatically" is a long label for a segment. |
| Duration | `Adw.SpinRow.new_with_range(min, max, step)` | 1.4 | **Binds directly:** a `u` key to `value` (double) round-trips (45 → 45.0, 90.0 → 90). No unit property, so put the unit in the title or subtitle ("Timeout (minutes)"), or add a suffix label (inference). |
| Hide or disable timing rows when Off | `row.sensitive` / `visible` driven by the action key, or `Adw.ExpanderRow` | 1.0 | Inference: one handler on `changed::full-battery-action`. |

Also available in 1.9 (verified present): `SwitchRow`, `ButtonRow`, `ExpanderRow`, `ActionRow`, `InlineViewSwitcher`.

## 4. extensions.gnome.org review rules that apply

From the [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html):

- **Schema:** the ID, path and filename rules in §1. The XML must be in the zip, and `pack` does that.
- **Process separation:** "Extensions MUST NOT import Clutter, Meta, St or Shell in the preferences process", and
  "MUST NOT import Gdk, Gtk or Adw in the GNOME Shell process." Code shared between the two must stay pure
  GJS/Gio/GLib/GObject. Today `src/strings.js` has no imports, `model.js` imports only GObject, and `upower.js` only
  Gio/GLib, so all three could be imported from prefs (checked in the repo).
- **No work at construct time:** "MUST NOT create any objects, connect any signals, add any main loop sources or modify
  GNOME Shell" during initialization. Call `getSettings()` in `enable()`, not in the constructor.
- **Cleanup in `disable()`:** destroy every object, disconnect every signal (including `Gio.Settings` handlers), and
  "Any main loop sources created MUST be removed in disable() ... even if the callback function will eventually return
  false". That covers the full-battery timeout and the re-notify interval. Null the settings object (gjs.guide
  Preferences).
- **metadata.json:** no unnecessary keys. `session-modes` "MUST be dropped if you are only using `user` mode".
- **Unnecessary files:** no `.po`/`.pot` and no build scripts in the zip. That's unchanged, since `pack` compiles `.po`
  into `locale/`.

### Lock screen: the extension is disabled while the screen is locked

`extensionSystem.js` gives every extension `sessionModes: metadata['session-modes'] ?? ['user']` and enables only
extensions whose modes include the current one. Locking switches to `unlock-dialog`, so **our extension's `disable()`
runs on lock and `enable()` runs on unlock**. Any full-battery timer is torn down while locked. To keep a timer running
on the lock screen, `metadata.json` would need `"session-modes": ["user", "unlock-dialog"]`. Review accepts that only
if "it is necessary for the extension to operate correctly", requires a comment in `disable()` explaining why, and
"Extensions MUST NOT disable selectively". The alternative is to accept that the timer restarts after unlock. Whether
"battery full for N minutes" can be measured from UPower state, so that no timer has to survive, is an inference for the
monitoring ticket.

## 5. Can the Quick Settings menu host settings?

- **Mechanics: yes.** A `QuickMenuToggle`'s menu is a `PopupMenuBase` (`QuickToggleMenu`, `quickSettings.js`). It
  takes any `PopupMenu` item, including sections, separators, `PopupSubMenuMenuItem`, and items with radio ornaments
  (`Ornament.DOT` / `NO_DOT`, which set the accessible CHECKED state; `popupMenu.js`).
- **Shell precedent:**
  - Network (`status/network.js`) nests `PopupSubMenuMenuItem`s inside quick-settings menus for per-device lists, and
    uses `DOT`/`NO_DOT` for radio-style items.
  - Power Mode and Sound use a `CHECK` checklist (see `power-mode-toggle.md`).
  - No Shell quick-settings menu holds a preference with durations. Built-in menus only pick the current state, and
    configuration goes through `addSettingsAction(..., '<panel>.desktop')`.
- **Extension precedent:** Caffeine's `QuickMenuToggle` menu has a "Caffeine Timer" header, a `CHECK` checklist of timer
  durations stored in its GSettings (`set_int(TIMER_KEY, ...)`), and a "Settings" item that opens its prefs.
- **Prefs link from the menu:** `addSettingsAction()` needs a `.desktop` file, which extension prefs don't have. gjs.guide's
  pattern is `addAction(_('...'), () => extension.openPreferences())`, then `settingsItem.visible =
  Main.sessionMode.allowSettings; this.menu._settingsActions[extension.uuid] = settingsItem;` so the item hides on the
  lock screen (`_settingsActions` is private but documented by gjs.guide).
- **Fit with our menu (inference):** the menu already has a two-item `CHECK` checklist for the charging mode, plus
  Power Settings. A second three-item checklist for the Full-battery action in the same menu would put two checklists
  for different things side by side. A `PopupSubMenuMenuItem` (as Network does) or a prefs link keeps them apart.
  Durations don't fit a menu well, short of a fixed list as Caffeine does. A prefs window can hold both the choice and
  the durations.

## Short answer / implications

- **Storage:** ship `src/schemas/org.gnome.shell.extensions.battery-charging.gschema.xml` (path
  `/org/gnome/shell/extensions/battery-charging/`) and add `settings-schema` to `src/metadata.json`. `gnome-extensions
  pack` picks up `schemas/` and `prefs.js` with no new flags. The installer, extensions.gnome.org and
  `gnome-shell-test-tool` compile the schema with `--strict`, so don't ship `gschemas.compiled`. Makefile changes: add the
  schema to `SOURCES`, add a `--strict --dry-run` check, and list `glib-compile-schemas` in `check-deps`.
- **Prefs:** `export default class extends ExtensionPreferences` with `fillPreferencesWindow(window)` filling an
  `Adw.PreferencesWindow` (still the window on 50, though deprecated in Adw 1.6). `prefs.js` must not import
  Shell/St/Clutter/Meta, and `extension.js` must not import Gtk/Adw/Gdk.
- **Widgets:** `Adw.ComboRow` for Off / Notify / Switch automatically, synced by hand or via `bind_with_mapping` (an
  enum key won't `bind()` to `selected`), or an `Adw.ToggleGroup`, which binds an enum directly via `active-name`.
  Use `Adw.SpinRow` for each duration, which binds a `u` key directly.
- **Review:** `getSettings()` in `enable()`. Disconnect settings handlers and remove every timeout in `disable()`.
- **Lock screen (surprise):** without `"session-modes": ["user", "unlock-dialog"]` the extension is disabled while
  locked, so full-battery timers stop and restart on unlock. Adding `unlock-dialog` needs a review justification.
- **Quick Settings:** it can host the choice (a checklist, radio items or a submenu, with Network and Caffeine as
  precedent), but durations belong in prefs. A "Settings" item opening prefs follows gjs.guide's
  `openPreferences()` + `_settingsActions[uuid]` pattern.
