import {test, assertEqual} from './harness.js';
import {DeviceState, FULL, FakeUPower, battery, settle} from './fakeUPower.js';
import {FakeClock} from './fakeClock.js';

import {BatteryChargingModel} from '../../src/model.js';
import {FullBatteryAction} from '../../src/fullBattery.js';
import {createStrings} from '../../src/strings.js';

const MINUTE = 60000;

const english = createStrings({
    _: s => s,
    ngettext: (one, many, n) => (n === 1 ? one : many),
    dgettext: (_domain, msgid) => msgid,
});

// One supporting battery (Full unless said otherwise), the model, the action and its
// clock, and a record of what the action reported.
async function setUp({devices = [battery(FULL)], action = 'switch', fullWait = 30, renotifyInterval = 60} = {}) {
    const upower = new FakeUPower({devices});
    // Replies to switches change the battery, as UPower does.
    const set = upower.setChargeThreshold.bind(upower);
    upower.setChargeThreshold = (path, enabled) =>
        set(path, enabled).then(() => {
            const device = upower.devices.find(d => d.path === path);
            if (device && device.chargeThresholdEnabled !== enabled)
                upower.change(device, {chargeThresholdEnabled: enabled});
        });
    const model = new BatteryChargingModel(upower, english);
    await settle();
    const clock = new FakeClock();
    const settings = {action, fullWait, renotifyInterval};
    const fullBattery = new FullBatteryAction(model, english, clock, settings);
    const switched = [];
    fullBattery.connect('switched', (_a, title) => switched.push(title));
    // The Notify notification's life: each post or re-show, with its buttons, and each withdrawal.
    const notifications = [];
    fullBattery.connect('post-notification', (_a, title, body, remindLater) =>
        notifications.push({at: clock.now(), title, body, remindLater})
    );
    fullBattery.connect('withdraw-notification', () => notifications.push('withdrawn'));
    return {upower, model, clock, fullBattery, switched, notifications, bat: devices[0]};
}

// Advances the clock, then lets the switch replies through.
async function advance(clock, ms) {
    clock.advance(ms);
    await settle();
}

test('Switch automatically switches to Preserve Battery Health once the wait is up', async () => {
    const {upower, clock, switched, bat} = await setUp({fullWait: 30});

    await advance(clock, 30 * MINUTE - 1);
    assertEqual(upower.setCalls, [], 'no switch before the wait is up');

    await advance(clock, 1);
    assertEqual(upower.setCalls, [[bat.path, true]], 'switch calls');
    assertEqual(switched, ['Switched to Preserve Battery Health'], 'notices');
});

test('Off never switches, however long the battery stays Full', async () => {
    const {upower, clock, switched} = await setUp({action: 'off', fullWait: 0});

    await advance(clock, 24 * 60 * MINUTE);

    assertEqual([upower.setCalls, switched, clock.pendingTimers], [[], [], 0], 'calls, notices, timers');
});

test('a break in Full cancels the wait, and the next Full starts a fresh one', async () => {
    const {upower, clock, bat} = await setUp({fullWait: 30});

    await advance(clock, 20 * MINUTE);
    upower.change(bat, {state: DeviceState.DISCHARGING, percentage: 99});
    await advance(clock, 20 * MINUTE);
    upower.change(bat, {state: DeviceState.FULLY_CHARGED, percentage: 100});
    await advance(clock, 30 * MINUTE - 1);
    assertEqual(upower.setCalls, [], 'no switch before a fresh wait is up');

    await advance(clock, 1);
    assertEqual(upower.setCalls, [[bat.path, true]], 'switch calls');
});

test('Full reached as Charging at 100 % starts the wait', async () => {
    const bat = battery({...FULL, state: DeviceState.CHARGING, percentage: 99});
    const {upower, clock} = await setUp({devices: [bat], fullWait: 10});

    upower.change(bat, {percentage: 100});
    await advance(clock, 10 * MINUTE);

    assertEqual(upower.setCalls, [[bat.path, true]], 'switch calls');
});

test('time spent suspended counts: after resume, a passed wait fires within a minute', async () => {
    const {upower, clock, bat} = await setUp({fullWait: 30});

    await advance(clock, 10 * MINUTE);
    // Suspended for two hours: wall time moves, the timers' clock doesn't.
    clock.jump(120 * MINUTE);
    await advance(clock, MINUTE);

    assertEqual(upower.setCalls, [[bat.path, true]], 'switch calls');
});

