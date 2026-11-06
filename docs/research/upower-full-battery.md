# What UPower reports when a battery is full

Research for issue #50 (part of map #49). Researched 2026-11-06.

**Sources** (all primary):

- UPower git at tag `v1.91.1` (the version on the dev machine), <https://gitlab.freedesktop.org/upower/upower/-/tree/v1.91.1>.
  Files: `src/up-constants.h`, `src/up-device-battery.c`, `src/linux/up-device-supply.c`,
  `src/linux/up-device-supply-battery.c`, `src/up-daemon.c`, `src/up-history.c`,
  `dbus/org.freedesktop.UPower.Device.xml`. (`UP` below.)
- gnome-shell git at tag `50.1`: `js/ui/status/system.js`,
  <https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/50.1/js/ui/status/system.js>.
- gnome-settings-daemon git at tag `50.0`: `plugins/power/gsd-power-manager.c`,
  <https://gitlab.gnome.org/GNOME/gnome-settings-daemon/-/blob/50.0/plugins/power/gsd-power-manager.c>.
- gnome-control-center git at tag `50.0`: `panels/power/cc-battery-row.c`,
  <https://gitlab.gnome.org/GNOME/gnome-control-center/-/blob/50.0/panels/power/cc-battery-row.c>.
- Read-only inspection of the dev machine (Lenovo Legion Pro 7 16IAX10H, GNOME Shell 50.1, UPower 1.91.1):
  `upower -d`, `gdbus introspect` and `gdbus monitor --system --dest org.freedesktop.UPower` (75 s),
  `/sys/class/power_supply/{BAT0,ADP0}/uevent`, `/var/lib/upower/history-charge-*.dat`, `journalctl --list-boots`.
  Battery Charging was on (Preserve Battery Health) throughout; nothing was changed.

Each point is marked **Fact** (read in source or observed) or **Inference** (reasoned from facts, not observed).

## Answer

- **Use the battery device's `State == FullyCharged` (4) as "full".** UPower already folds the common firmware
  quirks into it: kernel `status` `Full` maps to FullyCharged, and `Not charging` (PendingCharge) at **≥ 90 %**
  is rewritten to FullyCharged. `Percentage == 100` is not a reliable signal on its own.
- **Optionally also accept `State == Charging && Percentage >= 100`**, which is exactly the extra rule GNOME
  Shell's own battery icon uses to show "charged".
- **"Full" must be gated on `ChargeThresholdEnabled == false`.** With the threshold on and an end threshold ≥ 90 %,
  UPower reports FullyCharged too (the PendingCharge quirk does not look at the threshold).
- **Watch per-battery `g-properties-changed` and filter by key.** The battery device emits every ~30 s (always
  `UpdateTime`, plus whatever changed). `DisplayDevice` emits only on real changes but is an aggregate.
- **Unplug is fast and visible on the battery itself.** An `Online` change on line power makes UPower re-read all
  batteries at once and fast-poll (1 s for 5 s); the battery goes to Discharging. `Online` is not needed.
- **UPower gives no "full since" time.** The timeout must start when the extension sees the transition (or when
  it starts and finds the battery already full).

## 1. The `State` values and how UPower derives them

**Fact.** `State` enum (`UP dbus/org.freedesktop.UPower.Device.xml`): 0 Unknown, 1 Charging, 2 Discharging,
3 Empty, 4 Fully charged, 5 Pending charge, 6 Pending discharge.

