# How GNOME Settings reads and switches Battery Charging

Research for issue #3 (part of map #2). Researched 2026-10-13.

Sources:
- gnome-control-center (GNOME Settings) git: `panels/power/cc-power-panel.c` and `cc-power-panel.blp` at tags `48.0`, `48.7`, `49.5`, `50.0`. (`GCC` below.) https://gitlab.gnome.org/GNOME/gnome-control-center
- UPower git at tag `v1.91.1` (the version on the dev machine) plus `NEWS` at `v1.91.5`. (`UP` below.) https://gitlab.freedesktop.org/upower/upower
- Read-only inspection of the dev machine (GNOME Shell 50.1, gnome-control-center 50.3, UPower 1.91.1): `gdbus introspect`, `upower -i`, `pkaction --verbose`, `ls -l /var/lib/upower`.

## Short answer

- Settings uses UPower's per-device D-Bus API. It **reads** `ChargeThresholdSupported` and `ChargeThresholdEnabled` (through the `charge-threshold-supported` / `charge-threshold-enabled` properties of libupower-glib's `UpDevice`) and **writes** by calling `org.freedesktop.UPower.Device.EnableChargeThreshold(b)`.
- It acts on **every** device with `Type == Battery` (2), `PowerSupply == true` and `ChargeThresholdSupported == true`. It calls them one after another, synchronously.
- The section is shown if **any** such battery supports a limit. "Preserve Battery Health" is selected if **any** of them has the limit enabled.
- `ChargeThresholdSettingsSupported` is **not used** by Settings.
- Writes are guarded by the polkit action `org.freedesktop.UPower.enable-charging-limit`, which defaults to `allow_active=yes`, `allow_inactive=no` and `allow_any` unset (so no). An ordinary user in the active local session gets **no password prompt**. Settings never asks for interactive authorization anyway.
- Settings notices changes through GObject `notify` on each `UpDevice` (driven by D-Bus `PropertiesChanged`) plus UpClient's `device-added` and `device-removed`. Any property change at all rebuilds the whole section.
- The Settings feature first shipped in **GNOME 48.0**. The only behaviour change across 48 to 50 is a fix for an infinite toggle loop on machines with several batteries (in 48.7, 49.5 and 50.beta onward). On the UPower side the D-Bus API is stable from 1.90.5. Later versions add `ChargeThresholdSettingsSupported` and `charge_types` support (1.90.10), and support for hardware that only has an end threshold (1.91.2).

## 1. How Settings reads the state

`up_client_changed()` (GCC 50.0 `cc-power-panel.c` ~L254–395):

- It first hides `battery_charging_section`.
- If the display device's kind is UPS, it skips the battery logic, so the section stays hidden on a UPS setup.
- Otherwise, for each device from `up_client_get_devices2()` with `kind == UP_DEVICE_KIND_BATTERY && power-supply`, it reads `charge-threshold-enabled` and `charge-threshold-supported`. It ORs each one across batteries:
  ```c
  /* If any of the batteries support setting charge thresholds show a switch */
  if (is_charge_threshold_supported) charge_threshold_supported = TRUE;
  if (is_charge_threshold_enabled)   charge_threshold_enabled = TRUE;
  ```
- If `charge_threshold_supported`, it sets the radio to Preserve Battery Health when `charge_threshold_enabled`, and to Maximize Charge otherwise. It then makes the section visible.

Peripheral batteries (mouse, headset) have `PowerSupply = false`, so they are ignored. On the dev machine the Logitech mouse `battery_hidpp_battery_0` has `power supply: no`.

The radios are defined in `cc-power-panel.blp` (GCC 50.0 L70–95). The group title is "Battery Charging" and the rows are "_Maximize Charge" and "Preserve Battery _Health". In 48.0 the same widgets were in `cc-power-panel.ui`, before the Blueprint port (commit 1bbd7ab1e, 2025-05-19).

`ChargeThresholdSettingsSupported`, `ChargeStartThreshold` and `ChargeEndThreshold` are never read by Settings. (`git grep` for `ChargeThreshold|charge_threshold` under `panels/power` finds only the supported and enabled properties.)

## 2. How Settings switches

`battery_health_radio_changed_cb()` (GCC 50.0 L160–215), bound to the Preserve radio's `toggled`:

