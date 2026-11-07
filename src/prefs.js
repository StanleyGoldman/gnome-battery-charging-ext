// The preferences window: the Full-battery action and its two timings (spec §5).
// It runs in its own process and shares nothing with the shell side but the schema.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// The combo's rows, in the enum's order, so a row's position is the key's enum value.
const ACTIONS = ['off', 'notify', 'switch'];

const MAX_MINUTES = 1440;

function minutesRow(title, subtitle, step) {
    return new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({lower: 0, upper: MAX_MINUTES, step_increment: step, page_increment: 60}),
        numeric: true,
    });
}

export default class BatteryChargingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Keep the settings alive as long as the window: the bindings hold them weakly.
        window._settings = settings;

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup();
        page.add(group);
        window.add(page);

        const actionRow = new Adw.ComboRow({
            title: _('When Fully Charged'),
            model: Gtk.StringList.new([_('Do Nothing'), _('Notify'), _('Switch to Preserve Battery Health')]),
        });
        group.add(actionRow);

        const waitRow = minutesRow(
            _('Wait Before Acting'),
            _('Minutes the battery stays fully charged first; 0 acts at once'),
            5
        );
        group.add(waitRow);
        settings.bind('full-wait', waitRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const renotifyRow = minutesRow(_('Remind Every'), _('Minutes between notifications; 0 notifies once'), 5);
        group.add(renotifyRow);
        settings.bind('renotify-interval', renotifyRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        // An enum key won't bind() to `selected`, so sync the combo by hand, both ways.
        const syncAction = () => {
            const action = settings.get_enum('full-battery-action');
            if (actionRow.selected !== action) actionRow.selected = action;
            renotifyRow.sensitive = ACTIONS[action] === 'notify';
        };
        actionRow.connect('notify::selected', () => {
            if (actionRow.selected < ACTIONS.length && settings.get_enum('full-battery-action') !== actionRow.selected)
                settings.set_enum('full-battery-action', actionRow.selected);
        });
        settings.connect('changed::full-battery-action', syncAction);
        syncAction();
    }
}
