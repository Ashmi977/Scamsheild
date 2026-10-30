// Tests for the extension-only features: trusted lists, UPI QR codes, settings and the report helper.
// Run: node --test "extension-tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, createInput, defaultWeights } from '../chrome-extension/engine/analyzer.js';
import { normalizeDomain, normalizePhone, normalizeTrusted } from '../chrome-extension/engine/trusted.js';
import { parseUpiLink } from '../chrome-extension/image-check.js';
import { normalizeSettings, weightsFor } from '../chrome-extension/settings.js';
import { buildReport, buildSummary, reportDestinations } from '../chrome-extension/report.js';
import { toCsv } from '../chrome-extension/history.js';

const run = (text, details, trusted, weights = defaultWeights()) =>
    analyze(createInput(details.source, text, details), weights, trusted ? normalizeTrusted(trusted) : undefined);
const codes = r => r.indicators.map(i => i.code);

test('phone and domain normalization', () => {
    for (const v of ['+91 98765 43210', '09876543210', '0091 98765-43210', '9876543210', '919876543210']) assert.equal(normalizePhone(v), '+919876543210');
    assert.equal(normalizeDomain('https://www.Portal.Example.edu/login?x=1'), 'portal.example.edu');
    assert.equal(normalizeDomain('@college.example.edu'), 'college.example.edu');
});

test('trusted SMS sender skips sender checks but still checks the text', () => {
    const text = 'Dear SBI customer, your account will be blocked today. Share the OTP to unblock.';
    const plain = run(text, { source: 'SMS', senderId: '+91 93456 12780' });
    assert.ok(codes(plain).includes('SMS_PHONE_SENDER_BRAND'));
    const trusted = run(text, { source: 'SMS', senderId: '+91 93456 12780' }, { smsSenders: ['9345612780'] });
    assert.ok(!codes(trusted).includes('SMS_PHONE_SENDER_BRAND'));
    assert.ok(codes(trusted).includes('CREDENTIAL_REQUEST'), 'text rules must still run');
    assert.equal(trusted.notes.length, 1);
});

test('trusted SMS header matches with or without prefix and suffix', () => {
    const text = 'HDFC: update KYC now at http://hdfc-kyc.top/verify';
    const r = run(text, { source: 'SMS', senderId: 'VK-HDFCXX-S' }, { smsSenders: ['HDFCXX'] });
    assert.ok(!codes(r).includes('SMS_HEADER_MISMATCH'));
    assert.ok(codes(r).includes('LOOKALIKE_DOMAIN'), 'the link is still checked');
});

test('trusted link domain removes link risks only for that domain and its subdomains', () => {
    const text = 'Your exam form is pending. Click https://portal.college.example.top/pay and https://bit.ly/x to pay the fee.';
    const before = run(text, { source: 'EMAIL', fromAddress: '', subject: '' });
    assert.ok(codes(before).includes('SUSPICIOUS_URL'));
    const after = run(text, { source: 'EMAIL', fromAddress: '', subject: '' }, { linkDomains: ['college.example.top'] });
    assert.ok(!codes(after).includes('SUSPICIOUS_URL'));
    assert.ok(codes(after).includes('SHORT_LINK'), 'other links are still checked');
    assert.match(after.notes[0], /portal\.college\.example\.top/);
});

test('trusted email domain, WhatsApp number and UPI ID', () => {
    const email = run('Please verify your account details at the portal.', { source: 'EMAIL', fromAddress: 'HDFC Bank <alerts@hdfc-secure.com>', subject: '' }, { emailDomains: ['hdfc-secure.com'] });
    assert.ok(!codes(email).includes('EMAIL_LOOKALIKE_DOMAIN'));
    const wa = run('Send Rs 500 to my UPI now please', { source: 'WHATSAPP', senderNumber: '+44 7700 900123', unknownContact: true, forwardedManyTimes: false }, { whatsappNumbers: ['+447700900123'] });
    assert.deepEqual(codes(wa).filter(c => c.startsWith('WA_')), []);
    const upi = run('Dinner share', { source: 'UPI', requestType: 'COLLECT_REQUEST', payeeVpa: 'Rewards.Help@ybl', amount: null }, { upiIds: ['rewards.help@ybl'] });
    assert.ok(!codes(upi).includes('UPI_SUSPICIOUS_VPA'));
});

test('a UPI QR code that promises money is flagged like a disguised collect request', () => {
    const r = run('Cashback reward for you', { source: 'UPI', requestType: 'QR_PAYMENT', payeeVpa: 'cashback.reward@ybl', amount: '2000' });
    assert.ok(codes(r).includes('UPI_COLLECT_DISGUISED'));
    assert.match(r.indicators.find(i => i.code === 'UPI_COLLECT_DISGUISED').explanation, /QR code/);
    assert.notEqual(r.category, 'LOW');
});

test('UPI link parsing', () => {
    assert.deepEqual(parseUpiLink('upi://pay?pa=shop.name@okaxis&pn=Shop%20Name&am=250.00&tn=Order%2012&cu=INR'),
        { mandate: false, vpa: 'shop.name@okaxis', name: 'Shop Name', amount: '250.00', note: 'Order 12' });
    assert.equal(parseUpiLink('UPI://mandate?pa=x@y').mandate, true);
    assert.equal(parseUpiLink('https://example.com'), null);
});

