// The UPower interface the model takes (see src/model.js), on D-Bus proxies.
// The bus is the system bus, or the session bus when BATTERY_CHARGING_UPOWER_BUS=session
// (the integration tests point it at a mock).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const NAME = 'org.freedesktop.UPower';
const PATH = '/org/freedesktop/UPower';
const DISPLAY_DEVICE_PATH = `${PATH}/devices/DisplayDevice`;

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

// The display device is read for its Type alone (the UPS rule); no state comes from it.
const DisplayDeviceProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Type" type="u" access="read"/>
  </interface>
</node>`);

function newProxy(Wrapper, bus, path, cancellable) {
    return new Promise((resolve, reject) => {
        new Wrapper(bus, NAME, path, (proxy, error) => {
            if (error)
                reject(error);
            else
                resolve(proxy);
        }, cancellable);
    });
}

export class UPowerClient {
    constructor() {
        this._bus = GLib.getenv('BATTERY_CHARGING_UPOWER_BUS') === 'session'
            ? Gio.DBus.session : Gio.DBus.system;
        this._cancellable = new Gio.Cancellable();
        this._handlers = new Map(); // id -> {signal, callback}
        this._nextId = 1;
        this._devices = new Map(); // object path -> {proxy, device, changedId}
        this._removals = new Map(); // object path -> times removed
        this._proxy = null;
        this._proxyIds = [];
        this._ownerChangedId = 0;

        new UPowerProxy(this._bus, NAME, PATH, (proxy, error) => {
            if (error) {
                if (!this._cancellable.is_cancelled())
                    console.warn(`Battery Charging: UPower proxy failed: ${error.message}`);
                return;
            }
            this._proxy = proxy;
            this._proxyIds = [
                proxy.connectSignal('DeviceAdded', (_p, _s, [path]) => this._addDevice(path)),
                proxy.connectSignal('DeviceRemoved', (_p, _s, [path]) => this._removeDevice(path)),
            ];
            this._ownerChangedId = proxy.connect('notify::g-name-owner', () => this._onOwnerChanged());
            if (this.running)
                this._emit('appeared');
        }, this._cancellable, Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES);
    }

    get running() {
        return this._proxy?.g_name_owner != null;
    }

    async enumerate() {
        if (!this._proxy)
            throw new Error('UPower client is not ready');
        const [paths] = await this._proxy.EnumerateDevicesAsync();
        const displayDevice = await newProxy(DisplayDeviceProxy, this._bus,
            DISPLAY_DEVICE_PATH, this._cancellable);
        const displayDeviceType = displayDevice.Type;
        const devices = [];
        for (const path of paths) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const entry = await this._deviceFor(path);
                if (entry)
                    devices.push(entry.device);
            } catch (e) {
                console.warn(`Battery Charging: could not read ${path}: ${e.message}`);
            }
        }
        return {displayDeviceType, devices};
    }

    setChargeThreshold(path, enabled) {
        const entry = this._devices.get(path);
        if (!entry)
            return Promise.reject(new Error(`${path} is gone`));
        return entry.proxy.EnableChargeThresholdAsync(enabled);
    }

    connect(signal, callback) {
        const id = this._nextId++;
        this._handlers.set(id, {signal, callback});
        return id;
    }

    disconnect(id) {
        this._handlers.delete(id);
    }

    destroy() {
        this._cancellable.cancel();
        this._handlers.clear();
        this._dropDevices();
        this._proxyIds.forEach(id => this._proxy.disconnectSignal(id));
        this._proxyIds = [];
        if (this._ownerChangedId)
            this._proxy.disconnect(this._ownerChangedId);
        this._ownerChangedId = 0;
        this._proxy = null;
    }

    _emit(signal, ...args) {
        for (const handler of [...this._handlers.values()]) {
            if (handler.signal === signal)
                handler.callback(...args);
        }
    }

    _onOwnerChanged() {
        this._dropDevices();
        this._emit(this.running ? 'appeared' : 'vanished');
    }

    _dropDevices() {
        for (const {proxy, changedId} of this._devices.values())
            proxy.disconnect(changedId);
        this._devices.clear();
    }

    // The tracked device for a path, creating its proxy first if needed.
    async _deviceFor(path) {
        const known = this._devices.get(path);
        if (known)
            return known;
        const owner = this._proxy.g_name_owner;
        const removals = this._removals.get(path);
        const proxy = await newProxy(DeviceProxy, this._bus, path, this._cancellable);
        // Removed, or UPower restarted, while the proxy was loading.
        if (this._cancellable.is_cancelled() || this._proxy.g_name_owner !== owner ||
            this._removals.get(path) !== removals)
            return null;
        if (this._devices.has(path))
            return this._devices.get(path);
        // The properties are read live from the proxy, which keeps them current.
        const device = {
            path,
            get nativePath() { return proxy.NativePath; },
            get type() { return proxy.Type; },
            get powerSupply() { return proxy.PowerSupply; },
            get chargeThresholdSupported() { return proxy.ChargeThresholdSupported; },
            get chargeThresholdEnabled() { return proxy.ChargeThresholdEnabled; },
        };
        const changedId = proxy.connect('g-properties-changed', (_p, changed) =>
            this._emit('device-changed', path, Object.keys(changed.deepUnpack())));
        const entry = {proxy, device, changedId};
        this._devices.set(path, entry);
        return entry;
    }

    async _addDevice(path) {
        try {
            const entry = await this._deviceFor(path);
            if (entry)
                this._emit('device-added', entry.device);
        } catch (e) {
            console.warn(`Battery Charging: could not read ${path}: ${e.message}`);
        }
    }

    _removeDevice(path) {
        this._removals.set(path, (this._removals.get(path) ?? 0) + 1);
        const entry = this._devices.get(path);
        if (entry) {
            entry.proxy.disconnect(entry.changedId);
            this._devices.delete(path);
        }
        this._emit('device-removed', path);
    }
}
