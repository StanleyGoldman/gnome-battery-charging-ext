import {test, assertEqual} from './harness.js';
import {DeviceType, FakeUPower, battery, settle} from './fakeUPower.js';

import {BatteryChargingModel} from '../../src/model.js';

async function modelFor(upower) {
    const model = new BatteryChargingModel(upower);
    await settle();
    return model;
}

test('a supporting battery makes the toggle visible', async () => {
    const model = await modelFor(new FakeUPower({devices: [battery()]}));
    assertEqual(model.visible, true, 'visible');
});

test('a peripheral battery is ignored', async () => {
    const model = await modelFor(new FakeUPower({devices: [battery({powerSupply: false})]}));
    assertEqual(model.visible, false, 'visible');
});

test('a battery whose firmware cannot hold its charge below full is ignored', async () => {
    const model = await modelFor(new FakeUPower({devices: [battery({chargeThresholdSupported: false})]}));
    assertEqual(model.visible, false, 'visible');
});

test('a power supply that is not a battery is ignored', async () => {
    const model = await modelFor(new FakeUPower({devices: [battery({type: DeviceType.UPS})]}));
    assertEqual(model.visible, false, 'visible');
});

test('a UPS display device means no supporting battery', async () => {
    const model = await modelFor(new FakeUPower({
        devices: [battery()],
        displayDeviceType: DeviceType.UPS,
    }));
    assertEqual(model.visible, false, 'visible');
});

test('a battery charging to full shows Maximize Charge', async () => {
    const model = await modelFor(new FakeUPower({devices: [battery({chargeThresholdEnabled: false})]}));
    assertEqual(model.lit, false, 'lit');
    assertEqual(model.subtitle, 'Maximize', 'subtitle');
    assertEqual(model.accessibleName, 'Battery Charging: Maximize Charge', 'accessible name');
});

test('a battery held below full shows Preserve Battery Health', async () => {
    const model = await modelFor(new FakeUPower({devices: [battery({chargeThresholdEnabled: true})]}));
    assertEqual(model.lit, true, 'lit');
    assertEqual(model.subtitle, 'Preserve', 'subtitle');
    assertEqual(model.accessibleName, 'Battery Charging: Preserve Battery Health', 'accessible name');
});

test('mixed batteries show lit: any battery held below full counts', async () => {
    const model = await modelFor(new FakeUPower({devices: [
        battery({chargeThresholdEnabled: false}),
        battery({chargeThresholdEnabled: true}),
    ]}));
    assertEqual(model.lit, true, 'lit');
    assertEqual(model.subtitle, 'Preserve', 'subtitle');
});

test('an ignored battery never lights the toggle', async () => {
    const model = await modelFor(new FakeUPower({devices: [
        battery({chargeThresholdEnabled: false}),
        battery({powerSupply: false, chargeThresholdEnabled: true}),
    ]}));
    assertEqual(model.lit, false, 'lit');
});

function countChanges(model) {
    const counter = {count: 0};
    model.connect('changed', () => counter.count++);
    return counter;
}

test('a change made elsewhere is followed at once', async () => {
    const bat = battery({chargeThresholdEnabled: false});
    const upower = new FakeUPower({devices: [bat]});
    const model = await modelFor(upower);
    const changes = countChanges(model);

    upower.change(bat, {chargeThresholdEnabled: true});

    assertEqual(changes.count, 1, 'changed emissions');
    assertEqual(model.lit, true, 'lit');
});

test('other property changes are ignored', async () => {
    const bat = battery();
    const upower = new FakeUPower({devices: [bat]});
    const model = await modelFor(upower);
    const changes = countChanges(model);

    upower.change(bat, {percentage: 57, energyRate: 12.5});

    assertEqual(changes.count, 0, 'changed emissions');
});

test('an added battery is followed', async () => {
    const upower = new FakeUPower({devices: []});
    const model = await modelFor(upower);
    const changes = countChanges(model);

    upower.add(battery({chargeThresholdEnabled: true}));

    assertEqual(changes.count, 1, 'changed emissions');
    assertEqual(model.visible, true, 'visible');
    assertEqual(model.lit, true, 'lit');
});

test('a removed battery is followed', async () => {
    const plain = battery({chargeThresholdEnabled: false});
    const held = battery({chargeThresholdEnabled: true});
    const upower = new FakeUPower({devices: [plain, held]});
    const model = await modelFor(upower);
    const changes = countChanges(model);

    upower.remove(held);
    assertEqual(changes.count, 1, 'changed emissions');
    assertEqual(model.lit, false, 'lit after the held battery left');

    upower.remove(plain);
    assertEqual(model.visible, false, 'visible after the last battery left');
});

