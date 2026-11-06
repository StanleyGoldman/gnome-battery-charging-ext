// The test runner itself, run as `make test` runs it, on a fixture with one failing test.
import Gio from 'gi://Gio';

import {assertEqual, test} from './harness.js';

const fixture = 'tests/unit/fixtures/one-failure.js';

//   run(env) -> {status, lines}   env: {NAME: value}, or null to unset NAME
function run(env) {
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDOUT_PIPE});
    for (const [name, value] of Object.entries(env)) {
        if (value === null) launcher.unsetenv(name);
        else launcher.setenv(name, value, true);
    }
    const proc = launcher.spawnv(['gjs', '-m', 'tests/unit/run.js', fixture]);
    const [, stdout] = proc.communicate_utf8(null, null);
    return {status: proc.get_exit_status(), lines: stdout.trimEnd().split('\n')};
}

test('runner: local output has no annotations', () => {
    const {status, lines} = run({GITHUB_ACTIONS: null});
    assertEqual(status, 1, 'exit status');
    assertEqual(
        lines,
        ['ok    passes', 'FAIL  fails: with a colon, a comma', '      100% wrong', 'second line', '', '1/2 passed'],
        'output'
    );
});

test('runner: under GitHub Actions, a failing test also prints an escaped ::error', () => {
    const {status, lines} = run({GITHUB_ACTIONS: 'true'});
    assertEqual(status, 1, 'exit status');
    assertEqual(
        lines.filter(line => line.startsWith('::')),
        ['::error title=fails%3A with a colon%2C a comma::100%25 wrong%0Asecond line'],
        'annotations'
    );
});