**Fact.** On Linux, `up_device_supply_get_state` maps the kernel's `power_supply` `status` string one to one
([`src/linux/up-device-supply.c` L171–198](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/linux/up-device-supply.c#L171)):
`Charging` → Charging, `Discharging` → Discharging, `Full` → FullyCharged, `Empty` → Empty,
`Not charging` → PendingCharge, `Unknown`/empty → Unknown.

**Fact.** Then two rewrites happen before the value is published
([`src/linux/up-device-supply-battery.c` L520–529](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/linux/up-device-supply-battery.c#L520),
[`src/up-device-battery.c` L370–382](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/up-device-battery.c#L370)):

1. Any state other than FullyCharged becomes **Discharging** if `current_now < 0`.
2. **Unknown** with `Percentage >= UP_FULLY_CHARGED_THRESHOLD` becomes **FullyCharged** (and `< 1 %` becomes Empty).
3. "QUIRK: Some devices keep reporting PENDING_CHARGE even when full": **PendingCharge** with
   `Percentage >= UP_FULLY_CHARGED_THRESHOLD` becomes **FullyCharged**.

**Fact.** `UP_FULLY_CHARGED_THRESHOLD` is **90 %**
([`src/up-constants.h` L37](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/up-constants.h#L37)).

**Fact.** There is no rewrite for **Charging** at 100 %: if the kernel keeps saying `Charging`, UPower keeps
publishing Charging.

**Fact.** `Percentage` comes from sysfs `capacity` (an integer on this machine), clamped to 0–100. Only when
`capacity` is missing does UPower compute it from `energy_now / energy_full`, which gives a fractional value
([`up-device-supply-battery.c` L512–518](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/linux/up-device-supply-battery.c#L512),
[`up-device-battery.c` L311–313](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/up-device-battery.c#L311)).

## 2. Firmware that stops at 95–99 % with the threshold off

**Inference from §1** (not observed on this machine, which reaches 100 %):

| Kernel `status` at the stop point | UPower `State` | Full by `State`? |
|---|---|---|
| `Full` | FullyCharged | yes |
| `Not charging` (≥ 90 %) | FullyCharged (quirk) | yes |
| `Unknown` (≥ 90 %) | FullyCharged | yes |
| `Charging` (stuck) | Charging | **no**, and `Percentage == 100` never holds either |

So `State == FullyCharged` covers every firmware that admits it has stopped. The stuck-`Charging` case cannot be
detected by either signal; GNOME Shell does not detect it either (§5).

**Fact (dev machine).** In UPower's charge history, the battery reached 100 % on 2026-11-03 at 13:41 with state
`charging`, and on 2026-11-05 (next boot) at 100 % with state `fully-charged`. The history file only records a row
when the **percentage** changes (`up_history_set_charge_data` returns early if `percentage_last == percentage`,
[`src/up-history.c` L765–787](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/up-history.c#L765)),
so it does **not** show when or whether the state turned FullyCharged during the first boot. It does show that a
battery can sit at `Percentage == 100` while `State` is still Charging for at least a while.

## 3. With Preserve Battery Health on

**Fact (dev machine).** Battery Charging on; this Lenovo implements it through `charge_types` = `Long_Life`
(`ChargeThresholdSettingsSupported = 4`, `ChargeStartThreshold = ChargeEndThreshold = 0`). The battery holds at
80–82 % with kernel `status` = `Not charging`, and UPower publishes `State = 5` (PendingCharge),
`Percentage = 82`, `ChargeThresholdEnabled = true`. History shows `80 % pending-charge` on three boots.

**Inference from §1.** On hardware with `charge_control_end_threshold` ≥ 90 (user-set or vendor default), the
quirk turns `Not charging` into **FullyCharged while Preserve Battery Health is on**. The feature must therefore
decide "full" as `State == FullyCharged && ChargeThresholdEnabled == false`, not on `State` alone.

**Fact.** `ChargeEndThreshold` is 0 on this machine, so the end threshold cannot be read on charge-type hardware.

## 4. Change notifications over D-Bus

**Fact.** UPower polls each battery every `UP_DAEMON_SHORT_TIMEOUT` = 30 s, or 5 s when it lacks a rate estimate
while charging/discharging, or 1 s for 5 s after a line-power change or an Unknown state
([`up-constants.h` L29–33](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/up-constants.h#L29),
[`up-device-battery.c` L185–228](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/up-device-battery.c#L185)).
It also refreshes on kernel uevents for the battery.

**Fact.** Every poll sets `UpdateTime`, so the battery object emits `PropertiesChanged` about every 30 s even when
nothing else changed. The signal carries only the changed properties. Observed (75 s, battery idle at 82 %):

```
battery_BAT0: PropertiesChanged ('org.freedesktop.UPower.Device', {'UpdateTime': <uint64 1793983114>}, @as [])
battery_BAT0: PropertiesChanged ('org.freedesktop.UPower.Device', {'UpdateTime': <uint64 1793983144>, 'Voltage': <16.898>}, @as [])
```

While charging or discharging, `Percentage`, `Energy`, `EnergyRate`, `TimeToFull/Empty` change too. A
`Gio.DBusProxy` emits `g-properties-changed` with the same changed-keys dict, so a handler can check for `State`
(and `Percentage`) in it and ignore the rest.

**Fact.** `DisplayDevice` is recomputed from all batteries and only updated (including `UpdateTime`) when one of
its aggregate fields actually changes ([`src/up-daemon.c` L321–350](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/up-daemon.c#L321));
no DisplayDevice signal arrived during the 75 s capture. Its `State` is FullyCharged only if **every** power-supply
battery is FullyCharged; any Charging/Discharging/PendingCharge battery wins
([`up-daemon.c` L213–243](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/up-daemon.c#L213)).
With one battery the two agree.

**Inference.** The extension already holds per-battery proxies and acts per battery (the threshold is per
battery), so it should read `State` on those, not on `DisplayDevice`. The current `DeviceProxy` interface in
`src/upower.js` declares no `State` or `Percentage`, so they must be added.

## 5. Unplug, replug, and `Online`

**Fact.** When a line-power device's `online` changes, the daemon re-reads all battery devices immediately with
reason `UP_REFRESH_LINE_POWER` ([`up-daemon.c` L944–951](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/up-daemon.c#L944)),
and that reason starts 1 s fast polling for 5 s (§4). So on unplug the battery's `State` leaves FullyCharged
(normally to Discharging) within about a second.

**Fact.** The battery's state never consults AC for its own value; only `DisplayDevice` infers from AC when its
state is Unknown (on AC: ≥ 90 % → FullyCharged, else Charging) ([`up-daemon.c` L285–305](https://gitlab.freedesktop.org/upower/upower/-/blob/v1.91.1/src/up-daemon.c#L285)).

**Inference.** On replug of a nearly full battery, many firmwares do not restart charging (they wait for a lower
start point), so `State` goes straight back to FullyCharged or PendingCharge→FullyCharged. The "full" timer would
then restart at replug. Watching the battery's `State` alone gives the unplug/replug edges; `Online` is not needed.
A machine with several adapters (this one has three line-power devices) makes `Online` awkward anyway.

## 6. How GNOME decides "fully charged"

**Fact.** GNOME Shell's battery item (`PowerToggle._sync` in `system.js` @ 50.1, L70–105) reads only
`DisplayDevice` and updates on every `g-properties-changed`:

```js
const fillLevel = 10 * Math.floor(this._proxy.Percentage / 10);
const charged =
    this._proxy.State === UPower.DeviceState.FULLY_CHARGED ||
    (this._proxy.State === UPower.DeviceState.CHARGING && fillLevel === 100);
```

`charged` picks the `battery-level-100-charged-symbolic` icon. PendingCharge with `ChargeThresholdEnabled` picks
the `-plugged-in` icon instead.

**Fact.** gnome-settings-daemon's power plugin (50.0) never looks at FullyCharged or PendingCharge. It reacts only
to `warning-level` (low/critical/action notifications). GNOME has no "battery full" notification today.

**Fact.** GNOME Settings' battery row (`cc-battery-row.c` @ 50.0) labels FullyCharged "Fully charged" and
PendingCharge "Not charging". (Possible strings to borrow for the notification; see the map's Translations note.)

## 7. When did the battery become full?

**Fact.** No property records when the state changed: `UpdateTime` is "the point in time that data was read from
the power source", refreshed on every poll. `GetHistory("charge", …)` only stores percentage changes (§2).

**Inference.** The timeout starts when the extension first sees FullyCharged: on the transition, or at enable /
login / UPower restart if the battery is already full. After resume, UPower re-reads batteries (`UP_REFRESH_RESUME`),
so a state change during suspend arrives on resume. Whether time asleep counts towards the timeout depends on
the clock the timer uses (GLib timeouts use the monotonic clock); that belongs to the timing ticket.
