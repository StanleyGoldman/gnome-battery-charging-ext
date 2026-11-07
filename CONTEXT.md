# Battery Charging

A GNOME Shell extension that switches how a laptop's battery charges from Quick Settings, using the same setting as GNOME Settings' Power page.

## Language

**Battery Charging**:
The setting that decides how a laptop battery charges: to full, or held below full to slow its wear. It names the setting, never the act of a battery currently charging.
_Avoid_: Charge limit, charge threshold (UPower's internal names), battery mode

**Maximize Charge**:
The Battery Charging mode that lets the battery charge to full.
_Avoid_: Full charge, normal, off

**Preserve Battery Health**:
The Battery Charging mode that holds the battery below full to slow its wear.
_Avoid_: Limited, conservation mode, on

**Supporting battery**:
A laptop battery that powers the machine and whose firmware lets UPower limit its charge. Peripheral batteries (mouse, headset) never are.
_Avoid_: Battery (when the distinction matters), device

**Top-bar icon**:
The icon the extension shows in the top bar while Preserve Battery Health is on, the way Power Mode shows one for its own mode.
_Avoid_: Tray icon, notification icon (notifications are the Full-battery action's), status icon

**Full**:
A supporting battery that has finished charging to the top while in Maximize Charge. The machine is Full when every supporting battery is; with none, it isn't. A battery in Preserve Battery Health is never Full, however charged.
_Avoid_: Fully charged (UPower's narrower state, which Full includes), charged

**Full-battery action**:
The extension's own setting for what happens once the battery has stayed Full for a set wait: **Off** (nothing), **Notify** (offer to switch to Preserve Battery Health) or **Switch automatically** (switch to Preserve Battery Health). Off is the default.
_Avoid_: Full-charge action, auto-switch, when fully charged (the prefs window's label, not the term)
