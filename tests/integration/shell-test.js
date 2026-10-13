// Integration tests 1 to 7 (docs/spec.md §7), run inside a headless GNOME
// Shell by tests/integration/run.sh. Tests 1 to 6 run in an English shell, test 7 in a
// German one ($BATTERY_CHARGING_TEST_PASS says which). The mock UPower is driven through its FIFO
// ($BATTERY_CHARGING_MOCK_FIFO) and logs to $BATTERY_CHARGING_MOCK_LOG.
// Results are logged as "INTEGRATION PASS|FAIL <name>"; run.sh reads them.
//
// The test tool's run() hook can stall headless, so the tests start from run() or
// from a fallback timer, whichever comes first (docs/agents/gnome-shell-testing.md).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {PACKAGE_VERSION} from 'resource:///org/gnome/shell/misc/config.js';

const UUID = 'battery-charging@stanleygoldman.github.io';
const OUT = GLib.getenv('BATTERY_CHARGING_TEST_OUT') ?? '/tmp';
const FIFO = GLib.getenv('BATTERY_CHARGING_MOCK_FIFO');
const PASS = GLib.getenv('BATTERY_CHARGING_TEST_PASS') ?? 'english';
const MOCK_LOG = GLib.getenv('BATTERY_CHARGING_MOCK_LOG');

export const METRICS = {};

function mock(command) {
    const stream = Gio.File.new_for_path(FIFO).append_to(Gio.FileCreateFlags.NONE, null);
    stream.write_all(`${command}\n`, null);
    stream.close(null);
}

function mockLog() {
    return new TextDecoder().decode(GLib.file_get_contents(MOCK_LOG)[1]);
}

async function waitFor(what, condition, timeoutMs = 8000) {
    for (let waited = 0; waited < timeoutMs; waited += 100) {
        if (condition())
            return;
        // eslint-disable-next-line no-await-in-loop
        await Scripting.sleep(100);
    }
    throw new Error(`timed out waiting for ${what}`);
}

function findToggle() {
    return Main.panel.statusArea.quickSettings.menu._grid.get_children()
        .find(c => c.constructor.name === 'BatteryChargingToggle');
}

// The top-bar icon exists on 50+ only; null when the toggle is gone.
function topBarIcon() {
    const indicator = Main.panel.statusArea.quickSettings._indicators.get_children()
        .find(c => c.constructor.name === 'BatteryChargingIndicator');
    return indicator?.get_children()[0] ?? null;
}

// The text of every label under an actor.
function menuTexts(actor) {
    const own = typeof actor.text === 'string' && actor.text !== '' ? [actor.text] : [];
    return own.concat(actor.get_children().flatMap(menuTexts));
}

function iconName(gicon) {
    return gicon?.get_file().get_basename();
}

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function assertToggle(toggle, {visible, checked}) {
    const subtitle = checked ? 'Preserve' : 'Maximize';
    const mode = checked ? 'Preserve Battery Health' : 'Maximize Charge';
    assert(toggle.visible === visible, `visible is ${toggle.visible}, expected ${visible}`);
    if (!visible)
        return;
    assert(toggle.checked === checked, `checked is ${toggle.checked}, expected ${checked}`);
    assert(toggle.subtitle === subtitle, `subtitle is "${toggle.subtitle}", expected "${subtitle}"`);
    assert(toggle.title === 'Battery', `title is "${toggle.title}"`);
    assert(toggle.accessible_name === `Battery Charging: ${mode}`,
        `accessible name is "${toggle.accessible_name}"`);
    const ticked = checked ? toggle.preserveItem : toggle.maximizeItem;
    const unticked = checked ? toggle.maximizeItem : toggle.preserveItem;
    assert(ticked._ornament === PopupMenu.Ornament.CHECK, 'the current mode is not ticked');
    assert(unticked._ornament === PopupMenu.Ornament.NONE, 'the other mode is ticked');
}

function assertTopBar(shown) {
    const icon = topBarIcon();
    if (parseInt(PACKAGE_VERSION) < 50)
        return;
    assert(icon !== null, 'no top-bar icon');
    assert(icon.visible === shown, `top-bar icon visible is ${icon.visible}, expected ${shown}`);
    if (shown)
        assert(iconName(icon.gicon) === 'battery-preserve-health-symbolic.svg',
            `top-bar icon is ${iconName(icon.gicon)}`);
}

async function screenshot(name) {
    const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot(false, stream);
    stream.close(null);
}

// Every test starts from one battery, Preserve Battery Health on.
function resetMock() {
    mock('return');
    mock('display-type 2');
    mock('remove BAT0');
    mock('add BAT0 enabled');
}

