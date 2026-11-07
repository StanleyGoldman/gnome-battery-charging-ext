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
//     'device-changed' (path, propertyNames)  D-Bus names, e.g. 'ChargeThresholdEnabled', 'State'
// and the strings from createStrings() in strings.js (docs/spec.md §6).
// A device is {path, nativePath, type, powerSupply, chargeThresholdSupported,
// chargeThresholdEnabled, state, percentage}, its properties kept current by the interface.

import GObject from 'gi://GObject';

const DEVICE_TYPE_BATTERY = 2;
const DEVICE_TYPE_UPS = 3;
const DEVICE_STATE_CHARGING = 1;
const DEVICE_STATE_FULLY_CHARGED = 4;

// GNOME Shell 50's "charged" battery-icon rule, for a battery with its limit off.
function isFull(device) {
    if (device.chargeThresholdEnabled) return false;
    return (
        device.state === DEVICE_STATE_FULLY_CHARGED ||
        (device.state === DEVICE_STATE_CHARGING && device.percentage >= 100)
    );
}

export const BatteryChargingModel = GObject.registerClass(
    {
        Signals: {
            'changed': {},
            // allFull flipped.
            'full-changed': {},
            // A switch began; true when its target is Preserve Battery Health.
            'switch-started': {param_types: [GObject.TYPE_BOOLEAN]},
            // The finished notification title and body.
            'failed': {param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING]},
        },
    },
    // eslint-disable-next-line no-shadow -- registerClass names the GType after the class, so the names match.
    class BatteryChargingModel extends GObject.Object {
        constructor(upower, strings) {
            super();
            this._upower = upower;
            this._strings = strings;
            this._devices = new Map(); // object path -> device
            this._poweredByUps = false;
            this._generation = 0;
            this._removedWhileLoading = null;
            this._destroyed = false;
            this._click = 0; // counts switches; only the latest one's outcome counts
            this._pending = null; // the mode (true: Preserve) the latest click asked for, until its replies are in
            this._wasFull = false;
            this._upowerIds = [
                upower.connect('appeared', () => this._load()),
                upower.connect('vanished', () => this._onVanished()),
                upower.connect('device-added', device => this._onDeviceAdded(device)),
                upower.connect('device-removed', path => this._onDeviceRemoved(path)),
                upower.connect('device-changed', (_path, names) => this._onDeviceChanged(names)),
            ];
            if (upower.running) this._load();
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
            if (generation !== this._generation) return;
            this._poweredByUps = displayDeviceType === DEVICE_TYPE_UPS;
            // Batteries added while the listing was in flight are already here;
            // ones removed meanwhile may still be in it.
            for (const device of devices) {
                if (!this._removedWhileLoading.has(device.path)) this._devices.set(device.path, device);
            }
            this._removedWhileLoading = null;
            this.emit('changed');
            this._checkFull();
        }

        _onVanished() {
            this._generation++;
            // Replies to a switch in flight no longer say anything about the batteries.
            this._click++;
            this._pending = null;
            this._devices.clear();
            this.emit('changed');
            this._checkFull();
        }

        _onDeviceAdded(device) {
            // Left as it is, even when its setting differs from the others' (#3).
            this._devices.set(device.path, device);
            this.emit('changed');
            this._checkFull();
        }

        _onDeviceRemoved(path) {
            this._devices.delete(path);
            this._removedWhileLoading?.add(path);
            this.emit('changed');
            this._checkFull();
        }

        _onDeviceChanged(propertyNames) {
            // Rate and UpdateTime notices arrive constantly and are ignored. State and
            // Percentage feed Full only.
            const threshold = propertyNames.some(name => name.startsWith('ChargeThreshold'));
            if (threshold) this.emit('changed');
            if (threshold || propertyNames.includes('State') || propertyNames.includes('Percentage')) this._checkFull();
        }

        _checkFull() {
            const full = this.allFull;
            if (full === this._wasFull) return;
            this._wasFull = full;
            this.emit('full-changed');
        }

        get _supportingBatteries() {
            if (this._poweredByUps) return [];
            return [...this._devices.values()].filter(
                d => d.type === DEVICE_TYPE_BATTERY && d.powerSupply && d.chargeThresholdSupported
            );
        }

        get visible() {
            return this._supportingBatteries.length > 0;
        }

        get lit() {
            if (this._pending !== null) return this._pending;
            return this._supportingBatteries.some(d => d.chargeThresholdEnabled);
        }

        // A switch awaits its replies.
        get switching() {
            return this._pending !== null;
        }

        // Every supporting battery is Full; false with none.
        get allFull() {
            const batteries = this._supportingBatteries;
            return batteries.length > 0 && batteries.every(isFull);
        }

        get subtitle() {
            return this._strings.shortModeName(this.lit);
        }

        get accessibleName() {
            return this._strings.accessibleName(this.lit);
        }

        // Optimistic: shows the target mode until every reply to the latest click is in,
        // then follows UPower again. A superseded click's replies are ignored.
        // Resolves to 'switched', 'failed', or 'superseded' (by a later switch, UPower going
        // away, or destroy).
        async switchTo(preserve) {
            const click = ++this._click;
            const targets = this._supportingBatteries;
            this._pending = preserve;
            this.emit('switch-started', preserve);
            this.emit('changed');
            const results = await Promise.allSettled(
                targets.map(d => this._upower.setChargeThreshold(d.path, preserve))
            );
            if (click !== this._click || this._destroyed) return 'superseded';
            this._pending = null;
            // A battery that vanished mid-switch has its error dropped.
            const failed = targets.filter((d, i) => results[i].status === 'rejected' && this._devices.has(d.path));
            failed.forEach(d => console.warn(`Battery Charging: switching ${d.nativePath} failed`));
            this.emit('changed');
            if (failed.length > 0) {
                const present = targets.filter(d => this._devices.has(d.path)).length;
                this._reportFailure(preserve, failed, present);
                return 'failed';
            }
            return 'switched';
        }

        _reportFailure(preserve, failed, total) {
            // Naming the batteries only helps when some switched and some did not.
            const names = total === 1 || failed.length === total ? [] : failed.map(d => d.nativePath);
            this.emit('failed', this._strings.failedTitle(), this._strings.failedBody(preserve, names));
        }

        destroy() {
            this._destroyed = true;
            // A listing still in flight is dropped too.
            this._generation++;
            this._upowerIds.forEach(id => this._upower.disconnect(id));
            this._upowerIds = [];
        }
    }
);
