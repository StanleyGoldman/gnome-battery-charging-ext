// Takes the README screenshots inside a headless GNOME Shell, run by
// scripts/screenshots.sh against the mock UPower. Writes PNGs to $BATTERY_CHARGING_TEST_OUT.
//
// The test tool's run() hook can stall headless, so this starts from run() or from a
// fallback timer, whichever comes first (docs/agents/gnome-shell-testing.md).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const OUT = GLib.getenv('BATTERY_CHARGING_TEST_OUT') ?? '/tmp';
const MARGIN = 12;

export const METRICS = {};

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

// Captures the screen area around ACTORS, plus a margin, to OUT/NAME.png.
async function shoot(name, actors) {
    let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const actor of actors) {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        [x1, y1] = [Math.min(x1, x), Math.min(y1, y)];
        [x2, y2] = [Math.max(x2, x + w), Math.max(y2, y + h)];
    }
    x1 = Math.max(0, Math.floor(x1 - MARGIN));
    y1 = Math.max(0, Math.floor(y1 - MARGIN));
    x2 = Math.min(global.stage.width, Math.ceil(x2 + MARGIN));
    y2 = Math.min(global.stage.height, Math.ceil(y2 + MARGIN));

    const stream = Gio.File.new_for_path(`${OUT}/${name}.png`)
        .replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot_area(x1, y1, x2 - x1, y2 - y1, stream);
    stream.close(null);
    console.log(`SCREENSHOT ${name}.png`);
}

async function takeScreenshots() {
    const quickSettings = Main.panel.statusArea.quickSettings;
    // NetworkManager is on the system bus, so the Wi-Fi tile would show the real network name.
    for (const item of quickSettings.menu._grid.get_children()) {
        if (item.constructor.name.startsWith('NM'))
            item.hide();
    }
    await waitFor('the toggle', () => findToggle()?.visible && findToggle().checked);
    const toggle = findToggle();

    // The top bar's right side, with the heart icon.
    quickSettings.menu.close();
    await Scripting.sleep(500);
    await shoot('top-bar', [quickSettings]);

    // Quick Settings, Preserve Battery Health on.
    quickSettings.menu.open();
    await Scripting.sleep(1000);
    await shoot('quick-settings', [quickSettings.menu.box]);

    // The toggle's menu.
    toggle.menu.open();
    await Scripting.sleep(1000);
    await shoot('menu', [quickSettings.menu.box]);
    toggle.menu.close();
    quickSettings.menu.close();
}

let started = null;

function startOnce() {
    started ??= (async () => {
        try {
            await Scripting.sleep(1500);
            await takeScreenshots();
        } catch (e) {
            console.log(`SCREENSHOT FAIL: ${e.message}\n${e.stack}`);
        }
        console.log('SCREENSHOTS DONE');
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
