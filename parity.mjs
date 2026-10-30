// Compares the JavaScript port against the Java engine on the shared corpus.
// Usage: node extension-tests/parity.mjs   (needs target/scamshield-1.1.0.jar and a JDK)
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { allCases } from './cases.mjs';
import { analyze, createInput } from '../chrome-extension/engine/analyzer.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'java') : 'java';

const esc = s => s.replaceAll('\\', '\\\\').replaceAll('\t', '\\t').replaceAll('\n', '\\n').replaceAll('\r', '\\r');
const outEsc = s => s.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\r', '\\r');

function fields(d) {
    switch (d.source) {
        case 'SMS': return [d.senderId, '', ''];
        case 'WHATSAPP': return [d.senderNumber, (d.unknownContact ? 'u' : '') + (d.forwardedManyTimes ? 'f' : ''), ''];
        case 'UPI': return [d.requestType, d.payeeVpa, d.amount ?? ''];
        case 'EMAIL': return [d.fromAddress, d.subject, ''];
    }
}

function jsLine({ text, details }) {
    try {
        const r = analyze(createInput(details.source, text, details));
        return outEsc([r.score, r.category, r.scamType,
            r.indicators.map(i => [i.code, i.weight, i.group, i.evidence.start + '-' + i.evidence.end, i.evidence.snippet, i.explanation].join(':')).join(' ¦ '),
            r.recommendations.join(' ¦ ')].join('\t'));
    } catch {
        return 'ERROR';
    }
}

const cases = allCases();
const dir = mkdtempSync(join(tmpdir(), 'scamshield-parity-'));
const file = join(dir, 'cases.tsv');
writeFileSync(file, cases.map(c => [c.details.source, ...fields(c.details), c.text].map(esc).join('\t')).join('\n') + '\n', 'utf8');

const javaOut = execFileSync(java, ['-cp', join(root, 'target/scamshield-1.1.0.jar'), join(here, 'Harness.java'), file],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n');

let mismatches = 0;
cases.forEach((c, i) => {
    const js = jsLine(c);
    if (js !== javaOut[i]) {
        mismatches++;
        if (mismatches <= 10) console.log(`MISMATCH #${i} [${c.details.source}] ${c.text.slice(0, 80)}\n  java: ${javaOut[i]}\n  js:   ${js}\n`);
    }
});
console.log(`${cases.length} cases compared, ${mismatches} mismatches.`);
process.exit(mismatches === 0 ? 0 : 1);