test('the toggle hides while UPower is missing', async () => {
    const upower = new FakeUPower({devices: [battery()]});
    const model = await modelFor(upower);
    const changes = countChanges(model);

    upower.vanish();

    assertEqual(changes.count, 1, 'changed emissions');
    assertEqual(model.visible, false, 'visible');
});

test('when UPower returns, the batteries are enumerated again', async () => {
    const upower = new FakeUPower({devices: [battery()]});
    const model = await modelFor(upower);
    upower.vanish();

    upower.appear({devices: [battery({chargeThresholdEnabled: true})]});
    await settle();

    assertEqual(model.visible, true, 'visible');
    assertEqual(model.lit, true, 'lit');
});

test('starting while UPower is missing hides the toggle without enumerating', async () => {
    const upower = new FakeUPower({running: false});
    const model = await modelFor(upower);

    assertEqual(model.visible, false, 'visible');
    assertEqual(upower.enumerateCalls, 0, 'enumerate calls');
});

test('a listing that replies after UPower went away is dropped', async () => {
    const upower = new FakeUPower({devices: [battery()]});
    upower.holdEnumerate = true;
    const model = await modelFor(upower);

    upower.vanish();
    upower.releaseEnumerate();
    await settle();

    assertEqual(model.visible, false, 'visible');
});

test('a battery added while the listing is in flight is kept', async () => {
    const upower = new FakeUPower({devices: []});
    upower.holdEnumerate = true;
    const model = await modelFor(upower);

    upower.add(battery());
    upower.releaseEnumerate();
    await settle();

    assertEqual(model.visible, true, 'visible');
});

test('a battery removed while the listing is in flight stays gone', async () => {
    const bat = battery();
    const upower = new FakeUPower({devices: [bat]});
    upower.holdEnumerate = true;
    const model = await modelFor(upower);

    upower.remove(bat);
    upower.releaseEnumerate();
    await settle();

    assertEqual(model.visible, false, 'visible');
});

test('a failed listing leaves the toggle hidden', async () => {
    const upower = new FakeUPower({devices: [battery()]});
    upower.failEnumerate = true;
    const model = await modelFor(upower);

    assertEqual(model.visible, false, 'visible');
});

test('destroy stops following UPower', async () => {
    const upower = new FakeUPower({devices: [battery()]});
    const model = await modelFor(upower);

    model.destroy();

    assertEqual(upower.connectionCount, 0, 'connections left on UPower');
});

test('when UPower restarts without going away first, the old batteries are dropped', async () => {
    const upower = new FakeUPower({devices: [battery()]});
    const model = await modelFor(upower);

    upower.appear({devices: []});
    await settle();

    assertEqual(model.visible, false, 'visible');
});

test('threshold values and settings support are never read', async () => {
    const bat = battery({chargeThresholdEnabled: true});
    for (const name of ['chargeThresholdSettingsSupported', 'chargeStartThreshold', 'chargeEndThreshold']) {
        Object.defineProperty(bat, name, {
            get() {
                throw new Error(`${name} was read`);
            },
        });
    }
    const model = await modelFor(new FakeUPower({devices: [bat]}));

    assertEqual([model.visible, model.lit, model.subtitle], [true, true, 'Preserve'], 'visible, lit, subtitle');
});

test('switchTo applies the mode to every supporting battery and skips the rest', async () => {
    const first = battery();
    const second = battery();
    const peripheral = battery({powerSupply: false});
    const upower = new FakeUPower({devices: [first, second, peripheral]});
    const model = await modelFor(upower);
    model.switchTo(true);
    assertEqual(upower.setCalls, [[first.path, true], [second.path, true]], 'calls');
});

test('a switch shows the target mode at once, then follows UPower', async () => {
    const bat = battery();
    const upower = new FakeUPower({devices: [bat]});
    upower.holdSets = true;
    const model = await modelFor(upower);
    let changes = 0;
    model.connect('changed', () => changes++);
    model.switchTo(true);
    assertEqual([model.lit, model.subtitle, changes], [true, 'Preserve', 1], 'optimistic');
    upower.change(bat, {chargeThresholdEnabled: true});
    upower.releaseSets();
    await settle();
    assertEqual(model.lit, true, 'lit after reply');
    upower.change(bat, {chargeThresholdEnabled: false});
    assertEqual(model.lit, false, 'follows UPower again');
});

