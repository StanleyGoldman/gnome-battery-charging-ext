import {test, assertEqual} from './harness.js';
import {settle} from './fakeUPower.js';

import {UPowerClient} from '../../src/upower.js';

const PATH = '/org/freedesktop/UPower/devices/battery_BAT0';
const DISPLAY = '/org/freedesktop/UPower/devices/DisplayDevice';

// A stand-in for a Gio.DBusProxy wrapper: just what UPowerClient touches.
class FakeProxy {
    constructor(props = {}) {
        Object.assign(this, props);
        this.signals = new Map();
        this.handlers = new Map();
        this._next = 1;
    }

    connectSignal(name, callback) {
        const id = this._next++;
        this.signals.set(id, {name, callback});
        return id;
    }

    disconnectSignal(id) {
        this.signals.delete(id);
    }

    connect(name, callback) {
        const id = this._next++;
        this.handlers.set(id, {name, callback});
        return id;
    }

    disconnect(id) {
        this.handlers.delete(id);
    }

    fire(name, ...args) {
        // D-Bus signal callbacks take (proxy, sender, args); property handlers (proxy, ...args).
        for (const h of [...this.signals.values()]) {
            if (h.name === name)
                h.callback(this, ':1.1', ...args);
        }
        for (const h of [...this.handlers.values()]) {
            if (h.name === name)
                h.callback(this, ...args);
        }
    }

    get listeners() {
        return this.signals.size + this.handlers.size;
    }
}

// A proxy factory whose requests resolve only when the test says so.
class FakeBus {
    constructor() {
        this.pending = []; // {kind, path, resolve, reject}
        this.upower = new FakeProxy({
            g_name_owner: ':1.1',
            EnumerateDevicesAsync: async () => [[PATH]],
        });
        this.newProxy = (kind, path) => new Promise((resolve, reject) =>
            this.pending.push({kind, path, resolve, reject}));
    }

    take(kind, path) {
        const i = this.pending.findIndex(r => r.kind === kind && r.path === path);
        return this.pending.splice(i, 1)[0];
    }

    resolve(kind, path, proxy) {
        this.take(kind, path).resolve(proxy);
    }
}

function devProxy(props = {}) {
    return new FakeProxy({
        NativePath: 'BAT0', Type: 2, PowerSupply: true,
        ChargeThresholdSupported: true, ChargeThresholdEnabled: false, ...props,
    });
}

async function readyClient(bus) {
    const client = new UPowerClient({newProxy: bus.newProxy});
    bus.resolve('upower', '/org/freedesktop/UPower', bus.upower);
    await settle();
    return client;
}

function record(client, ...signals) {
    const log = [];
    for (const s of signals)
        client.connect(s, (...args) => log.push([s, ...args.map(a => a?.path ?? a)]));
    return log;
}

test('a device added is reported once its proxy loads', async () => {
    const bus = new FakeBus();
    const client = await readyClient(bus);
    const log = record(client, 'device-added');
    bus.upower.fire('DeviceAdded', [PATH]);
    await settle();
    assertEqual(log, [], 'before load');
    bus.resolve('device', PATH, devProxy());
    await settle();
    assertEqual(log, [['device-added', PATH]], 'after load');
});

test('a device removed while its proxy loads is never reported', async () => {
    const bus = new FakeBus();
    const client = await readyClient(bus);
    const log = record(client, 'device-added', 'device-removed');
    bus.upower.fire('DeviceAdded', [PATH]);
    bus.upower.fire('DeviceRemoved', [PATH]);
    const proxy = devProxy();
    bus.resolve('device', PATH, proxy);
    await settle();
    assertEqual(log, [['device-removed', PATH]], 'signals');
    await client.setChargeThreshold(PATH, true).then(
        () => { throw new Error('expected a rejection'); },
        e => assertEqual(e.message, `${PATH} is gone`, 'switch error'));
    assertEqual(proxy.listeners, 0, 'listeners on the dropped proxy');
});

