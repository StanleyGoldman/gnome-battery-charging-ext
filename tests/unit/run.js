// Runs the given unit test files: gjs -m tests/unit/run.js tests/unit/*.test.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import {takeTests} from './harness.js';

// Under GitHub Actions, each failure is also an ::error annotation on the run.
const annotate = GLib.getenv('GITHUB_ACTIONS') === 'true';

// GitHub's workflow-command escaping: the message escapes %, CR and LF; a property also : and ,.
function escapeData(text) {
    return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeProperty(text) {
    return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

let failures = 0;
let count = 0;

for (const path of ARGV) {
    // eslint-disable-next-line no-await-in-loop
    await import(Gio.File.new_for_path(path).get_uri());
    for (const {name, fn} of takeTests()) {
        count++;
        try {
            // eslint-disable-next-line no-await-in-loop
            await fn();
            print(`ok    ${name}`);
        } catch (e) {
            failures++;
            print(`FAIL  ${name}\n      ${e.message}`);
            if (annotate) print(`::error title=${escapeProperty(name)}::${escapeData(e.message)}`);
        }
    }
}

print(`\n${count - failures}/${count} passed`);
System.exit(failures > 0 ? 1 : 0);