- `enabled = preserve_battery_radio.active`.
- It gets the system bus synchronously. Then, for **each** battery with `kind == BATTERY && power-supply && charge-threshold-supported`, it calls:
  ```c
  g_dbus_connection_call_sync (connection, "org.freedesktop.UPower",
      up_device_get_object_path (device), "org.freedesktop.UPower.Device",
      "EnableChargeThreshold", g_variant_new ("(b)", enabled),
      NULL, G_DBUS_CALL_FLAGS_NONE, -1, NULL, &error);
  ```
- These are **synchronous** calls on the UI thread. They use `G_DBUS_CALL_FLAGS_NONE`, so there is no `ALLOW_INTERACTIVE_AUTHORIZATION`. Errors are only logged with `g_debug`, so a failed switch is silent and the radio stays where the user clicked it.
- It does not check whether a battery is already in the target state. Every supporting battery gets the call.

## 3. What UPower does on EnableChargeThreshold

`up_device_battery_set_charge_threshold()` (UP v1.91.1 `src/up-device-battery.c` ~L646–716):

1. It runs the polkit check `up_device_polkit_is_allowed()`, which checks the action `org.freedesktop.UPower.enable-charging-limit` (`src/up-device.c` L410). On failure it returns `UP_DAEMON_ERROR_GENERAL` "Operation is not allowed."
2. If `charge-threshold-supported` is false, it returns the error "setting battery charge thresholds is unsupported".
3. It writes `"1"` or `"0"` to the state file **`/var/lib/upower/charging-threshold-status`**. This is a single file shared by **all** batteries; it is not per device. On the dev machine it exists, owned by root and mode 0644.
4. If enabled, it writes the device's `ChargeStartThreshold` and `ChargeEndThreshold` to sysfs. If disabled, it writes 0 and 100. On `charge_types` hardware it switches `charge_types` instead (Long_Life/Custom versus Standard/Fast; UP NEWS 1.90.10 !268 !276, 1.91.3 !316).
5. It sets `charge-threshold-enabled`, which emits `PropertiesChanged`, and returns.

When the daemon starts or a battery appears, `up_device_battery_recover_battery_charging_threshold()` reads that shared state file and re-applies the limit to each supporting battery (UP L456–480). So the mode survives reboots, and it is effectively one global mode.

### What makes `ChargeThresholdSupported` true (Linux backend)

