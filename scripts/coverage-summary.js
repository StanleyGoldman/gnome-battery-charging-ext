// Turns the unit tests' lcov into the Markdown coverage summary that `make coverage`
// writes, CI puts in the job summary and the PR comment repeats. Pure: the CLI that
// reads the files is scripts/coverage-report.js.

// The PR comment job finds and replaces its earlier comment by this line.
export const MARKER = '<!-- battery-charging-coverage-report -->';

// lcov text -> Map of SF path -> Map of line -> hit count.
function parseLcov(lcov) {
    const files = new Map();
    let current = null;
    for (const line of lcov.split('\n')) {
        if (line.startsWith('SF:')) {
            current = new Map();
            files.set(line.slice(3), current);
        } else if (line.startsWith('DA:') && current) {
            const [number, hits] = line.slice(3).split(',');
            current.set(Number(number), Number(hits));
        }
    }
    return files;
}

// gjs names each file by its copy under the coverage directory, so a source matches by
// its repo-relative path as a suffix.
function linesOf(files, source) {
    for (const [path, lines] of files) {
        if (path.endsWith(`/${source}`)) return lines;
    }
    return null;
}

// `git diff -U0` text -> Map of b-side path -> Set of the lines added or changed.
function parseDiff(diff) {
    const changed = new Map();
    let current = null;
    for (const line of diff.split('\n')) {
        if (line.startsWith('+++ ')) {
            const path = line.slice(4);
            current = path.startsWith('b/') ? new Set() : null;
            if (current) changed.set(path.slice(2), current);
        } else if (line.startsWith('@@') && current) {
            const [, start, count = '1'] = line.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
            for (let n = 0; n < Number(count); n++) current.add(Number(start) + n);
        }
    }
    return changed;
}

// Changed lines in a source gjs never loaded can't be told executable or not, so they're
// counted apart rather than as uncovered.
function changedLines(files, sources, diff) {
    const changed = parseDiff(diff);
    let hit = 0;
    let total = 0;
    let unmeasured = 0;
    const unloaded = [];
    for (const source of sources) {
        const numbers = changed.get(source) ?? new Set();
        const lines = linesOf(files, source);
        if (!lines) {
            if (numbers.size > 0) unloaded.push(`\`${source}\``);
            unmeasured += numbers.size;
            continue;
        }
        for (const number of numbers) {
            if (!lines.has(number)) continue;
            total++;
            if (lines.get(number) > 0) hit++;
        }
    }
    let text;
    if (total > 0) text = `${hit}/${total} covered (${percent(hit, total)}).`;
    else if (unmeasured > 0) text = 'none the unit tests measure.';
    else text = 'no changed source lines.';
    if (unmeasured > 0) {
        const more = total > 0 ? `${unmeasured} more` : `${unmeasured}`;
        text += ` ${more} in sources the unit tests don’t load (${unloaded.join(', ')}), not measured.`;
    }
    return `**Changed lines:** ${text}`;
}

function percent(hit, total) {
    return `${((100 * hit) / total).toFixed(1)}%`;
}

function countHits(lines) {
    let hit = 0;
    for (const hits of lines.values()) if (hits > 0) hit++;
    return hit;
}

export function summarize({lcov, sources, diff = null}) {
    const files = parseLcov(lcov);
    const out = [MARKER, '### Unit-test coverage', '', '| File | Lines | Coverage |', '| --- | ---: | ---: |'];
    let hit = 0;
    let total = 0;
    for (const source of sources) {
        const lines = linesOf(files, source);
        if (!lines) {
            out.push(`| \`${source}\` | — | not loaded by the unit tests |`);
            continue;
        }
        const fileHit = countHits(lines);
        hit += fileHit;
        total += lines.size;
        out.push(`| \`${source}\` | ${fileHit}/${lines.size} | ${percent(fileHit, lines.size)} |`);
    }
    out.push(`| **Total** | **${hit}/${total}** | **${percent(hit, total)}** |`);
    if (diff !== null) out.push('', changedLines(files, sources, diff));
    return `${out.join('\n')}\n`;
}
