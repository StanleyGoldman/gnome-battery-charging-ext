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
