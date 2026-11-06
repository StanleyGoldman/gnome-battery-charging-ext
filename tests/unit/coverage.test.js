import {test, assertEqual} from './harness.js';

import {summarize} from '../../scripts/coverage-summary.js';

// gjs writes each source as SF:<coverage dir>/src/<file>, one DA:<line>,<hits> per
// executable line.
const LCOV = `SF:/work/dist/coverage/src/model.js
FNF:0
DA:1,1
DA:2,3
DA:5,0
DA:6,0
LF:4
LH:2
end_of_record
SF:/work/dist/coverage/src/strings.js
DA:1,1
DA:2,1
LF:2
LH:2
end_of_record
`;

function lines(markdown) {
    return markdown.split('\n');
}

function changedSummary(options) {
    return lines(summarize(options)).filter(line => line.startsWith('**Changed lines'));
}

test('summarize opens with the marker the PR comment is found by', () => {
    const summary = summarize({lcov: LCOV, sources: ['src/model.js']});
    assertEqual(lines(summary)[0], '<!-- battery-charging-coverage-report -->');
});

test('summarize tables line coverage per file, then the total', () => {
    const summary = summarize({lcov: LCOV, sources: ['src/model.js', 'src/strings.js']});
    const table = lines(summary).filter(line => line.startsWith('|'));
    assertEqual(table, [
        '| File | Lines | Coverage |',
        '| --- | ---: | ---: |',
        '| `src/model.js` | 2/4 | 50.0% |',
        '| `src/strings.js` | 2/2 | 100.0% |',
        '| **Total** | **4/6** | **66.7%** |',
    ]);
});

test('summarize lists a source the unit tests never load, outside the total', () => {
    const summary = summarize({lcov: LCOV, sources: ['src/extension.js', 'src/strings.js']});
    const table = lines(summary).filter(line => line.startsWith('|'));
    assertEqual(table.slice(2), [
        '| `src/extension.js` | — | not loaded by the unit tests |',
        '| `src/strings.js` | 2/2 | 100.0% |',
        '| **Total** | **2/2** | **100.0%** |',
    ]);
});

// `git diff -U0 <base>`: lines 2-6 of model.js added or changed, line 9 deleted.
const DIFF = `diff --git a/src/model.js b/src/model.js
index 1111111..2222222 100644
--- a/src/model.js
+++ b/src/model.js
@@ -2 +2,5 @@ export function a() {
-    old();
+    one();
+
+    // a comment
+    two();
+    three();
@@ -12 +15,0 @@ export function b() {
-    gone();
`;

test('summarize reports the share of changed executable lines the tests ran', () => {
    // Of lines 2-6, the executable ones are 2 (run), 5 and 6 (not run).
    assertEqual(changedSummary({lcov: LCOV, sources: ['src/model.js'], diff: DIFF}), [
        '**Changed lines:** 1/3 covered (33.3%).',
    ]);
});

test('summarize says so when the change touches no executable source line', () => {
    const docsOnly = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
+new
`;
    for (const diff of ['', docsOnly]) {
        assertEqual(changedSummary({lcov: LCOV, sources: ['src/model.js'], diff}), [
            '**Changed lines:** no changed source lines.',
        ]);
    }
});

test('summarize counts changed lines in unloaded sources apart, as unmeasured', () => {
    const extensionDiff = `diff --git a/src/extension.js b/src/extension.js
--- a/src/extension.js
+++ b/src/extension.js
@@ -10,0 +11,2 @@ class Indicator {
+    a();
+    b();
`;
    const sources = ['src/extension.js', 'src/model.js'];
    assertEqual(changedSummary({lcov: LCOV, sources, diff: DIFF + extensionDiff}), [
        '**Changed lines:** 1/3 covered (33.3%). 2 more in sources the unit tests don’t load (`src/extension.js`), not measured.',
    ]);
    assertEqual(changedSummary({lcov: LCOV, sources, diff: extensionDiff}), [
        '**Changed lines:** none the unit tests measure. 2 in sources the unit tests don’t load (`src/extension.js`), not measured.',
    ]);
});