test('a wait shortened below the time already spent Full fires at once', async () => {
    const {upower, clock, fullBattery, bat} = await setUp({fullWait: 30});

    await advance(clock, 20 * MINUTE);
    fullBattery.update({action: 'switch', fullWait: 15, renotifyInterval: 60});
    assertEqual(upower.setCalls, [], 'not inside the settings handler');
    await advance(clock, 0);

    assertEqual(upower.setCalls, [[bat.path, true]], 'switch calls');
});

test('a wait lengthened mid-wait counts the time already spent Full', async () => {
    const {upower, clock, fullBattery} = await setUp({fullWait: 30});

    await advance(clock, 20 * MINUTE);
    fullBattery.update({action: 'switch', fullWait: 45, renotifyInterval: 60});
    await advance(clock, 25 * MINUTE - 1);
    assertEqual(upower.setCalls.length, 0, 'switch calls before 45 minutes Full');
    await advance(clock, 1);
    assertEqual(upower.setCalls.length, 1, 'switch calls at 45 minutes Full');
});

test('an added battery that is not Full cancels the wait', async () => {
    const {upower, clock} = await setUp({fullWait: 30});

    await advance(clock, 20 * MINUTE);
    upower.add(battery());
    await advance(clock, 60 * MINUTE);

    assertEqual(upower.setCalls, [], 'switch calls');
});

test('removing the only battery that is not Full starts the wait', async () => {
    const charging = battery();
    const {upower, clock, bat} = await setUp({devices: [battery(FULL), charging], fullWait: 30});

    await advance(clock, 20 * MINUTE);
    upower.remove(charging);
    await advance(clock, 30 * MINUTE);

    assertEqual(upower.setCalls, [[bat.path, true]], 'switch calls');
});

test('with the wait at 0 the switch runs from a zero-delay timer, not the change handler', async () => {
    const bat = battery({...FULL, state: DeviceState.CHARGING, percentage: 99});
    const {upower, clock} = await setUp({devices: [bat], fullWait: 0});

    upower.change(bat, {percentage: 100});
    assertEqual(upower.setCalls, [], 'switch calls inside the change handler');
    await advance(clock, 0);

    assertEqual(upower.setCalls, [[bat.path, true]], 'switch calls');
});

test('a failed automatic switch posts the failure and is not retried until the next full charge', async () => {
    const {upower, model, clock, fullBattery, switched, bat} = await setUp({fullWait: 30});
    upower.failSets.add(bat.path);
    const failures = [];
    model.connect('failed', (_m, title, body) => failures.push([title, body]));

    await advance(clock, 30 * MINUTE);
    fullBattery.update({action: 'switch', fullWait: 5, renotifyInterval: 60});
    await advance(clock, 120 * MINUTE);
    assertEqual(upower.setCalls.length, 1, 'switch calls while still Full');
    assertEqual(
        failures,
        [['Could not change Battery Charging', 'Switching to Preserve Battery Health is not allowed.']],
        'failures'
    );
    assertEqual(switched, [], 'notices');

    upower.change(bat, {state: DeviceState.DISCHARGING, percentage: 99});
    upower.change(bat, {state: DeviceState.FULLY_CHARGED, percentage: 100});
    await advance(clock, 5 * MINUTE);
    assertEqual(upower.setCalls.length, 2, 'switch calls after the next full charge');
});

test('choosing Maximize Charge while Full overrides the action for this full charge', async () => {
    const {upower, model, clock, bat} = await setUp({fullWait: 30});

    await advance(clock, 10 * MINUTE);
    model.switchTo(false);
    await advance(clock, 120 * MINUTE);
    assertEqual(upower.setCalls, [[bat.path, false]], 'only the click');

    upower.change(bat, {state: DeviceState.DISCHARGING, percentage: 99});
    upower.change(bat, {state: DeviceState.FULLY_CHARGED, percentage: 100});
    await advance(clock, 30 * MINUTE);
    assertEqual(upower.setCalls.at(-1), [bat.path, true], 'the next full charge switches');
});

