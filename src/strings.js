// Every user-visible string, in one place so the menu and the accessible name can't drift.
// No GNOME Shell imports, so it runs under plain `gjs -m` for the unit tests.
//
// Two kinds (docs/spec.md §5):
//   borrowed  looked up in GNOME's own catalogs with dgettext, so the wording matches
//             GNOME Settings in every language. `make pot` must not extract these.
//   ours      go through _() / ngettext(), in this extension's own gettext domain.

const CONTROL_CENTER = 'gnome-control-center-2.0';
const SHELL = 'gnome-shell';

// Settings' mode names carry a mnemonic (keyboard-shortcut) underscore. Translations
// write it two ways: a trailing "(_X)" (common in CJK) or an inline "_" (de:
// "Batterie_gesundheit erhalten"). "__" is a literal underscore.
export function stripMnemonic(text) {
    return text
        .replace(/\s*\(_.\)$/, '')
        .replace(/__|_/g, match => match === '__' ? '_' : '');
}

// Fills %s and %d in order, or %N$s and %N$d by position, which translators may need
// to reorder the arguments.
function format(template, ...args) {
    let next = 0;
    return template.replace(/%(?:(\d+)\$)?[sd]/g, (_match, position) =>
        String(args[position ? position - 1 : next++]));
}

// `_`, `ngettext` and `dgettext` are the shell's translation functions, injected so
// the unit tests can use their own.
export function createStrings({_, ngettext, dgettext}) {
    const borrowed = (domain, msgid) => dgettext(domain, msgid);
    const batteryCharging = borrowed(CONTROL_CENTER, 'Battery Charging');
    const maximizeCharge = stripMnemonic(borrowed(CONTROL_CENTER, '_Maximize Charge'));
    const preserveBatteryHealth = stripMnemonic(
        borrowed(CONTROL_CENTER, 'Preserve Battery _Health'));
    const powerSettings = borrowed(SHELL, 'Power Settings');

    // Only about 10 characters fit in a one-column toggle.
    // Translators: toggle title, at most about 10 characters; "Battery Charging" is the full name.
    const title = _('Battery');
    // Translators: toggle subtitle for the mode that lets the battery charge to full; at most about 10 characters.
    const shortMaximize = _('Maximize');
    // Translators: toggle subtitle for the mode that holds the battery below full to slow its wear; at most about 10 characters.
    const shortPreserve = _('Preserve');

    const modeName = preserve => preserve ? preserveBatteryHealth : maximizeCharge;

    return {
        batteryCharging,
        maximizeCharge,
        preserveBatteryHealth,
        powerSettings,
        title,
        shortMaximize,
        shortPreserve,
        modeName,
        shortModeName: preserve => preserve ? shortPreserve : shortMaximize,

        // Translators: the toggle's accessible name. The first %s is the setting's name
        // ("Battery Charging"), the second its current mode ("Maximize Charge").
        accessibleName: preserve => format(_('%s: %s'), batteryCharging, modeName(preserve)),

        // Translators: notification title. %s is the setting's name ("Battery Charging").
        failedTitle: () => format(_('Could not change %s'), batteryCharging),

        // `failedPaths` is empty when the failure covers every battery, or the only one.
        failedBody(preserve, failedPaths) {
            const mode = modeName(preserve);
            if (failedPaths.length === 0) {
                // Translators: notification body. %s is the mode that was refused ("Maximize Charge").
                return format(_('Switching to %s is not allowed.'), mode);
            }
            const template = ngettext(
                // Translators: notification body when only some batteries refused. %1$s is the
                // mode ("Maximize Charge"), %2$d how many batteries refused, %3$s their names
                // (BAT1, or "BAT0, BAT1"). Singular and plural forms; %2$d may be left out of the singular.
                'Switching to %1$s is not allowed for one battery (%3$s).',
                'Switching to %1$s is not allowed for %2$d batteries (%3$s).',
                failedPaths.length);
            return format(template, mode, failedPaths.length, failedPaths.join(', '));
        },
    };
}