test('settings normalization keeps valid values only', () => {
    const s = normalizeSettings({ theme: 'neon', inline: { WHATSAPP: true, EMAIL: 'yes' }, inlineMinLevel: 'LOW',
        weights: { URGENCY_PRESSURE: 0, PRIZE_OFFER: 18, NOPE: 5, LOAN_OFFER: 500 }, trusted: { upiIds: [' A@B ', ''] } });
    assert.equal(s.theme, 'auto');
    assert.deepEqual(s.inline, { WHATSAPP: true, EMAIL: false });
    assert.equal(s.inlineMinLevel, 'MEDIUM');
    assert.deepEqual(s.weights, { URGENCY_PRESSURE: 0 }, 'defaults, unknown codes and out-of-range values are dropped');
    assert.deepEqual(s.trusted.upiIds, ['a@b']);
    assert.equal(weightsFor(s).URGENCY_PRESSURE, 0);
});

test('a rule switched off in settings no longer fires', () => {
    const text = 'Act now! Last chance to update.';
    assert.ok(codes(run(text, { source: 'SMS', senderId: '' })).includes('URGENCY_PRESSURE'));
    const off = run(text, { source: 'SMS', senderId: '' }, undefined, weightsFor(normalizeSettings({ weights: { URGENCY_PRESSURE: 0 } })));
    assert.ok(!codes(off).includes('URGENCY_PRESSURE'));
});

test('report and summary', () => {
    const details = { source: 'WHATSAPP', senderNumber: '+91 63000 11223', unknownContact: true, forwardedManyTimes: false };
    const text = 'This is Mumbai Police cyber crime branch. A parcel in your name contains drugs. An arrest warrant is issued. Do not tell anyone.';
    const input = createInput('WHATSAPP', text, details);
    const result = analyze(input);
    const report = buildReport(result, input);
    assert.match(report, /Received via: WhatsApp/);
    assert.match(report, /Sender number: \+91 63000 11223/);
    assert.match(report, /Sender saved in contacts: No/);
    assert.ok(report.includes(text));
    assert.ok(!buildReport(result, input, { includeMessage: false }).includes(text));
    assert.match(buildSummary(result), /^ScamShield check: (High|Critical) risk/);
    assert.deepEqual(reportDestinations('WHATSAPP').map(d => d.href), ['https://cybercrime.gov.in/', 'https://sancharsaathi.gov.in/']);
    assert.equal(reportDestinations(null).length, 4, 'with nothing analyzed, every destination is listed');
});

test('report includes incident details, with or without an analysis', () => {
    const incident = { amountLost: '18500', date: '2026-10-26', transactionId: 'UTR 4521 8890 1123', paymentApp: 'PhonePe', notes: 'Caller said he was my son.' };
    const blank = buildReport(null, null, { incident: {} });
    assert.match(blank, /Fill in the incident details/);
    const only = buildReport(null, null, { incident });
    assert.match(only, /Amount lost: Rs 18500/);
    assert.match(only, /Date of payment: 26 Oct 2026/);
    assert.match(only, /Transaction \/ UTR ID: UTR 4521 8890 1123/);
    assert.match(only, /What happened:\nCaller said he was my son\./);
    const input = createInput('SMS', 'Your SBI account will be blocked today, share the OTP now.', null);
    const full = buildReport(analyze(input), input, { incident });
    assert.ok(full.indexOf('Amount lost') < full.indexOf('Assessment:'), 'incident details come before the assessment');
});

test('dashboard events carry summaries only, never message text', async () => {
    const { eventFrom, historyEvents } = await import('../chrome-extension/dashboard.js');
    const text = 'Hi mom, this is my new number. Send Rs 18,500 to this UPI urgently, do not tell dad.';
    const result = run(text, { source: 'WHATSAPP', senderNumber: '+91 70123 45678', unknownContact: true, forwardedManyTimes: false });
    const e = eventFrom(result, 'inline', { id: 'inline-WHATSAPP-abc' });
    assert.deepEqual(Object.keys(e), ['id', 'at', 'origin', 'site', 'source', 'score', 'category', 'scamType', 'indicators']);
    assert.equal(e.site, 'WhatsApp Web');
    assert.ok(!JSON.stringify(e).includes('18,500') && !JSON.stringify(e).includes('mom'), 'no message text or evidence');
    const [h] = historyEvents([{ id: 3, at: '2026-10-27T06:00:00.000Z', source: 'SMS', score: 40, category: 'MEDIUM', scamType: 'KYC_PHISHING', indicators: 'A | B' }]);
    assert.equal(h.id, 'history-3-' + Date.parse('2026-10-27T06:00:00.000Z'));
    assert.equal(h.origin, 'history-sync');
    assert.equal(normalizeSettings({ dashboard: 'yes' }).dashboard, false);
    assert.equal(normalizeSettings({ dashboard: true }).dashboard, true);
});

test('CSV export neutralizes spreadsheet formulas', () => {
    const csv = toCsv([{ id: 1, at: '2026-10-27T10:00:00Z', source: 'SMS', score: 30, category: 'MEDIUM', scamType: 'NONE', indicators: '=HYPERLINK("x")' }]);
    assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
});