const ENGLISH_TESTS = [
    ['1 appears and shows state', async () => {
        await waitFor('the toggle', () => findToggle()?.visible);
        const toggle = findToggle();
        assertToggle(toggle, {visible: true, checked: true});
        assertTopBar(true);
    }],
    ['2 a click switches', async () => {
        const toggle = findToggle();
        const before = mockLog().length;
        toggle.emit('clicked', 1);
        await waitFor('EnableChargeThreshold(false)', () =>
            mockLog().slice(before).includes('EnableChargeThreshold(false) on BAT0'));
        await waitFor('the toggle to follow', () => !toggle.checked);
        assertToggle(toggle, {visible: true, checked: false});
        assertTopBar(false);

        toggle.preserveItem.emit('activate', null);
        await waitFor('the toggle to follow', () => toggle.checked);
        assertToggle(toggle, {visible: true, checked: true});
    }],
    ['3 an external change is followed', async () => {
        const toggle = findToggle();
        mock('disable BAT0');
        await waitFor('the toggle to follow', () => !toggle.checked);
        assertToggle(toggle, {visible: true, checked: false});
        assertTopBar(false);
        mock('enable BAT0');
        await waitFor('the toggle to follow', () => toggle.checked);
        assertToggle(toggle, {visible: true, checked: true});
        assertTopBar(true);
    }],
    ['4 a refused switch snaps back and notifies', async () => {
        const toggle = findToggle();
        mock('fail BAT0');
        toggle.emit('clicked', 1);
        await waitFor('the notification', () => Main.messageTray.getSources().some(src =>
            src.notifications.some(n => n.title === 'Could not change Battery Charging' &&
                n.body === 'Switching to Maximize Charge is not allowed.')));
        assertToggle(toggle, {visible: true, checked: true});
        mock('ok BAT0');
    }],
    ['5 UPower goes away and returns', async () => {
        const toggle = findToggle();
        mock('vanish');
        await waitFor('the toggle to hide', () => !toggle.visible);
        assertTopBar(false);
        // Changed while UPower is away: the toggle has to read it again on return.
        mock('disable BAT0');
        mock('return');
        await waitFor('the toggle to return', () => toggle.visible);
        await waitFor('the new state', () => !toggle.checked);
        assertToggle(toggle, {visible: true, checked: false});
        mock('enable BAT0');
        await waitFor('the toggle to follow', () => toggle.checked);
    }],
    ['6 disable and re-enable', async () => {
        const manager = Main.extensionManager;
        manager.disableExtension(UUID);
        await waitFor('the toggle to go', () => findToggle() === undefined);
        manager.enableExtension(UUID);
        await waitFor('the toggle to return', () => findToggle()?.visible);
        assertToggle(findToggle(), {visible: true, checked: true});
        // Let late D-Bus replies hit a disposed object, if any would; run.sh then
        // checks the log for Gjs-CRITICAL lines.
        manager.disableExtension(UUID);
        mock('disable BAT0');
        mock('enable BAT0');
        await Scripting.sleep(1000);
        manager.enableExtension(UUID);
        await waitFor('the toggle to return', () => findToggle()?.visible);
    }],
];

// Needs the German GNOME language pack (make check-deps).
const GERMAN_TESTS = [
    ['7 translations', async () => {
        await waitFor('the toggle', () => findToggle()?.visible);
        // setHeader() has no getter, so read the labels the menu shows.
        const texts = menuTexts(findToggle().menu.actor);
        assert(texts.includes('Batterieladung'), `menu header is not "Batterieladung": ${JSON.stringify(texts)}`);
    }],
];

const TESTS = PASS === 'german' ? GERMAN_TESTS : ENGLISH_TESTS;

async function runTests() {
    Main.panel.statusArea.quickSettings.menu.close();
    for (const [name, body] of TESTS) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await body();
            console.log(`INTEGRATION PASS ${name}`);
        } catch (e) {
            console.log(`INTEGRATION FAIL ${name}: ${e.message}\n${e.stack}`);
            // eslint-disable-next-line no-await-in-loop
            await screenshot(`failed-${name.replace(/\W+/g, '-')}`).catch(() => {});
        }
        resetMock();
        // eslint-disable-next-line no-await-in-loop
        await Scripting.sleep(500);
    }
}

let started = null;

function startOnce() {
    started ??= (async () => {
        try {
            await Scripting.sleep(1500);
            await runTests();
        } catch (e) {
            console.log(`INTEGRATION FAIL setup: ${e.message}\n${e.stack}`);
        }
        console.log('INTEGRATION DONE');
        // The test tool reads these keys after the shell exits; without them it
        // crashes and leaves a report in /var/crash.
        const perfOutput = GLib.getenv('SHELL_PERF_OUTPUT');
        if (perfOutput)
            GLib.file_set_contents(perfOutput,
                '{"events": [], "monitors": [], "metrics": [], "log": []}');
        global.context.terminate();
    })();
    return started;
}

export function init() {
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
        startOnce();
        return GLib.SOURCE_REMOVE;
    });
}

export async function run() {
    await startOnce();
}