test('a refused switch snaps back and fails with the finished message', async () => {
    const bat = battery();
    const upower = new FakeUPower({devices: [bat]});
    upower.failSets.add(bat.path);
    upower.holdSets = true;
    const model = await modelFor(upower);
    const failures = [];
    model.connect('failed', (_m, title, body) => failures.push([title, body]));
    model.switchTo(true);
    assertEqual(model.lit, true, 'optimistic');
    upower.releaseSets();
    await settle();
    assertEqual(model.lit, false, 'snapped back');
    assertEqual(failures, [['Could not change Battery Charging',
        'Switching to Preserve Battery Health is not allowed.']], 'failures');
});

test('the message for Maximize Charge names that mode', async () => {
    const bat = battery({chargeThresholdEnabled: true});
    const upower = new FakeUPower({devices: [bat]});
    upower.failSets.add(bat.path);
    const model = await modelFor(upower);
    const failures = [];
    model.connect('failed', (_m, _t, body) => failures.push(body));
    model.switchTo(false);
    await settle();
    assertEqual(failures, ['Switching to Maximize Charge is not allowed.'], 'body');
    assertEqual(model.lit, true, 'snapped back');
});

test('a partial failure names the batteries that failed and keeps the others switched', async () => {
    const [a, b] = [battery(), battery()];
    const upower = new FakeUPower({devices: [a, b]});
    upower.failSets.add(b.path);
    const model = await modelFor(upower);
    const failures = [];
    model.connect('failed', (_m, _t, body) => failures.push(body));
    model.switchTo(true);
    upower.change(a, {chargeThresholdEnabled: true});
    await settle();
    assertEqual(failures, [`Switching to Preserve Battery Health is not allowed for one battery (${b.nativePath}).`], 'body');
    assertEqual(model.lit, true, 'a stays switched');
});

test('several failures are counted and named', async () => {
    const bats = [battery(), battery(), battery()];
    const upower = new FakeUPower({devices: bats});
    upower.failSets.add(bats[1].path);
    upower.failSets.add(bats[2].path);
    const model = await modelFor(upower);
    const failures = [];
    model.connect('failed', (_m, _t, body) => failures.push(body));
    model.switchTo(true);
    await settle();
    assertEqual(failures, [`Switching to Preserve Battery Health is not allowed for 2 batteries (${bats[1].nativePath}, ${bats[2].nativePath}).`], 'body');
});

test('when every battery refuses, the message names no device', async () => {
    const bats = [battery(), battery()];
    const upower = new FakeUPower({devices: bats});
    bats.forEach(b => upower.failSets.add(b.path));
    const model = await modelFor(upower);
    const failures = [];
    model.connect('failed', (_m, _t, body) => failures.push(body));
    model.switchTo(true);
    await settle();
    assertEqual(failures, ['Switching to Preserve Battery Health is not allowed.'], 'body');
});

test('an error from a battery that vanished mid-switch is dropped', async () => {
    const [a, b] = [battery(), battery()];
    const upower = new FakeUPower({devices: [a, b]});
    upower.failSets.add(b.path);
    upower.holdSets = true;
    const model = await modelFor(upower);
    const failures = [];
    model.connect('failed', (_m, _t, body) => failures.push(body));
    model.switchTo(true);
    upower.remove(b);
    upower.releaseSets();
    await settle();
    assertEqual(failures, [], 'no failure');
});

test('the last click wins: a superseded click never changes the display or notifies', async () => {
    const bat = battery();
    const upower = new FakeUPower({devices: [bat]});
    upower.holdSets = true;
    const model = await modelFor(upower);
    const failures = [];
    model.connect('failed', (_m, _t, body) => failures.push(body));
    upower.failSets.add(bat.path);
    model.switchTo(true);
    upower.failSets.clear();
    model.switchTo(false);
    assertEqual(model.lit, false, 'shows the latest click');
    // Replies arrive in order: the first (refused) one is superseded.
    upower._heldSets[0].run();
    await settle();
    assertEqual([model.lit, failures], [false, []], 'superseded reply ignored');
    upower.releaseSets();
    await settle();
    assertEqual([model.lit, failures], [false, []], 'after latest reply');
});

test('the toggle re-syncs only when the latest click\'s replies have all arrived', async () => {
    const [a, b] = [battery(), battery()];
    const upower = new FakeUPower({devices: [a, b]});
    upower.holdSets = true;
    const model = await modelFor(upower);
    model.switchTo(true);
    upower.change(a, {chargeThresholdEnabled: false});
    upower.releaseSets(a.path);
    await settle();
    assertEqual(model.lit, true, 'still optimistic with one reply outstanding');
    upower.releaseSets(b.path);
    await settle();
    assertEqual(model.lit, false, 'synced from UPower');
});
