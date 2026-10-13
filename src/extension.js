import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {PACKAGE_VERSION} from 'resource:///org/gnome/shell/misc/config.js';

import {BatteryChargingModel} from './model.js';
import {UPowerClient} from './upower.js';

const SHELL_MAJOR = parseInt(PACKAGE_VERSION.split('.')[0]);

// English for now; translation comes with #24.
const TITLE = 'Battery';
const MENU_HEADER = 'Battery Charging';
const MAXIMIZE_CHARGE = 'Maximize Charge';
const PRESERVE_BATTERY_HEALTH = 'Preserve Battery Health';
const POWER_SETTINGS = 'Power Settings';

const BatteryChargingToggle = GObject.registerClass(
class BatteryChargingToggle extends QuickMenuToggle {
    _init(extension, model) {
        const params = {title: TITLE};
        // 49+ only: an unknown construct property throws on 48.
        if (SHELL_MAJOR >= 49)
            params.menuButtonAccessibleName = model.accessibleName;
        super._init(params);

        this._model = model;
        this.preserveIcon = this._icon(extension, 'battery-preserve-health-symbolic.svg');
        this.maximizeIcon = this._icon(extension, 'battery-maximize-charge-symbolic.svg');

        this.menu.setHeader(this.preserveIcon, MENU_HEADER);
        this._section = new PopupMenu.PopupMenuSection();
        this.maximizeItem = new PopupMenu.PopupImageMenuItem(MAXIMIZE_CHARGE, this.maximizeIcon);
        this.maximizeItem.connect('activate', () => model.switchTo(false));
        this._section.addMenuItem(this.maximizeItem);
        this.preserveItem = new PopupMenu.PopupImageMenuItem(PRESERVE_BATTERY_HEALTH, this.preserveIcon);
        this.preserveItem.connect('activate', () => model.switchTo(true));
        this._section.addMenuItem(this.preserveItem);
        this.menu.addMenuItem(this._section);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addSettingsAction(POWER_SETTINGS, 'gnome-power-panel.desktop');

        // Clicking switches away from what the toggle shows.
        this.connect('clicked', () => model.switchTo(!model.lit));

        // Not a destroy() override: at shutdown the shell destroys actors from C.
        this._changedId = model.connect('changed', () => this._sync());
        this.connect('destroy', () => model.disconnect(this._changedId));
        this._sync();
    }

    _icon(extension, file) {
        return Gio.FileIcon.new(extension.dir.get_child('icons').get_child(file));
    }

    _sync() {
        const lit = this._model.lit;
        this.visible = this._model.visible;
        this.checked = lit;
        this.subtitle = this._model.subtitle;
        this.accessible_name = this._model.accessibleName;
        if (SHELL_MAJOR >= 49)
            this.menuButtonAccessibleName = this._model.accessibleName;
        this.gicon = lit ? this.preserveIcon : this.maximizeIcon;
        this.preserveItem.setOrnament(lit ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        this.maximizeItem.setOrnament(lit ? PopupMenu.Ornament.NONE : PopupMenu.Ornament.CHECK);
    }
});

const BatteryChargingIndicator = GObject.registerClass(
class BatteryChargingIndicator extends SystemIndicator {
    _init(extension, model) {
        super._init();
        this._toggle = new BatteryChargingToggle(extension, model);
        this.quickSettingsItems.push(this._toggle);

        // Like Power Mode, 50+ only: a top-bar icon while Preserve Battery Health is on.
        if (SHELL_MAJOR >= 50) {
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
});

export default class BatteryChargingExtension extends Extension {
    enable() {
        const upower = new UPowerClient();
        const model = new BatteryChargingModel(upower);
        try {
            this._indicator = new BatteryChargingIndicator(this, model);
        } catch (e) {
            model.destroy();
            upower.destroy();
            throw e;
        }
        // Cleanup hangs off the actor's destroy signal, not a destroy() override.
        this._indicator.connect('destroy', () => {
            model.destroy();
            upower.destroy();
        });
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        if (!this._indicator)
            return;
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
    }
}
