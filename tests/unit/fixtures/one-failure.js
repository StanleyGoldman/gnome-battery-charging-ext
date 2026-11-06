// A test file for runner.test.js: one test passes, one fails. Not named *.test.js, so
// `make test` doesn't run it directly.
import {test} from '../harness.js';

test('passes', () => {});

test('fails: with a colon, a comma', () => {
    throw new Error('100% wrong\nsecond line');
});