test('choosing Maximize Charge below full still lets the action fire once the battery fills', async () => {
    const bat = battery({chargeThresholdEnabled: true, state: DeviceState.CHARGING, percentage: 80});
    const {upower, model, clock} = await setUp({devices: [bat], fullWait: 30});

    model.switchTo(false);
    await settle();
    upower.change(bat, {state: DeviceState.FULLY_CHARGED, percentage: 100});
    await advance(clock, 30 * MINUTE);

    assertEqual(
        upower.setCalls,
        [
            [bat.path, false],
            [bat.path, true],
        ],
        'switch calls'
    );
});

test('a click on Preserve Battery Health supersedes the automatic switch: no notice, no flag', async () => {
    const {upower, model, clock, fullBattery, switched, bat} = await setUp({fullWait: 30});
    const failures = [];
    model.connect('failed', (_m, _t, body) => failures.push(body));
    upower.holdSets = true;
    upower.failSets.add(bat.path);

    await advance(clock, 30 * MINUTE);
    model.switchTo(true);
    upower.releaseSets();
    await settle();
    // Only the click's own refusal is reported.
    assertEqual([switched, failures.length], [[], 1], 'notices, failures');

    // The superseded switch set no flag, so the action is still live for this full charge.
    upower.failSets.clear();
    fullBattery.update({action: 'switch', fullWait: 30, renotifyInterval: 60});
    await advance(clock, 0);
    upower.releaseSets();
    await settle();
    assertEqual(upower.setCalls.length, 3, 'switch calls');
    assertEqual(switched, ['Switched to Preserve Battery Health'], 'notices');
});

test('a click on Maximize Charge while the automatic switch is in flight wins and overrides', async () => {
    const {upower, model, clock, switched, bat} = await setUp({fullWait: 30});
    const failures = [];
    model.connect('failed', (_m, _t, body) => failures.push(body));
    upower.holdSets = true;

    // The automatic switch is refused; the click goes through.
    upower.failSets.add(bat.path);
    await advance(clock, 30 * MINUTE);
    upower.failSets.clear();
    model.switchTo(false);
    upower.releaseSets();
    await settle();
    await advance(clock, 120 * MINUTE);

    assertEqual(
        upower.setCalls,
        [
            [bat.path, true],
            [bat.path, false],
        ],
        'switch calls'
    );
    assertEqual([switched, failures, model.lit], [[], [], false], 'notices, failures, lit');
});

test('UPower going away mid-switch ends the attempt; a later click overrides as usual', async () => {
    const {upower, model, clock, switched, bat} = await setUp({fullWait: 30});
    upower.holdSets = true;

    await advance(clock, 30 * MINUTE);
    upower.vanish();
    upower.appear({devices: [bat]});
    await settle();
    upower.releaseSets();
    await settle();
    // Full again after UPower came back: a fresh wait, which a Maximize Charge click overrides.
    model.switchTo(false);
    upower.releaseSets();
    await advance(clock, 120 * MINUTE);

    assertEqual(
        upower.setCalls,
        [
            [bat.path, true],
            [bat.path, false],
        ],
        'switch calls'
    );
    assertEqual(switched, [], 'notices');
});

const settingsFor = (action, fullWait = 30, renotifyInterval = 60) => ({action, fullWait, renotifyInterval});

test('changing to Off cancels the wait, and changing back starts a fresh one', async () => {
    const {upower, clock, fullBattery} = await setUp({fullWait: 30});

    await advance(clock, 20 * MINUTE);
    fullBattery.update(settingsFor('off'));
    await advance(clock, 20 * MINUTE);
    assertEqual([upower.setCalls.length, clock.pendingTimers], [0, 0], 'switch calls, timers while Off');

    fullBattery.update(settingsFor('switch'));
    await advance(clock, 30 * MINUTE - 1);
    assertEqual(upower.setCalls.length, 0, 'switch calls before a fresh wait is up');
    await advance(clock, 1);
    assertEqual(upower.setCalls.length, 1, 'switch calls');
});

test('a switch already in flight finishes after the action changes to Off', async () => {
    const {upower, clock, fullBattery, switched} = await setUp({fullWait: 30});
    upower.holdSets = true;

    await advance(clock, 30 * MINUTE);
    fullBattery.update(settingsFor('off'));
    upower.releaseSets();
    await settle();

    assertEqual(switched, ['Switched to Preserve Battery Health'], 'notices');
});