test('a device removed and re-added while loading is reported once, from the new proxy', async () => {
    const bus = new FakeBus();
    const client = await readyClient(bus);
    const log = record(client, 'device-added');
    bus.upower.fire('DeviceAdded', [PATH]);
    bus.upower.fire('DeviceRemoved', [PATH]);
    bus.upower.fire('DeviceAdded', [PATH]);
    bus.resolve('device', PATH, devProxy());
    bus.resolve('device', PATH, devProxy({NativePath: 'BAT1'}));
    await settle();
    assertEqual(log, [['device-added', PATH]], 'signals');
});

test('a device added twice while loading keeps one proxy', async () => {
    const bus = new FakeBus();
    const client = await readyClient(bus);
    bus.upower.fire('DeviceAdded', [PATH]);
    bus.upower.fire('DeviceAdded', [PATH]);
    const first = devProxy();
    const second = devProxy();
    bus.resolve('device', PATH, first);
    bus.resolve('device', PATH, second);
    await settle();
    assertEqual([first.listeners, second.listeners], [1, 0], 'listeners');
    client.destroy();
    assertEqual(first.listeners, 0, 'listeners after destroy');
});

test('a device whose proxy loads after UPower restarted is dropped', async () => {
    const bus = new FakeBus();
    const client = await readyClient(bus);
    const log = record(client, 'device-added', 'vanished', 'appeared');
    bus.upower.fire('DeviceAdded', [PATH]);
    bus.upower.g_name_owner = null;
    bus.upower.fire('notify::g-name-owner');
    bus.upower.g_name_owner = ':1.2';
    bus.upower.fire('notify::g-name-owner');
    bus.resolve('device', PATH, devProxy());
    await settle();
    assertEqual(log, [['vanished'], ['appeared']], 'signals');
});

test('enumerate skips a device removed while its proxy loads', async () => {
    const bus = new FakeBus();
    const client = await readyClient(bus);
    const listing = client.enumerate();
    await settle();
    bus.resolve('displayDevice', DISPLAY, devProxy({Type: 2}));
    await settle();
    bus.upower.fire('DeviceRemoved', [PATH]);
    bus.resolve('device', PATH, devProxy());
    assertEqual(await listing, {displayDeviceType: 2, devices: []}, 'listing');
});

test('enumerate reports a device that loads', async () => {
    const bus = new FakeBus();
    const client = await readyClient(bus);
    const listing = client.enumerate();
    await settle();
    bus.resolve('displayDevice', DISPLAY, devProxy({Type: 2}));
    await settle();
    bus.resolve('device', PATH, devProxy());
    const {devices} = await listing;
    assertEqual(devices.map(d => [d.path, d.nativePath, d.chargeThresholdSupported]),
        [[PATH, 'BAT0', true]], 'devices');
});

test('a device whose proxy fails to load is skipped without breaking enumerate', async () => {
    const bus = new FakeBus();
    const client = await readyClient(bus);
    const listing = client.enumerate();
    await settle();
    bus.resolve('displayDevice', DISPLAY, devProxy({Type: 2}));
    await settle();
    bus.take('device', PATH).reject(new Error('boom'));
    assertEqual((await listing).devices, [], 'devices');
});

test('destroy while a device proxy loads reports nothing', async () => {
    const bus = new FakeBus();
    const client = await readyClient(bus);
    const log = record(client, 'device-added');
    bus.upower.fire('DeviceAdded', [PATH]);
    client.destroy();
    const proxy = devProxy();
    bus.resolve('device', PATH, proxy);
    await settle();
    assertEqual(log, [], 'signals');
    assertEqual(proxy.listeners, 0, 'listeners');
});

test('a changed device reports the changed property names', async () => {
    const bus = new FakeBus();
    const client = await readyClient(bus);
    const log = [];
    client.connect('device-changed', (path, names) => log.push([path, names]));
    bus.upower.fire('DeviceAdded', [PATH]);
    const proxy = devProxy();
    bus.resolve('device', PATH, proxy);
    await settle();
    proxy.fire('g-properties-changed', {deepUnpack: () => ({ChargeThresholdEnabled: true})});
    assertEqual(log, [[PATH, ['ChargeThresholdEnabled']]], 'signals');
});
