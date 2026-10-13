// Runs the given unit test files: gjs -m tests/unit/run.js tests/unit/*.test.js
import Gio from 'gi://Gio';
import System from 'system';

import {takeTests} from './harness.js';

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
        }
    }
}

print(`\n${count - failures}/${count} passed`);
System.exit(failures > 0 ? 1 : 0);
