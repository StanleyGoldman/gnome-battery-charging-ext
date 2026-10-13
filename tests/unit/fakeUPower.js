// A fake of the UPower interface the model takes (see src/model.js).

export const DeviceType = {LINE_POWER: 1, BATTERY: 2, UPS: 3, MOUSE: 5};

let nextPath = 0;

export function battery(props = {}) {
    nextPath++;
    return {
        path: `/org/freedesktop/UPower/devices/battery_BAT${nextPath}`,
        nativePath: `BAT${nextPath}`,
        type: DeviceType.BATTERY,
        powerSupply: true,
        chargeThresholdSupported: true,
        chargeThresholdEnabled: false,
        ...props,
    };
}

export class FakeUPower {
    constructor({devices = [], displayDeviceType = DeviceType.BATTERY, running = true} = {}) {
        this.devices = devices;
        this.displayDeviceType = displayDeviceType;
        this.running = running;
        this.enumerateCalls = 0;
        // When true, enumerate() replies only on releaseEnumerate().
        this.holdEnumerate = false;
        this.failEnumerate = false;
        this._heldEnumerations = [];
        this.setCalls = []; // [path, enabled]
        this._handlers = new Map();
        this._nextId = 1;
    }

    // UPower interface

    enumerate() {
        this.enumerateCalls++;
        if (!this.running || this.failEnumerate)
            return Promise.reject(new Error('The name org.freedesktop.UPower is not owned'));
        const result = {
            displayDeviceType: this.displayDeviceType,
            devices: [...this.devices],
        };
        if (!this.holdEnumerate)
            return Promise.resolve(result);
        return new Promise(resolve => this._heldEnumerations.push(() => resolve(result)));
    }

    setChargeThreshold(path, enabled) {
        this.setCalls.push([path, enabled]);
        return Promise.resolve();
    }

    connect(signal, callback) {
        const id = this._nextId++;
        this._handlers.set(id, {signal, callback});
        return id;
    }

    disconnect(id) {
        this._handlers.delete(id);
    }

    // Test controls

    get connectionCount() {
        return this._handlers.size;
    }

    _emit(signal, ...args) {
        for (const handler of [...this._handlers.values()]) {
            if (handler.signal === signal)
                handler.callback(...args);
        }
    }

    releaseEnumerate() {
        this._heldEnumerations.splice(0).forEach(reply => reply());
    }

    add(device) {
        this.devices.push(device);
        this._emit('device-added', device);
    }

    remove(device) {
        this.devices = this.devices.filter(d => d !== device);
        this._emit('device-removed', device.path);
    }

    change(device, props) {
        Object.assign(device, props);
        const names = Object.keys(props).map(n => n[0].toUpperCase() + n.slice(1));
        this._emit('device-changed', device.path, names);
    }

    vanish() {
        this.running = false;
        this.devices = [];
        this._emit('vanished');
    }

    appear({devices = [], displayDeviceType = DeviceType.BATTERY} = {}) {
        this.running = true;
        this.devices = devices;
        this.displayDeviceType = displayDeviceType;
        this._emit('appeared');
    }
}

// Lets pending promise callbacks run.
export async function settle() {
    for (let i = 0; i < 10; i++)
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
}
