import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gettext from 'gettext';

import {Extension, gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {FullBatteryAction} from './fullBattery.js';
import {BatteryChargingModel} from './model.js';
import {createStrings} from './strings.js';
import {UPowerClient} from './upower.js';

const PRESERVE_ICON = 'battery-preserve-health-symbolic.svg';

function bundledIcon(extension, file) {
    return Gio.FileIcon.new(extension.dir.get_child('icons').get_child(file));
}

const BatteryChargingToggle = GObject.registerClass(
    // eslint-disable-next-line no-shadow -- registerClass names the GType after the class, so the names match.
    class BatteryChargingToggle extends QuickMenuToggle {
        constructor(extension, model, strings) {
            super({title: strings.title, menuButtonAccessibleName: model.accessibleName});

            this._model = model;
            this.preserveIcon = bundledIcon(extension, PRESERVE_ICON);
            this.maximizeIcon = bundledIcon(extension, 'battery-maximize-charge-symbolic.svg');

            this.menu.setHeader(this.preserveIcon, strings.batteryCharging);
            this._section = new PopupMenu.PopupMenuSection();
            this.maximizeItem = new PopupMenu.PopupImageMenuItem(strings.maximizeCharge, this.maximizeIcon);
            this.maximizeItem.connect('activate', () => model.switchTo(false));
            this._section.addMenuItem(this.maximizeItem);
            this.preserveItem = new PopupMenu.PopupImageMenuItem(strings.preserveBatteryHealth, this.preserveIcon);
            this.preserveItem.connect('activate', () => model.switchTo(true));
            this._section.addMenuItem(this.preserveItem);
            this.menu.addMenuItem(this._section);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addSettingsAction(strings.powerSettings, 'gnome-power-panel.desktop');

            // Clicking switches away from what the toggle shows.
            this.connect('clicked', () => model.switchTo(!model.lit));

            // Not a destroy() override: at shutdown the shell destroys actors from C.
            this._changedId = model.connect('changed', () => this._sync());
            // Hidden on the lock screen, back on unlock.
            this._sessionModeId = Main.sessionMode.connect('updated', () => this._sync());
            this.connect('destroy', () => {
                model.disconnect(this._changedId);
                Main.sessionMode.disconnect(this._sessionModeId);
            });
            this._sync();
        }

        _sync() {
            const lit = this._model.lit;
            this.visible = this._model.visible && Main.sessionMode.currentMode !== 'unlock-dialog';
            this.checked = lit;
            this.subtitle = this._model.subtitle;
            this.accessible_name = this._model.accessibleName;
            // The menu button gets the same name as the toggle: it opens that toggle's menu.
            this.menuButtonAccessibleName = this._model.accessibleName;
            this.gicon = lit ? this.preserveIcon : this.maximizeIcon;
            this.preserveItem.setOrnament(lit ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            this.maximizeItem.setOrnament(lit ? PopupMenu.Ornament.NONE : PopupMenu.Ornament.CHECK);
        }
    }
);

const BatteryChargingIndicator = GObject.registerClass(
    // eslint-disable-next-line no-shadow -- registerClass names the GType after the class, so the names match.
    class BatteryChargingIndicator extends SystemIndicator {
        constructor(extension, model, strings) {
            super();
            this._toggle = new BatteryChargingToggle(extension, model, strings);
            this.quickSettingsItems.push(this._toggle);

            // Like Power Mode: a top-bar icon while Preserve Battery Health is on.
            const icon = this._addIndicator();
            icon.gicon = this._toggle.preserveIcon;
            const sync = () => {
                icon.visible = this._toggle.visible && this._toggle.checked;
            };
            this._toggle.connect('notify::visible', sync);
            this._toggle.connect('notify::checked', sync);
            sync();
        }
    }
);

// The clock FullBatteryAction takes, on GLib. GLib's timers run on the monotonic clock,
// which stops during suspend; the action measures the wait in wall-clock time.
const glibClock = {
    now: () => GLib.get_real_time() / 1000,
    startTimer: (delayMs, callback) =>
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            callback();
            return GLib.SOURCE_REMOVE;
        }),
    cancelTimer: id => GLib.Source.remove(id),
};

// How many milliseconds a settings minute lasts: BATTERY_CHARGING_MINUTE_MS when set (the
// integration tests set 1000), else a real minute.
function minuteMs() {
    const value = Number.parseInt(GLib.getenv('BATTERY_CHARGING_MINUTE_MS') ?? '', 10);
    return value > 0 ? value : 60000;
}

function readSettings(settings) {
    return {
        action: settings.get_string('full-battery-action'),
        fullWait: settings.get_uint('full-wait'),
        renotifyInterval: settings.get_uint('renotify-interval'),
    };
}

export default class BatteryChargingExtension extends Extension {
    enable() {
        const upower = new UPowerClient();
        const strings = createStrings({_, ngettext, dgettext: Gettext.dgettext});
        const model = new BatteryChargingModel(upower, strings);
        const settings = this.getSettings();
        const fullBattery = new FullBatteryAction(model, strings, glibClock, readSettings(settings), {
            minuteMs: minuteMs(),
        });
        const settingsIds = ['full-battery-action', 'full-wait', 'renotify-interval'].map(key =>
            settings.connect(`changed::${key}`, () => fullBattery.update(readSettings(settings)))
        );
        const teardown = () => {
            settingsIds.forEach(id => settings.disconnect(id));
            fullBattery.destroy();
            model.destroy();
            upower.destroy();
        };
        try {
            this._indicator = new BatteryChargingIndicator(this, model, strings);
        } catch (e) {
            teardown();
            throw e;
        }
        // Cleanup hangs off the actor's destroy signal, not a destroy() override.
        this._indicator.connect('destroy', teardown);
        const failedId = model.connect('failed', (_m, title, body) => Main.notify(title, body));
        const switchedId = fullBattery.connect('switched', (_a, title) => this._notify(strings.batteryCharging, title));
        this._indicator.connect('destroy', () => {
            model.disconnect(failedId);
            fullBattery.disconnect(switchedId);
        });
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    // Posts a button-less notice on the extension's own source, built on demand.
    _notify(sourceTitle, title) {
        if (!this._source) {
            this._source = new MessageTray.Source({title: sourceTitle, icon: bundledIcon(this, PRESERVE_ICON)});
            // The tray destroys a source once its last notification goes.
            this._source.connect('destroy', () => {
                this._source = null;
            });
            Main.messageTray.add(this._source);
        }
        const notification = new MessageTray.Notification({
            source: this._source,
            title,
            urgency: MessageTray.Urgency.NORMAL,
        });
        this._source.addNotification(notification);
    }

    // The extension also runs on the lock screen ("session-modes": ["user", "unlock-dialog"]),
    // so the Full-battery action can fire while locked and its per-charge state (the wait,
    // the Notify cycle) survives a lock. Only the toggle and top-bar icon hide there.
    disable() {
        this._source?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
        this._source = null;
        if (!this._indicator) return;
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
    }
}
