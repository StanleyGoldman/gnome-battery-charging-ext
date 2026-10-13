import {test, assertEqual} from './harness.js';

import {createStrings, stripMnemonic} from '../../src/strings.js';

test('stripMnemonic removes an inline underscore', () => {
    assertEqual(stripMnemonic('Batterie_gesundheit erhalten'), 'Batteriegesundheit erhalten');
    assertEqual(stripMnemonic('_Maximize Charge'), 'Maximize Charge');
});

test('stripMnemonic removes a trailing (_X), with the space before it', () => {
    assertEqual(stripMnemonic('最大充電(_M)'), '最大充電');
    assertEqual(stripMnemonic('Maximize Charge (_M)'), 'Maximize Charge');
    assertEqual(stripMnemonic('バッテリーを長持ちさせる (_H)'), 'バッテリーを長持ちさせる');
});

test('stripMnemonic keeps a doubled underscore as one literal underscore', () => {
    assertEqual(stripMnemonic('a__b'), 'a_b');
});

test('stripMnemonic leaves text without a mnemonic alone', () => {
    assertEqual(stripMnemonic('Preserve Battery Health'), 'Preserve Battery Health');
});

// A translator that marks what it was asked for: _('x') -> 'x', and a log of the
// borrowed lookups.
function strings({translate = s => s, ngettext, dgettext} = {}) {
    const lookups = [];
    const made = createStrings({
        _: translate,
        ngettext: ngettext ?? ((one, many, n) => n === 1 ? one : many),
        dgettext: dgettext ?? ((domain, msgid) => {
            lookups.push([domain, msgid]);
            return msgid;
        }),
    });
    return {made, lookups};
}

test('borrowed strings are looked up in GNOME\'s domains, with the mnemonic in the msgid', () => {
    const {made, lookups} = strings();
    assertEqual([made.batteryCharging, made.maximizeCharge, made.preserveBatteryHealth,
        made.powerSettings], ['Battery Charging', 'Maximize Charge', 'Preserve Battery Health',
        'Power Settings']);
    assertEqual(lookups, [
        ['gnome-control-center-2.0', 'Battery Charging'],
        ['gnome-control-center-2.0', '_Maximize Charge'],
        ['gnome-control-center-2.0', 'Preserve Battery _Health'],
        ['gnome-shell', 'Power Settings'],
    ]);
});

test('a translated mode name has its mnemonic stripped', () => {
    const {made} = strings({dgettext: (_domain, msgid) => ({
        '_Maximize Charge': 'Maximal laden (_M)',
        'Preserve Battery _Health': 'Batterie_gesundheit erhalten',
    })[msgid] ?? msgid});
    assertEqual(made.maximizeCharge, 'Maximal laden');
    assertEqual(made.preserveBatteryHealth, 'Batteriegesundheit erhalten');
});

test('the short labels are our own strings', () => {
    const {made} = strings({translate: s => `<${s}>`});
    assertEqual([made.title, made.shortMaximize, made.shortPreserve],
        ['<Battery>', '<Maximize>', '<Preserve>']);
});

test('modeName picks the borrowed name for the mode', () => {
    const {made} = strings();
    assertEqual(made.modeName(true), 'Preserve Battery Health');
    assertEqual(made.modeName(false), 'Maximize Charge');
    assertEqual(made.shortModeName(true), 'Preserve');
    assertEqual(made.shortModeName(false), 'Maximize');
});

test('the composed strings fill the translator\'s template', () => {
    const {made} = strings({translate: s => ({
        '%s: %s': '%2$s – %1$s',
        'Could not change %s': '%s: Änderung fehlgeschlagen',
    })[s] ?? s});
    assertEqual(made.accessibleName(true), 'Preserve Battery Health – Battery Charging');
    assertEqual(made.failedTitle(), 'Battery Charging: Änderung fehlgeschlagen');
});

test('the failure body names the mode, and the failed batteries when only some failed', () => {
    const {made} = strings();
    assertEqual(made.failedBody(true, []), 'Switching to Preserve Battery Health is not allowed.');
    assertEqual(made.failedBody(false, ['BAT1']),
        'Switching to Maximize Charge is not allowed for one battery (BAT1).');
    assertEqual(made.failedBody(true, ['BAT0', 'BAT1']),
        'Switching to Preserve Battery Health is not allowed for 2 batteries (BAT0, BAT1).');
});

test('the partial failure body goes through ngettext with the failure count', () => {
    const calls = [];
    const {made} = strings({ngettext: (one, many, n) => {
        calls.push(n);
        return n === 1 ? one : many;
    }});
    made.failedBody(true, ['BAT0', 'BAT1', 'BAT2']);
    assertEqual(calls, [3]);
});
test("stripMnemonic handles full-width brackets and trailing space", () => assertEqual(stripMnemonic("最大（_M） "), "最大"));