test('changing from Notify to Switch automatically keeps the time spent Full', async () => {
    const {upower, clock, fullBattery} = await setUp({action: 'notify', fullWait: 30});

    await advance(clock, 40 * MINUTE);
    fullBattery.update(settingsFor('switch'));
    await advance(clock, 0);

    assertEqual(upower.setCalls.length, 1, 'switch calls');
});

test('changing between Notify and Switch automatically clears the flag', async () => {
    const {upower, model, clock, fullBattery, bat} = await setUp({fullWait: 30});

    model.switchTo(false);
    await advance(clock, 40 * MINUTE);
    fullBattery.update(settingsFor('notify'));
    fullBattery.update(settingsFor('switch'));
    await advance(clock, 0);

    assertEqual(
        upower.setCalls,
        [
            [bat.path, false],
            [bat.path, true],
        ],
        'switch calls'
    );
});

test('Notify does not switch', async () => {
    const {upower, clock} = await setUp({action: 'notify', fullWait: 30});

    await advance(clock, 120 * MINUTE);

    assertEqual(upower.setCalls, [], 'switch calls');
});

test('destroy cancels the wait, stops following the model, and reports nothing afterwards', async () => {
    const {upower, clock, fullBattery, switched} = await setUp({fullWait: 30});

    fullBattery.destroy();
    await advance(clock, 120 * MINUTE);
    assertEqual([upower.setCalls, clock.pendingTimers], [[], 0], 'switch calls, timers');

    const again = await setUp({fullWait: 0});
    again.upower.holdSets = true;
    await advance(again.clock, 0);
    again.fullBattery.destroy();
    again.upower.releaseSets();
    await settle();
    assertEqual([switched, again.switched], [[], []], 'notices');
});

test('when a Preserve Battery Health click that superseded the automatic switch fails, the action picks up again', async () => {
    const {upower, model, clock, switched, bat} = await setUp({fullWait: 30});
    upower.holdSets = true;
    upower.failSets.add(bat.path);

    await advance(clock, 30 * MINUTE);
    model.switchTo(true);
    upower.releaseSets();
    await settle();
    // Both were refused and the battery is still Full: the wait has passed, so it fires.
    upower.failSets.clear();
    await advance(clock, 0);
    upower.releaseSets();
    await settle();

    assertEqual(upower.setCalls.length, 3, 'switch calls');
    assertEqual(switched, ['Switched to Preserve Battery Health'], 'notices');
});

// Notify (docs/spec.md §5).

const NOTIFY_NOTIFICATION = {
    title: 'Battery Fully Charged',
    body: 'Switch to Preserve Battery Health to slow battery wear.',
    remindLater: true,
};

test('Notify posts the notification once the wait is up, with both buttons', async () => {
    const {clock, notifications} = await setUp({action: 'notify', fullWait: 30});
    const start = clock.now();

    await advance(clock, 30 * MINUTE - 1);
    assertEqual(notifications, [], 'nothing before the wait is up');

    await advance(clock, 1);
    assertEqual(notifications, [{at: start + 30 * MINUTE, ...NOTIFY_NOTIFICATION}], 'notifications');
});

test('Notify shows the notification again every re-notify interval while Full', async () => {
    const {clock, notifications} = await setUp({action: 'notify', fullWait: 30, renotifyInterval: 60});
    const start = clock.now();

    await advance(clock, 30 * MINUTE + 180 * MINUTE);

    assertEqual(
        notifications.map(n => n.at - start),
        [30, 90, 150, 210].map(m => m * MINUTE),
        'shown at, after Full began'
    );
});

test('a re-notify interval changed mid-cycle counts the time since the last notification', async () => {
    const {clock, fullBattery, notifications} = await setUp({action: 'notify', fullWait: 30, renotifyInterval: 60});
    const start = clock.now();

    await advance(clock, 30 * MINUTE + 40 * MINUTE);
    fullBattery.update(settingsFor('notify', 30, 30));
    assertEqual(notifications.length, 1, 'not inside the settings handler');
    await advance(clock, 0);
    fullBattery.update(settingsFor('notify', 30, 90));
    await advance(clock, 90 * MINUTE);

    assertEqual(
        notifications.map(n => n.at - start),
        [30, 70, 160].map(m => m * MINUTE),
        'shown at, after Full began'
    );
});

