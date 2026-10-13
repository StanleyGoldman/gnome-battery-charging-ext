// The Battery Charging model: what the toggle shows, worked out from UPower.
// No GNOME Shell imports, so it runs under plain `gjs -m` for the unit tests.
//
// It takes a UPower interface:
//   running                    whether UPower is on the bus now
//   enumerate()                Promise of {displayDeviceType, devices}
//   setChargeThreshold(path, enabled)  Promise, settled when UPower replies
//   connect(signal, callback)  returns an id for disconnect(id). Signals:
//     'appeared', 'vanished'           UPower started or stopped
//     'device-added' (device)
//     'device-removed' (path)
//     'device-changed' (path, propertyNames)  D-Bus names, e.g. 'ChargeThresholdEnabled'
// A device is {path, nativePath, type, powerSupply, chargeThresholdSupported,
// chargeThresholdEnabled}, its properties kept current by the interface.

import GObject from 'gi://GObject';

const DEVICE_TYPE_BATTERY = 2;
const DEVICE_TYPE_UPS = 3;

// English for now; translation comes with #24.
const BATTERY_CHARGING = 'Battery Charging';
const MAXIMIZE_CHARGE = 'Maximize Charge';
const PRESERVE_BATTERY_HEALTH = 'Preserve Battery Health';
const SHORT_MAXIMIZE = 'Maximize';
const SHORT_PRESERVE = 'Preserve';
const ACCESSIBLE_NAME = '%s: %s';
const FAILED_TITLE = 'Could not change %s';
const FAILED_BODY = 'Switching to %s is not allowed.';
const FAILED_BODY_ONE = 'Switching to %s is not allowed for one battery (%s).';
const FAILED_BODY_SOME = 'Switching to %s is not allowed for %s batteries (%s).';

function format(template, ...args) {
    return template.replace(/%s/g, () => args.shift());
}

export const BatteryChargingModel = GObject.registerClass({
    Signals: {
        'changed': {},
        // The finished notification title and body.
        'failed': {param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING]},
    },
}, class BatteryChargingModel extends GObject.Object {
    constructor(upower) {
        super();
        this._upower = upower;
        this._devices = new Map(); // object path -> device
        this._poweredByUps = false;
        this._generation = 0;
        this._removedWhileLoading = null;
        this._click = 0; // counts switches; only the latest one's outcome counts
        this._pending = null; // the mode (true: Preserve) the latest click asked for, until its replies are in
        this._upowerIds = [
            upower.connect('appeared', () => this._load()),
            upower.connect('vanished', () => this._onVanished()),
            upower.connect('device-added', (device) => this._onDeviceAdded(device)),
            upower.connect('device-removed', (path) => this._onDeviceRemoved(path)),
            upower.connect('device-changed', (_path, names) => this._onDeviceChanged(names)),
        ];
        if (upower.running)
            this._load();
    }

    async _load() {
        const generation = ++this._generation;
        // A restart can arrive without UPower going away first.
        this._devices.clear();
        this._removedWhileLoading = new Set();
        let listing;
        try {
            listing = await this._upower.enumerate();
        } catch (e) {
            if (generation === this._generation)
                console.warn(`Battery Charging: could not list UPower devices: ${e.message}`);
            return;
        }
        const {displayDeviceType, devices} = listing;
        // UPower went away or restarted while this listing was in flight.
        if (generation !== this._generation)
            return;
        this._poweredByUps = displayDeviceType === DEVICE_TYPE_UPS;
        // Batteries added while the listing was in flight are already here;
        // ones removed meanwhile may still be in it.
        for (const device of devices) {
            if (!this._removedWhileLoading.has(device.path))
                this._devices.set(device.path, device);
        }
        this._removedWhileLoading = null;
        this.emit('changed');
    }

    _onVanished() {
        this._generation++;
        this._devices.clear();
        this.emit('changed');
    }

    _onDeviceAdded(device) {
        // Left as it is, even when its setting differs from the others' (#3).
        this._devices.set(device.path, device);
        this.emit('changed');
    }

    _onDeviceRemoved(path) {
        this._devices.delete(path);
        this._removedWhileLoading?.add(path);
        this.emit('changed');
    }

    _onDeviceChanged(propertyNames) {
        // Percentage and rate updates arrive constantly; only Battery Charging matters.
        if (propertyNames.some(name => name.startsWith('ChargeThreshold')))
            this.emit('changed');
    }

    get _supportingBatteries() {
        if (this._poweredByUps)
            return [];
        return [...this._devices.values()].filter(d =>
            d.type === DEVICE_TYPE_BATTERY && d.powerSupply && d.chargeThresholdSupported);
    }

    get visible() {
        return this._supportingBatteries.length > 0;
    }

    get lit() {
        if (this._pending !== null)
            return this._pending;
        return this._supportingBatteries.some(d => d.chargeThresholdEnabled);
    }

    get subtitle() {
        return this.lit ? SHORT_PRESERVE : SHORT_MAXIMIZE;
    }

    get accessibleName() {
        return format(ACCESSIBLE_NAME, BATTERY_CHARGING,
            this.lit ? PRESERVE_BATTERY_HEALTH : MAXIMIZE_CHARGE);
    }

    // Optimistic: shows the target mode until every reply to the latest click is in,
    // then follows UPower again. A superseded click's replies are ignored.
    async switchTo(preserve) {
        const click = ++this._click;
        const targets = this._supportingBatteries;
        this._pending = preserve;
        this.emit('changed');
        const results = await Promise.allSettled(
            targets.map(d => this._upower.setChargeThreshold(d.path, preserve)));
        if (click !== this._click || this._destroyed)
            return;
        this._pending = null;
        // A battery that vanished mid-switch has its error dropped.
        const failed = targets.filter((d, i) =>
            results[i].status === 'rejected' && this._devices.has(d.path));
        failed.forEach(d => console.warn(`Battery Charging: switching ${d.nativePath} failed`));
        this.emit('changed');
        if (failed.length > 0)
            this._reportFailure(preserve, failed, targets.length);
    }

    _reportFailure(preserve, failed, total) {
        const mode = preserve ? PRESERVE_BATTERY_HEALTH : MAXIMIZE_CHARGE;
        let body;
        if (total === 1 || failed.length === total)
            body = format(FAILED_BODY, mode);
        else if (failed.length === 1)
            body = format(FAILED_BODY_ONE, mode, failed[0].nativePath);
        else
            body = format(FAILED_BODY_SOME, mode, String(failed.length),
                failed.map(d => d.nativePath).join(', '));
        this.emit('failed', format(FAILED_TITLE, BATTERY_CHARGING), body);
    }

    destroy() {
        this._destroyed = true;
        // A listing still in flight is dropped too.
        this._generation++;
        this._upowerIds.forEach(id => this._upower.disconnect(id));
        this._upowerIds = [];
    }
});
