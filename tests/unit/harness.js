// A small test harness for `gjs -m`: no GJS test framework is packaged.

const tests = [];

export function test(name, fn) {
    tests.push({name, fn});
}

export function takeTests() {
    return tests.splice(0);
}

function show(value) {
    return JSON.stringify(value);
}

export function assertEqual(actual, expected, what = 'value') {
    if (show(actual) !== show(expected))
        throw new Error(`${what}: expected ${show(expected)}, got ${show(actual)}`);
}
