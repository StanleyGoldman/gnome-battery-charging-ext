# Battery Charging

A GNOME Shell extension that switches **Battery Charging** between **Maximize Charge** and **Preserve Battery Health** from Quick Settings, next to Power Mode.

- **The toggle** is lit while Preserve Battery Health is on. Click it to switch modes, or open its menu to pick one.
- **The setting** is UPower's, the same one GNOME Settings' Power page shows, so the two always agree. The extension stores nothing of its own and has no preferences.
- **Every supporting battery** (a laptop battery whose firmware lets UPower limit its charge) is switched together. The toggle is hidden on machines without one.
- **A refused switch** (for example from a remote or inactive session) snaps the toggle back and posts a notification.
- **On GNOME 50**, a battery icon with a heart shows in the top bar while Preserve Battery Health is on.

It needs UPower 1.90.6 or later and a supporting battery. `src/metadata.json` lists the GNOME Shell versions it has been checked on.

## Installing

From a checkout:

```sh
make install
```

Then log out and back in (on Wayland the shell can't reload extensions), and enable it:

```sh
gnome-extensions enable battery-charging@stanleygoldman.github.io
```

## Make targets

| Target | What it does |
|---|---|
| `make test` | Runs the unit tests under `gjs`. Fast. |
| `make test-integration` | Packs the extension, then runs the headless GNOME Shell tests against a mock UPower. |
| `make pack` | Builds the installable zip in `dist/`. |
| `make install` | Packs the zip and installs it for the current user. |
| `make pot` | Regenerates the translation template, `po/battery-charging@stanleygoldman.github.io.pot`. |
| `make check-deps` | Lists missing tools and the `apt` line that installs them. It never runs `sudo`. |

Before a release, work through [`docs/release-checklist.md`](docs/release-checklist.md).

## Translating

1. Copy the template to `po/<lang>.po`, e.g. `po/fr.po`:

   ```sh
   msginit -i po/battery-charging@stanleygoldman.github.io.pot -o po/fr.po -l fr
   ```

2. Translate the strings. The comments above each one say where it appears and how long it may be.
3. Run `make pack`. It compiles every `.po` in `po/` into the zip, with no code change.

The mode names ("Battery Charging", "Maximize Charge", "Preserve Battery Health") and "Power Settings" aren't in the template. They come from GNOME Settings' and GNOME Shell's own translations, so they read the same as in Settings.

## Icon attribution

The two icons in `src/icons/` are derived from the battery outline in Adwaita's `battery-symbolic` icon ([adwaita-icon-theme](https://gitlab.gnome.org/GNOME/adwaita-icon-theme)), licensed under LGPL-3.0 or CC-BY-SA-3.0. They keep that licence.
