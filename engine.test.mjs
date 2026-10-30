// JavaScript counterpart of DatasetEvaluationTest plus a few engine checks. Run: node --test "extension-tests/*.test.mjs"
// The dataset is what the rules were designed against: the numbers show consistency, not real-world accuracy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDataset } from './cases.mjs';
import { analyze, createInput, parseAmount } from '../chrome-extension/engine/analyzer.js';
import { SOURCES } from '../chrome-extension/engine/catalog.js';
import { SAMPLES } from '../chrome-extension/samples.js';

const run = (text, details) => analyze(createInput(details.source, text, details));
const examples = loadDataset();

for (const e of examples) {
    test(`line ${e.line} [${e.scam ? 'SCAM' : 'SAFE'} ${e.details.source}] ${e.text.slice(0, 57)}`, () => {
        const r = run(e.text, e.details);
        const detail = ` score=${r.score} indicators=${r.indicators.map(i => i.code)}`;
        if (e.scam) {
            assert.notEqual(r.category, 'LOW', 'expected at least MEDIUM risk;' + detail);
            if (e.expectedType) assert.equal(r.scamType, e.expectedType, 'wrong scam pattern;' + detail);
        } else {
            assert.equal(r.category, 'LOW', 'genuine message flagged;' + detail);
        }
    });
}

test('dataset covers every channel with scam and genuine examples', () => {
    assert.ok(examples.length >= 80);
    for (const source of Object.keys(SOURCES)) {
        assert.ok(examples.some(e => e.details.source === source && e.scam), 'no scam example for ' + source);
        assert.ok(examples.some(e => e.details.source === source && !e.scam), 'no genuine example for ' + source);
    }
});

test('every sample analyzes and in-text evidence points at the original text', () => {
    for (const list of Object.values(SAMPLES)) for (const s of list) {
        const r = run(s.text, s.details);
        for (const i of r.indicators) if (i.evidence.start >= 0) {
            assert.ok(i.evidence.end <= s.text.length);
            assert.ok(s.text.substring(i.evidence.start, i.evidence.end).length > 0);
        }
    }
});

test('evidence offsets survive invisible characters and full-width text', () => {
    const text = 'Please sh​are your ＯＴＰ now';
    const r = run(text, { source: 'SMS', senderId: '' });
    const ev = r.indicators.find(i => i.code === 'CREDENTIAL_REQUEST').evidence;
    assert.equal(text.substring(ev.start, ev.end), 'sh​are your ＯＴＰ');
});

test('input validation', () => {
    assert.throws(() => createInput('SMS', '   ', null), /Enter a message/);
    assert.throws(() => createInput('SMS', 'x'.repeat(10_001), null), /longer than/);
    assert.equal(parseAmount('₹ 4,999.50'), '4999.50');
    assert.equal(parseAmount(''), null);
    assert.throws(() => parseAmount('-5'), /as a number/);
});
