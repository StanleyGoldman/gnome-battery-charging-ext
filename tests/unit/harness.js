// A small test harness for `gjs -m`: no GJS test framework is packaged.

const tests = [];

export function test(name, fn) {
    tests.push({name, fn});
}

export function takeTests() {
    return tests.splice(0);
}

function serialize(value) {
    return JSON.stringify(value);
}

export function assertEqual(actual, expected, what = 'value') {
    if (serialize(actual) !== serialize(expected))
        throw new Error(`${what}: expected ${serialize(expected)}, got ${serialize(actual)}`);
}
