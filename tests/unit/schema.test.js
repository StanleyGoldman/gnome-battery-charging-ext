// The settings schema, compiled as `gnome-extensions install` compiles it, then read back
// through Gio: each key's default and range, per spec §5.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {test, assertEqual} from './harness.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.battery-charging';
const SCHEMA_DIR = GLib.build_filenamev([
    GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]),
    '..',
    '..',
    'src',
    'schemas',
]);

// Compiles src/schemas into a throwaway directory and looks the schema up there.
function loadSchema() {
    const target = GLib.dir_make_tmp('battery-charging-schema-XXXXXX');
    const proc = Gio.Subprocess.new(
        ['glib-compile-schemas', '--strict', `--targetdir=${target}`, SCHEMA_DIR],
        Gio.SubprocessFlags.STDERR_PIPE
    );
    const [, , stderr] = proc.communicate_utf8(null, null);
    if (!proc.get_successful()) throw new Error(`glib-compile-schemas failed: ${stderr}`);
    const source = Gio.SettingsSchemaSource.new_from_directory(target, null, false);
    const compiled = Gio.File.new_for_path(GLib.build_filenamev([target, 'gschemas.compiled']));
    compiled.delete(null);
    Gio.File.new_for_path(target).delete(null);
    const schema = source.lookup(SCHEMA_ID, false);
    if (!schema) throw new Error(`${SCHEMA_ID} not found in ${SCHEMA_DIR}`);
    return schema;
}

test('the schema lives at the extension path', () => {
    assertEqual(loadSchema().get_path(), '/org/gnome/shell/extensions/battery-charging/');
});

test('the schema has exactly the three Full-battery action keys and show-top-bar-icon', () => {
    assertEqual(loadSchema().list_keys().sort(), [
        'full-battery-action',
        'full-wait',
        'renotify-interval',
        'show-top-bar-icon',
    ]);
});

test('show-top-bar-icon is a boolean, true by default', () => {
    const key = loadSchema().get_key('show-top-bar-icon');
    assertEqual(key.get_value_type().dup_string(), 'b', 'type');
    assertEqual(key.get_default_value().unpack(), true, 'default');
});

test('full-battery-action defaults to off and offers off, notify and switch', () => {
    const key = loadSchema().get_key('full-battery-action');
    assertEqual(key.get_default_value().unpack(), 'off', 'default');
    const [kind, values] = key.get_range().recursiveUnpack();
    assertEqual(kind, 'enum', 'range kind');
    assertEqual(values, ['off', 'notify', 'switch'], 'nicks');
});

test('full-wait is minutes, 30 by default, 0 to 1440', () => {
    const key = loadSchema().get_key('full-wait');
    assertEqual(key.get_value_type().dup_string(), 'u', 'type');
    assertEqual(key.get_default_value().unpack(), 30, 'default');
    assertEqual(key.get_range().recursiveUnpack(), ['range', [0, 1440]], 'range');
});

test('renotify-interval is minutes, 60 by default, 0 to 1440', () => {
    const key = loadSchema().get_key('renotify-interval');
    assertEqual(key.get_value_type().dup_string(), 'u', 'type');
    assertEqual(key.get_default_value().unpack(), 60, 'default');
    assertEqual(key.get_range().recursiveUnpack(), ['range', [0, 1440]], 'range');
});