UP v1.91.1 `src/linux/up-device-supply-battery.c`:
- **hwdb route.** The udev property `CHARGE_LIMIT="start,end"` is present (from UPower's hwdb, for example the 75,80 default from 1.90.6). Bits 1 and 2 of `ChargeThresholdSettingsSupported` are set when the sysfs files `charge_control_start_threshold` and `charge_control_end_threshold` exist.
- **charge_types route** (1.90.10 and later). There are no start or end sysfs files, but `charge_types` lists `Long_Life` together with one of Standard, Adaptive or Fast. This sets bit 4 ("optimized charging behaviors controlled by the system firmware"). In this case the start and end thresholds can read 0, which matches the dev machine: BAT0 has `ChargeThresholdSettingsSupported = 4` and Start and End both 0.

D-Bus docs for the bitmask (UP `dbus/org.freedesktop.UPower.Device.xml` ~L904): 1 = start threshold, 2 = end threshold, 4 = firmware-controlled.

## 4. Polkit and password prompts

Policy (UP `policy/org.freedesktop.upower.policy.in`, and the same on the dev machine according to `pkaction --verbose`):

```
org.freedesktop.UPower.enable-charging-limit
  implicit any:      no
  implicit inactive: no
  implicit active:   yes
```

- A user in the **active local session** is authorized with no prompt. That is why Settings never shows a dialog.
- **Inactive** sessions (switched-away user) and **non-local** ones (SSH, `any`) are **denied**.
- UPower checks with `POLKIT_CHECK_AUTHORIZATION_FLAGS_NONE`, so no agent dialog ever appears. It also counts a **challenge** result as allowed (`src/up-polkit.c` L126–127: `is_authorized || is_challenge`). So if a distro or admin rule changed the action to `auth_admin`, the call would quietly **succeed** with no prompt instead of failing. This is a UPower quirk worth knowing about; the extension cannot rely on it, and it does not need to.
- Distro or admin `rules.d` files can override all of this. The extension should treat "Operation is not allowed." as a normal error to show.

## 5. Change notification

- Settings connects to `notify` on every `UpDevice`, both at startup and in `up_client_device_added`, and to UpClient's `device-added` and `device-removed` (GCC 50.0 L418–428, L1470–1479). libupower-glib's `UpDevice` wraps a GDBus proxy, so D-Bus `org.freedesktop.DBus.Properties.PropertiesChanged` on `/org/freedesktop/UPower/devices/battery_*` becomes `notify::charge-threshold-enabled`.
- Settings does not filter which property changed. Every percentage or rate update re-runs `up_client_changed()` and rebuilds the battery list.
- For an extension, the equivalent is to watch `g-properties-changed` on a proxy for each battery and react only to `ChargeThresholdEnabled` and `ChargeThresholdSupported`. It should also watch UPower's `DeviceAdded` and `DeviceRemoved` signals.
- Since UPower 1.90.10 (!281) `charge-threshold-enabled` is also copied to `/org/freedesktop/UPower/devices/DisplayDevice`. On the dev machine DisplayDevice has `ChargeThresholdEnabled = true` but `ChargeThresholdSupported = false` and `ChargeThresholdSettingsSupported = 0`. So DisplayDevice cannot be used to decide visibility. It is also not a `UpDeviceBattery`, so `EnableChargeThreshold` is not wired up there; do not call it on DisplayDevice. (Settings never does.)

## 6. Differences across GNOME 48, 49 and 50

### GNOME Settings

| Version | Change |
|---|---|
| 48.0 | Feature introduced: commit 513bf8995 "power: Add support for battery charge limiting" (first tag containing it: 48.alpha). Requires `upower-glib >= 1.90.6`. |
| 49 (main, May 2025) | Ported to Blueprint (1bbd7ab1e). No behaviour change. |
| 48.7, 49.5, 50.beta and later | **Fix for an infinite loop with several batteries** (c3d0aefca on main, backported as ec9534825 to 48.7 and b62dbd988 to 49.5). Without it, choosing Maximize Charge on a two-battery laptop (T470) made Settings flip `EnableChargeThreshold` true and false forever. Each partial `notify` re-set the radio, which re-fired the callback. The fix blocks the callback while it syncs the radio from UPower state. |

Otherwise the read, write and visibility logic is identical in 48.0 and 50.x.

### UPower

GNOME does not pin a UPower version, and distros pair them differently. Approximate pairings:

| UPower | Date | Relevant change |
|---|---|---|
| 1.90.5 | 2024-08 | Charge threshold support (!208): `EnableChargeThreshold`, `ChargeThresholdEnabled/Supported`, `ChargeStart/EndThreshold`, polkit action. |
| 1.90.6 | 2024-09 | Default hwdb threshold 75–80. **The minimum for GNOME Settings 48+.** |
| 1.90.7–1.90.9 | 2025-01 to 04 | Around GNOME 48. No API change. |
| 1.90.10 | 2025-08 | Around GNOME 49. **`ChargeThresholdSettingsSupported` added.** `charge_types` / Long_Life support. `charge-threshold-enabled` copied to DisplayDevice. |
| 1.91.0–1.91.1 | 2025-11 to 2026-02 | Around GNOME 50 (dev machine: 1.91.1). No charge-API change. |
| 1.91.2 | 2026-04 | Support for hardware with only `charge_control_end_threshold` (!310), so more machines report Supported. |
| 1.91.3 | 2026-07 | Prefer Standard over Fast when the limit is off. State file created with safe permissions (19dabb1). Asus detection fix. |
| 1.91.5 | 2026-10 | Prefer live sysfs threshold values over hwdb `CHARGE_LIMIT` (!346), so Start and End values can change. |

Consequence: on UPower older than 1.90.10, reading `ChargeThresholdSettingsSupported` fails because the property does not exist. An extension that matches Settings uses only `ChargeThresholdSupported` and `ChargeThresholdEnabled`, which exist on every UPower that GNOME 48+ Settings accepts.

## Implications for the extension (input for the map)

- To match Settings exactly:
  - Visible when any `Type==2 && PowerSupply && ChargeThresholdSupported` battery exists.
  - Lit (Preserve Battery Health) when any such battery has `ChargeThresholdEnabled`.
  - On switch, call `EnableChargeThreshold(b)` on each such battery.
- Use async calls and surface errors. Settings swallows them, but a Quick Settings toggle should snap back and probably notify.
- Don't re-trigger writes from property-change handlers. That is the 48/49 multi-battery loop bug.
- UPower keeps a single global persisted flag, so "mixed" states across batteries only last for a moment, or until a reboot re-applies the global flag.
