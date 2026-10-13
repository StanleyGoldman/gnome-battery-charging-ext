// PROTOTYPE for issue #11: scripted #7 / #8 scenarios, run by ./scenarios.sh.
// Drives the mock UPower through its command FIFO, clicks the toggle, and logs
// and screenshots each step. Same start/stop dance as smoke-test.js.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const OUT = GLib.getenv('BATTERY_CHARGING_PROTO_OUT') ?? '/tmp';
const FIFO = GLib.getenv('BATTERY_CHARGING_PROTO_MOCK_FIFO');

export const METRICS = {};

const qs = () => Main.panel.statusArea.quickSettings;
const toggle = () => qs().menu._grid.get_children().find(c => c.constructor.name === 'BatteryChargingToggle');
const indicator = () => qs()._indicators.get_children().find(c => c.constructor.name === 'BatteryChargingIndicator');

async function mock(cmd) {
    console.log(`SCENARIO   mock> ${cmd}`);
    const proc = Gio.Subprocess.new(['sh', '-c', 'printf "%s\\n" "$1" > "$2"', 'sh', cmd, FIFO],
        Gio.SubprocessFlags.NONE);
    await new Promise(resolve => proc.wait_async(null, () => resolve()));
    await Scripting.sleep(600);
}

async function click() {
    console.log('SCENARIO   click');
    toggle().emit('clicked', 1);
    await Scripting.sleep(300);
}

const seen = new Set();

async function shot(name) {
    const t = toggle();
    console.log(`SCENARIO   [${name}] toggle visible=${t.visible} checked=${t.checked} ` +
        `subtitle="${t.subtitle}" top-bar-icon=${indicator()?.visible}`);
    for (const source of Main.messageTray.getSources()) {
        for (const n of source.notifications) {
            if (seen.has(n))
                continue;
            seen.add(n);
            console.log(`SCENARIO   [${name}] NOTIFICATION "${n.title}": ${n.body}`);
        }
    }
    const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot(false, stream);
    stream.close(null);
}

function scenario(title) {
    console.log(`SCENARIO ${title}`);
}

let started = null;

function startOnce() {
    started ??= (async () => {
        try {
            await scenarios();
        } catch (e) {
            console.log(`SCENARIO FAILED: ${e.message}\n${e.stack}`);
        }
    })();
    return started;
}

export function init() {
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
        startOnce().then(() => {
            // See smoke-test.js: the test tool crashes without this file.
            const perfOutput = GLib.getenv('SHELL_PERF_OUTPUT');
            if (perfOutput)
                GLib.file_set_contents(perfOutput,
                    '{"events": [], "monitors": [], "metrics": [], "log": []}');
            global.context.terminate();
        });
        return GLib.SOURCE_REMOVE;
    });
}

export async function run() {
    await startOnce();
}

async function scenarios() {
    await Scripting.sleep(1500);
    qs().menu.open();
    await Scripting.sleep(800);

    // ---- #7: switching fails ----
    scenario('s01 baseline: one battery, limit off');
    await shot('s01-baseline');

    scenario('s02 refused, slow: BAT0 fails after 2 s');
    await mock('fail BAT0 Operation is not allowed.');
    await mock('delay 2');
    await click();
    await shot('s02a-refused-pending');
    await Scripting.sleep(2200);
    await shot('s02b-refused-snapped-back');
    qs().menu.close();
    await Scripting.sleep(800);
    await shot('s02c-refused-banner');
    qs().menu.open();
    await Scripting.sleep(800);
    await mock('ok BAT0');

    scenario('s03 slow success: 2 s reply');
    await click();
    await shot('s03a-slow-pending');
    await Scripting.sleep(2200);
    await shot('s03b-slow-done');

    scenario('s04 double click while the first switch is in flight');
    await click();
    await click();
    await shot('s04a-double-pending');
    await Scripting.sleep(4500);
    await shot('s04b-double-done');
    await mock('delay 0');

    scenario('s05 changed from outside (like GNOME Settings) while the panel is open');
    await mock('disable BAT0');
    await shot('s05a-outside-disable');
    await mock('enable BAT0');
    await shot('s05b-outside-enable');

    // ---- #8: several or changing batteries ----
    scenario('s06 second battery appears with its limit off (mixed state)');
    await mock('add BAT1');
    await shot('s06a-mixed');
    await click();
    await Scripting.sleep(500);
    await shot('s06b-mixed-after-click');

    scenario('s07 partial failure: BAT0 switches, BAT1 refuses');
    await mock('fail BAT1 Operation is not allowed.');
    await click();
    await Scripting.sleep(500);
    await shot('s07-partial-failure');
    await mock('ok BAT1');

    scenario('s08 unsupported and peripheral batteries appear');
    await mock('add BAT2 unsupported');
    await mock('add MOUSE0 peripheral');
    await shot('s08-ignored-batteries');

    scenario('s09 every supporting battery disappears');
    await mock('remove BAT0');
    await mock('remove BAT1');
    await shot('s09-no-supporting-battery');

    scenario('s10 supporting battery returns, then loses support, then regains it');
    await mock('add BAT0 enabled');
    await shot('s10a-back');
    await mock('support BAT0 off');
    await shot('s10b-support-off');
    await mock('support BAT0 on');
    await shot('s10c-support-on');

    scenario('s11 UPower goes away and comes back');
    await mock('vanish');
    await Scripting.sleep(500);
    await shot('s11a-upower-gone');
    await mock('return');
    await Scripting.sleep(1000);
    await shot('s11b-upower-back');

    scenario('s12 battery removed while a switch is in flight');
    await mock('delay 2');
    await click();
    await mock('remove BAT0');
    await Scripting.sleep(2000);
    await shot('s12-removed-mid-switch');

    qs().menu.close();
    await Scripting.sleep(500);
    scenario('done');
}
