// Builds the preferences window outside GNOME Shell and prints its rows, so prefs.js can be
// checked without installing the extension. See docs/agents/gnome-shell-testing.md.
//
//   GI_TYPELIB_PATH=/usr/lib/gnome-shell/girepository-1.0 LD_LIBRARY_PATH=/usr/lib/gnome-shell \
//   GSETTINGS_BACKEND=memory gjs -m scripts/prefs-smoke.js EXT_DIR
//
// EXT_DIR holds prefs.js, metadata.json and schemas/gschemas.compiled (glib-compile-schemas
// --targetdir=EXT_DIR/schemas src/schemas).
import Gio from 'gi://Gio';

// ExtensionPreferences lives in the Extensions app's resource, not in GJS.
Gio.resources_register(Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource'));

const {default: Adw} = await import('gi://Adw?version=1');
const {ExtensionPreferences} = await import('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js');

Adw.init();
const dir = Gio.File.new_for_path(ARGV[0]);
const [, bytes] = dir.get_child('metadata.json').load_contents(null);
const metadata = {...JSON.parse(new TextDecoder().decode(bytes)), path: dir.get_path(), dir};
const {default: Prefs} = await import(dir.get_child('prefs.js').get_uri());
const prefs = new Prefs(metadata);
// Outside the app no extension manager knows the extension, so gettext's lookup fails.
ExtensionPreferences.lookupByURL = () => prefs;

const window = new Adw.PreferencesWindow();
prefs.fillPreferencesWindow(window);

function rows(widget) {
    const found = [];
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
        found.push(...(child instanceof Adw.ActionRow ? [child] : rows(child)));
    return found;
}

for (const row of rows(window)) {
    let value = `value=${row.value}`;
    if (row instanceof Adw.ComboRow) value = `selected=${row.selected}`;
    else if (row instanceof Adw.SwitchRow) value = `active=${row.active}`;
    print(`${row.constructor.name} "${row.title}" ${value} sensitive=${row.sensitive}`);
}
