// PROTOTYPE for issue #11: throwaway code, not the real extension.
//
// Talks to UPower on the system bus, or on the session bus when the shell was
// started with BATTERY_CHARGING_PROTO_BUS=session (see ../run-nested.sh and
// ../mock-upower.py). Every state change is logged with the "[battery-charging]"
// prefix so the full state is visible in the nested shell's output or the journal.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {PACKAGE_VERSION} from 'resource:///org/gnome/shell/misc/config.js';

const SHELL_MAJOR = parseInt(PACKAGE_VERSION.split('.')[0]);
const USE_SESSION_BUS = GLib.getenv('BATTERY_CHARGING_PROTO_BUS') === 'session';
// Variant knobs for #5's text question (see ../variants.sh).
const TITLE = GLib.getenv('BATTERY_CHARGING_PROTO_TITLE') || 'Battery Charging';
const COL_SPAN = parseInt(GLib.getenv('BATTERY_CHARGING_PROTO_COLSPAN') || '1');
const SHORT_SUBTITLES = GLib.getenv('BATTERY_CHARGING_PROTO_SHORT') === '1';

const UPOWER_NAME = 'org.freedesktop.UPower';
const UPOWER_PATH = '/org/freedesktop/UPower';
const DEVICE_KIND_BATTERY = 2;

const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.UPower">
    <method name="EnumerateDevices"><arg type="ao" direction="out"/></method>
    <signal name="DeviceAdded"><arg type="o"/></signal>
    <signal name="DeviceRemoved"><arg type="o"/></signal>
  </interface>
</node>`);

const DeviceProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="NativePath" type="s" access="read"/>
    <property name="Type" type="u" access="read"/>
    <property name="PowerSupply" type="b" access="read"/>
    <property name="ChargeThresholdSupported" type="b" access="read"/>
    <property name="ChargeThresholdEnabled" type="b" access="read"/>
    <method name="EnableChargeThreshold"><arg type="b" direction="in"/></method>
  </interface>
</node>`);

const MAXIMIZE_CHARGE = 'Maximize Charge';
const PRESERVE_BATTERY_HEALTH = 'Preserve Battery Health';

function log(msg) {
    console.log(`[battery-charging] ${msg}`);
}

