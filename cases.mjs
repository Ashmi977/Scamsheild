// Builds the shared test corpus: the labelled dataset, the UI samples, and every string literal from
// the Java unit tests (run on all four channels with blank details).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLES } from '../chrome-extension/samples.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATASET = join(root, 'src/test/resources/labelled-messages.txt');
const JAVA_TESTS = join(root, 'src/test/java/com/scamshield/service');

const value = f => (f.trim() === '-' ? '' : f.trim());

/** Parses labelled-messages.txt exactly like the Java LabelledDataset loader. */
export function loadDataset() {
    const examples = [];
    readFileSync(DATASET, 'utf8').split(/\r?\n/).forEach((line, index) => {
        if (line.trim() === '' || line.startsWith('#')) return;
        const parts = splitLimit(line, /\s*\|\s*/, 4);
        if (parts.length !== 4) throw new Error('Malformed dataset line ' + (index + 1));
        const label = parts[0].trim().split(':');
        const source = parts[1].trim();
        const raw = parts[2].trim();
        const f = source === 'EMAIL' ? splitLimit(raw, /,/, 2) : raw.split(',');
        const details = {
            SMS: () => ({ source, senderId: value(raw) }),
            WHATSAPP: () => ({ source, senderNumber: value(f[0]), unknownContact: (f[1] ?? '').includes('u'), forwardedManyTimes: (f[1] ?? '').includes('f') }),
            UPI: () => ({ source, requestType: f[0].trim(), payeeVpa: value(f[1]), amount: value(f[2]) === '' ? null : f[2].trim() }),
            EMAIL: () => ({ source, fromAddress: value(f[0]), subject: f.length > 1 ? value(f[1]) : '' }),
        }[source]();
        examples.push({ line: index + 1, scam: label[0] === 'SCAM', expectedType: label[1] ?? null, text: parts[3].trim(), details });
    });
    return examples;
}

/** String.split with a Java-style limit: the last part keeps the rest of the string. */
function splitLimit(s, re, limit) {
    const out = [];
    const g = new RegExp(re.source, 'g');
    let last = 0, m;
    while (out.length < limit - 1 && (m = g.exec(s))) { out.push(s.substring(last, m.index)); last = m.index + m[0].length; }
    out.push(s.substring(last));
    return out;
}

function javaLiterals() {
    const texts = new Set();
    for (const file of readdirSync(JAVA_TESTS).filter(f => f.endsWith('.java'))) {
        for (const m of readFileSync(join(JAVA_TESTS, file), 'utf8').matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
            try {
                const s = JSON.parse('"' + m[1].replaceAll("\\'", "'") + '"');
                if (s.trim().length >= 12) texts.add(s);
            } catch { /* not a plain literal */ }
        }
    }
    return [...texts];
}

export function allCases() {
    const cases = loadDataset().map(e => ({ text: e.text, details: e.details }));
    for (const list of Object.values(SAMPLES)) for (const s of list) cases.push({ text: s.text, details: s.details });
    for (const text of javaLiterals()) {
        cases.push({ text, details: { source: 'SMS', senderId: '' } });
        cases.push({ text, details: { source: 'WHATSAPP', senderNumber: '', unknownContact: true, forwardedManyTimes: true } });
        cases.push({ text, details: { source: 'UPI', requestType: 'COLLECT_REQUEST', payeeVpa: '', amount: null } });
        cases.push({ text, details: { source: 'EMAIL', fromAddress: '', subject: text.slice(0, 80) } });
    }
    return cases;
}