test('the notification is withdrawn when Full breaks, and the next Full starts a fresh wait', async () => {
    const {upower, clock, notifications, bat} = await setUp({action: 'notify', fullWait: 30});
    const start = clock.now();

    await advance(clock, 40 * MINUTE);
    upower.change(bat, {state: DeviceState.DISCHARGING, percentage: 99});
    await advance(clock, 120 * MINUTE);
    upower.change(bat, {state: DeviceState.FULLY_CHARGED, percentage: 100});
    await advance(clock, 30 * MINUTE);

    assertEqual(
        notifications.map(n => (n === 'withdrawn' ? n : n.at - start)),
        [30 * MINUTE, 'withdrawn', 190 * MINUTE],
        'notifications'
    );
});

for (const [action, name] of [
    ['off', 'Off'],
    ['switch', 'Switch automatically'],
]) {
    test(`the notification is withdrawn when the action changes to ${name}`, async () => {
        const {clock, fullBattery, notifications} = await setUp({action: 'notify', fullWait: 30});

        await advance(clock, 40 * MINUTE);
        fullBattery.update(settingsFor(action));
        await advance(clock, 120 * MINUTE);

        assertEqual(notifications.slice(1), ['withdrawn'], 'notifications after the change');
    });
}

test('destroy withdraws the notification and ends the cycle', async () => {
    const {clock, fullBattery, notifications} = await setUp({action: 'notify', fullWait: 30});

    await advance(clock, 40 * MINUTE);
    fullBattery.destroy();
    await advance(clock, 120 * MINUTE);

    assertEqual([notifications.slice(1), clock.pendingTimers], [['withdrawn'], 0], 'notifications, timers');
});

test('a dismiss stops the reminders until the next full charge', async () => {
    const {upower, clock, fullBattery, notifications, bat} = await setUp({action: 'notify', fullWait: 30});
    const start = clock.now();

    await advance(clock, 40 * MINUTE);
    fullBattery.dismissed();
    await advance(clock, 300 * MINUTE);
    assertEqual(notifications.length, 1, 'notifications while still Full');

    upower.change(bat, {state: DeviceState.DISCHARGING, percentage: 99});
    upower.change(bat, {state: DeviceState.FULLY_CHARGED, percentage: 100});
    await advance(clock, 30 * MINUTE);
    // Dismissed, so nothing is out to withdraw when Full breaks.
    assertEqual(
        notifications.map(n => n.at - start),
        [30, 370].map(m => m * MINUTE),
        'shown at, after Full first began'
    );
});

test('Remind Me Later shows the notification again one interval after the click', async () => {
    const {clock, fullBattery, notifications} = await setUp({action: 'notify', fullWait: 30, renotifyInterval: 60});
    const start = clock.now();

    await advance(clock, 70 * MINUTE);
    fullBattery.remindLater();
    await advance(clock, 60 * MINUTE);

    // The closed notification isn't withdrawn: the shell already took it down.
    assertEqual(
        notifications.map(n => n.at - start),
        [30, 130].map(m => m * MINUTE),
        'shown at, after Full began'
    );
});

test('with the re-notify interval at 0, Notify posts once, without Remind Me Later', async () => {
    const {clock, notifications} = await setUp({action: 'notify', fullWait: 30, renotifyInterval: 0});

    await advance(clock, 24 * 60 * MINUTE);

    assertEqual(
        [notifications.map(n => n.remindLater), clock.pendingTimers],
        [[false], 0],
        'Remind Me Later per notification, timers'
    );
});

test('the Preserve Battery Health button switches, and the cycle ends', async () => {
    const {upower, model, clock, fullBattery, notifications, bat} = await setUp({action: 'notify', fullWait: 30});

    await advance(clock, 40 * MINUTE);
    fullBattery.preserve();
    await advance(clock, 300 * MINUTE);

    assertEqual([upower.setCalls, model.lit], [[[bat.path, true]], true], 'switch calls, lit');
    assertEqual([notifications.length, clock.pendingTimers], [1, 0], 'notifications, timers');
});

