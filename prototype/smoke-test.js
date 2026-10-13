// PROTOTYPE for issue #11: headless smoke test, run by ./smoke-test.sh.
// Opens Quick Settings, screenshots the toggle, clicks it, opens its menu and
// screenshots again. Screenshots go to $BATTERY_CHARGING_PROTO_OUT.
//
// The test tool's run() hook only fires once gnome-shell-perf-helper registers
// on the bus, and on this machine (50.1, headless) that sometimes never happens.
// So the test starts from run() or from a fallback timer, whichever comes first.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const OUT = GLib.getenv('BATTERY_CHARGING_PROTO_OUT') ?? '/tmp';

export const METRICS = {};

async function screenshot(name) {
    const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot(false, stream);
    stream.close(null);
    console.log(`SMOKE screenshot ${file.get_path()}`);
}

function findToggle() {
    const qs = Main.panel.statusArea.quickSettings;
    return qs.menu._grid.get_children().find(c => c.title === 'Battery Charging');
}

function report(toggle, label) {
    console.log(`SMOKE ${label}: visible=${toggle.visible} checked=${toggle.checked} ` +
        `subtitle="${toggle.subtitle}"`);
}

let started = null;

// Runs the smoke test once, from whichever arrives first.
function startOnce() {
    started ??= (async () => {
        try {
            await smoke();
        } catch (e) {
            console.log(`SMOKE FAILED: ${e.message}\n${e.stack}`);
        }
    })();
    return started;
}

export function init() {
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
        console.log('SMOKE run() hook never fired; starting from the fallback timer');
        startOnce().then(() => {
            // The test tool reads these keys from this file after the shell exits;
            // without them it crashes (and leaves an apport report in /var/crash).
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

async function smoke() {
    await Scripting.sleep(1500);
    const toggle = findToggle();
    if (!toggle)
        throw new Error('Battery Charging toggle not found in the Quick Settings grid');
    report(toggle, 'start');

    Main.panel.statusArea.quickSettings.menu.open();
    await Scripting.sleep(800);
    report(toggle, 'opened');
    await screenshot('1-maximize-charge');

    toggle.emit('clicked', 1);
    await Scripting.sleep(800);
    report(toggle, 'after click');
    await screenshot('2-preserve-battery-health');

    toggle.menu.open();
    await Scripting.sleep(800);
    await screenshot('3-menu');
    toggle.menu.close();
    Main.panel.statusArea.quickSettings.menu.close();
    await Scripting.sleep(500);
    await screenshot('4-top-bar');
}