const BatteryChargingToggle = GObject.registerClass(
class BatteryChargingToggle extends QuickMenuToggle {
    _init(extension) {
        const params = {title: TITLE};
        // 49+ only: an unknown construct property throws on 48.
        if (SHELL_MAJOR >= 49)
            params.menuButtonAccessibleName = 'Open battery charging menu';
        super._init(params);

        this._extension = extension;
        this._healthIcon = this._icon('battery-preserve-health-symbolic.svg');
        this._chargeIcon = this._icon('battery-maximize-charge-symbolic.svg');

        this._bus = USE_SESSION_BUS ? Gio.DBus.session : Gio.DBus.system;
        this._batteries = new Map(); // object path -> {proxy, changedId}
        this._pending = null; // target mode while EnableChargeThreshold calls are in flight
        this._cancellable = new Gio.Cancellable();

        this.menu.setHeader(this._healthIcon, 'Battery Charging');
        this._chargeItem = new PopupMenu.PopupImageMenuItem(MAXIMIZE_CHARGE, this._chargeIcon);
        this._chargeItem.connect('activate', () => this._switchTo(false));
        this.menu.addMenuItem(this._chargeItem);
        this._healthItem = new PopupMenu.PopupImageMenuItem(PRESERVE_BATTERY_HEALTH, this._healthIcon);
        this._healthItem.connect('activate', () => this._switchTo(true));
        this.menu.addMenuItem(this._healthItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addSettingsAction('Power Settings', 'gnome-power-panel.desktop');

        this.connect('clicked', () => this._switchTo(!this.checked));

        this.connect('destroy', () => this._onDestroy());
        this.visible = false;
        this._connectUPower();
    }

    _icon(file) {
        return Gio.FileIcon.new(this._extension.dir.get_child('icons').get_child(file));
    }

    _connectUPower() {
        log(`GNOME Shell ${PACKAGE_VERSION}, UPower on the ${USE_SESSION_BUS ? 'SESSION (mock)' : 'system'} bus`);
        this._upower = new UPowerProxy(this._bus, UPOWER_NAME, UPOWER_PATH, (proxy, error) => {
            if (error) {
                log(`UPower proxy failed: ${error.message}`);
                return;
            }
            this._upowerSignalIds = [
                this._upower.connectSignal('DeviceAdded', (_p, _s, [path]) => this._addBattery(path)),
                this._upower.connectSignal('DeviceRemoved', (_p, _s, [path]) => this._removeBattery(path)),
            ];
            this._ownerChangedId = this._upower.connect('notify::g-name-owner', () => this._onNameOwnerChanged());
            this._onNameOwnerChanged();
        }, this._cancellable, Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES);
    }

    async _onNameOwnerChanged() {
        for (const path of [...this._batteries.keys()])
            this._removeBattery(path, false);

        if (this._upower.g_name_owner === null) {
            log('UPower is not running');
            this._sync();
            return;
        }

        log(`UPower is running as ${this._upower.g_name_owner}`);
        try {
            const [paths] = await this._upower.EnumerateDevicesAsync();
            paths.forEach(p => this._addBattery(p, false));
        } catch (e) {
            log(`EnumerateDevices failed: ${e.message}`);
        }
        this._sync();
    }

    _addBattery(path, sync = true) {
        if (this._batteries.has(path))
            return;
        const proxy = new DeviceProxy(this._bus, UPOWER_NAME, path, (_p, error) => {
            if (error) {
                log(`Device proxy ${path} failed: ${error.message}`);
                return;
            }
            // Only read state here; never write from a property-change handler (#3).
            const changedId = proxy.connect('g-properties-changed', () => this._sync());
            this._batteries.set(path, {proxy, changedId});
            if (sync)
                log(`device added: ${path}`);
            this._sync();
        }, this._cancellable);
    }

    _removeBattery(path, sync = true) {
        const battery = this._batteries.get(path);
        if (!battery)
            return;
        battery.proxy.disconnect(battery.changedId);
        this._batteries.delete(path);
        if (sync) {
            log(`device removed: ${path}`);
            this._sync();
        }
    }

    _supportingBatteries() {
        return [...this._batteries.values()]
            .map(b => b.proxy)
            .filter(p => p.Type === DEVICE_KIND_BATTERY && p.PowerSupply && p.ChargeThresholdSupported);
    }

    async _switchTo(enabled) {
        const batteries = this._supportingBatteries();
        log(`switch to ${enabled ? PRESERVE_BATTERY_HEALTH : MAXIMIZE_CHARGE} on ${batteries.length} battery(ies)`);

        // Optimistic: show the target mode at once, then let UPower's state win.
        this._pending = enabled;
        this._sync();

        const results = await Promise.allSettled(
            batteries.map(p => p.EnableChargeThresholdAsync(enabled)));
        this._pending = null;

        const failures = results
            .map((r, i) => [r, batteries[i]])
            .filter(([r]) => r.status === 'rejected')
            .map(([r, p]) => `${p.NativePath || p.g_object_path}: ${r.reason.message}`);
        failures.forEach(f => log(`EnableChargeThreshold failed: ${f}`));

        // Snap back to whatever UPower now reports.
        this._sync();

        if (failures.length > 0) {
            Main.notifyError(
                `Could not switch to ${enabled ? PRESERVE_BATTERY_HEALTH : MAXIMIZE_CHARGE}`,
                failures.map(f => f.replace(/^GDBus\.Error:[^ ]+ /, '')).join('\n'));
        }
    }

    _sync() {
        const all = [...this._batteries.values()].map(b => b.proxy);
        const supporting = this._supportingBatteries();
        const upowerEnabled = supporting.some(p => p.ChargeThresholdEnabled);
        const preserve = this._pending ?? upowerEnabled;

        this.visible = supporting.length > 0;
        this.checked = preserve;
        if (SHORT_SUBTITLES)
            this.subtitle = preserve ? 'Preserve' : 'Maximize';
        else
            this.subtitle = preserve ? PRESERVE_BATTERY_HEALTH : MAXIMIZE_CHARGE;
        this.gicon = preserve ? this._healthIcon : this._chargeIcon;
        this._healthItem.setOrnament(preserve ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        this._chargeItem.setOrnament(preserve ? PopupMenu.Ornament.NONE : PopupMenu.Ornament.CHECK);

        const rows = all.map(p =>
            `  ${p.g_object_path} type=${p.Type} power-supply=${p.PowerSupply} ` +
            `supported=${p.ChargeThresholdSupported} enabled=${p.ChargeThresholdEnabled}`);
        log(`state: visible=${this.visible} checked=${this.checked} pending=${this._pending} ` +
            `supporting=${supporting.length}/${all.length}\n${rows.join('\n')}`);
    }

    _onDestroy() {
        // Without this, UPower signals keep calling _sync() on the disposed toggle
        // after disable(). Hooked to the 'destroy' signal, not a destroy() override:
        // at shutdown the shell destroys the toggle from C, which skips the override.
        this._cancellable.cancel();
        this._upowerSignalIds?.forEach(id => this._upower.disconnectSignal(id));
        if (this._ownerChangedId)
            this._upower.disconnect(this._ownerChangedId);
        for (const path of [...this._batteries.keys()])
            this._removeBattery(path, false);
    }
});

const BatteryChargingIndicator = GObject.registerClass(
class BatteryChargingIndicator extends SystemIndicator {
    _init(extension) {
        super._init();
        const toggle = new BatteryChargingToggle(extension);

        // Like Power Mode on 50+: a top-bar icon only while the toggle is lit.
        if (SHELL_MAJOR >= 50) {
            const indicator = this._addIndicator();
            indicator.gicon = toggle._healthIcon;
            toggle.bind_property('checked', indicator, 'visible', GObject.BindingFlags.SYNC_CREATE);
        }

        this.quickSettingsItems.push(toggle);
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class BatteryChargingPrototype extends Extension {
    enable() {
        this._indicator = new BatteryChargingIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator, COL_SPAN);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}