test('a failed Preserve Battery Health button carries on as Remind Me Later', async () => {
    const {upower, model, clock, fullBattery, notifications, bat} = await setUp({
        action: 'notify',
        fullWait: 30,
        renotifyInterval: 60,
    });
    const start = clock.now();
    upower.failSets.add(bat.path);
    const failures = [];
    model.connect('failed', (_m, title) => failures.push(title));

    await advance(clock, 40 * MINUTE);
    fullBattery.preserve();
    await settle();
    await advance(clock, 60 * MINUTE);

    assertEqual(failures, ['Could not change Battery Charging'], 'failures');
    assertEqual(
        notifications.map(n => n.at - start),
        [30, 100].map(m => m * MINUTE),
        'shown at, after Full began'
    );
});

test('a failed Preserve Battery Health button with the interval at 0 ends the cycle', async () => {
    const {upower, clock, fullBattery, notifications, bat} = await setUp({
        action: 'notify',
        fullWait: 30,
        renotifyInterval: 0,
    });
    upower.failSets.add(bat.path);

    await advance(clock, 40 * MINUTE);
    fullBattery.preserve();
    await advance(clock, 0);
    // Even a longer interval set afterwards brings no reminder this full charge.
    fullBattery.update(settingsFor('notify', 30, 60));
    await advance(clock, 300 * MINUTE);

    assertEqual([notifications.length, clock.pendingTimers], [1, 0], 'notifications, timers');
});

test('after a dismiss, changing to Switch automatically clears the flag and switches at once', async () => {
    const {upower, clock, fullBattery} = await setUp({action: 'notify', fullWait: 30});

    await advance(clock, 40 * MINUTE);
    fullBattery.dismissed();
    fullBattery.update(settingsFor('switch'));
    await advance(clock, 0);

    assertEqual(upower.setCalls.length, 1, 'switch calls');
});

test('changing from Switch automatically to Notify keeps the time spent Full', async () => {
    const {clock, fullBattery, notifications} = await setUp({action: 'switch', fullWait: 30});
    const start = clock.now();

    await advance(clock, 20 * MINUTE);
    fullBattery.update(settingsFor('notify'));
    await advance(clock, 10 * MINUTE);

    assertEqual(
        notifications.map(n => n.at - start),
        [30 * MINUTE],
        'shown at, after Full began'
    );
});

test('changing from Off to Notify starts a fresh wait', async () => {
    const {clock, fullBattery, notifications} = await setUp({action: 'off', fullWait: 30});
    const start = clock.now();

    await advance(clock, 40 * MINUTE);
    fullBattery.update(settingsFor('notify'));
    await advance(clock, 30 * MINUTE);

    assertEqual(
        notifications.map(n => n.at - start),
        [70 * MINUTE],
        'shown at, after Full began'
    );
});

test('a Maximize Charge click after the notification stops the reminders and leaves it out', async () => {
    const {upower, model, clock, notifications, bat} = await setUp({action: 'notify', fullWait: 30});

    await advance(clock, 40 * MINUTE);
    model.switchTo(false);
    await advance(clock, 300 * MINUTE);

    assertEqual(upower.setCalls, [[bat.path, false]], 'switch calls');
    assertEqual(notifications.length, 1, 'notifications');
});

test('changing to Notify while the automatic switch is in flight posts nothing if it succeeds', async () => {
    const {upower, clock, fullBattery, switched, notifications} = await setUp({action: 'switch', fullWait: 30});
    upower.holdSets = true;

    await advance(clock, 30 * MINUTE);
    fullBattery.update(settingsFor('notify'));
    await advance(clock, 0);
    upower.releaseSets();
    await settle();

    assertEqual([switched.length, notifications], [1, []], 'notices, notifications');
});

test('changing to Notify while the automatic switch is in flight notifies once it fails', async () => {
    const {upower, clock, fullBattery, notifications, bat} = await setUp({action: 'switch', fullWait: 30});
    upower.holdSets = true;
    upower.failSets.add(bat.path);

    await advance(clock, 30 * MINUTE);
    fullBattery.update(settingsFor('notify'));
    await advance(clock, 0);
    assertEqual(notifications, [], 'notifications while the switch is in flight');
    upower.releaseSets();
    await settle();
    await advance(clock, 0);

    assertEqual(notifications.length, 1, 'notifications');
});
