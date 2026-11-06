// Prints the Markdown coverage summary (scripts/coverage-summary.js) for `make coverage`.
//
// Usage: gjs -m scripts/print-coverage-summary.js <lcov> [--diff <git diff -U0 file>] <source>...
//   <source>: each extension source, repo-relative (src/model.js), in table order.
//   --diff: the change's diff against its base; adds the changed-lines figure.
import GLib from 'gi://GLib';

import {summarize} from './coverage-summary.js';

function read(path) {
    const [, bytes] = GLib.file_get_contents(path);
    return new TextDecoder().decode(bytes);
}

const [lcovPath, ...rest] = ARGV;
let diff = null;
const sources = [];
for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--diff') diff = read(rest[++i]);
    else sources.push(rest[i]);
}

print(summarize({lcov: read(lcovPath), sources, diff}).trimEnd());
