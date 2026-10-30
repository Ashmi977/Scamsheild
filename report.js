// Builds a ready-to-paste fraud report and a short shareable summary from an analysis.
// Nothing is submitted: the user copies the text and files it themselves on the official portals.
import { SCAM_TYPES, SOURCES, UPI_REQUEST_TYPES } from './engine/catalog.js';
import { inText } from './engine/normalized-text.js';

const CATEGORY_LABEL = { LOW: 'Low risk', MEDIUM: 'Medium risk', HIGH: 'High risk', CRITICAL: 'Critical risk' };

const DESTINATIONS = {
    portal: { title: 'National Cyber Crime Reporting Portal', text: 'File a complaint about financial fraud or other cybercrime.', href: 'https://cybercrime.gov.in/', label: 'cybercrime.gov.in' },
    chakshu: { title: 'Chakshu on Sanchar Saathi', text: 'Report suspected fraud SMS, calls and WhatsApp messages so the number can be investigated.', href: 'https://sancharsaathi.gov.in/', label: 'sancharsaathi.gov.in' },
    upi: { title: 'Your UPI app and bank', text: "Decline the request, then use the app's Report / Block option and call your bank's official helpline.", href: null },
    email: { title: 'Your email provider', text: "Use 'Report phishing' in your mail app so similar emails are blocked for others too.", href: null },
};

/**
 * Official places to report, for the message's channel. With no channel (nothing analyzed yet) every
 * destination is listed. The 1930 helpline is shown separately because it applies to every case.
 */
export function reportDestinations(source = null) {
    const d = DESTINATIONS;
    switch (source) {
        case 'SMS': case 'WHATSAPP': return [d.portal, d.chakshu];
        case 'UPI': return [d.portal, d.upi];
        case 'EMAIL': return [d.portal, d.email];
        default: return [d.portal, d.chakshu, d.upi, d.email];
    }
}

function incidentLines(incident = {}) {
    const rows = [
        ['Amount lost', incident.amountLost ? 'Rs ' + incident.amountLost : ''],
        ['Date of payment', incident.date ? new Date(incident.date + 'T00:00').toLocaleDateString('en-IN', { dateStyle: 'medium' }) : ''],
        ['Transaction / UTR ID', incident.transactionId],
        ['Bank or UPI app', incident.paymentApp],
    ].filter(([, v]) => v && String(v).trim());
    const lines = rows.map(([k, v]) => `${k}: ${String(v).trim()}`);
    if (incident.notes?.trim()) lines.push('What happened:', incident.notes.trim());
    return lines;
}

function detailLines(details) {
    switch (details.source) {
        case 'SMS': return [['Sender ID / number', details.senderId]];
        case 'WHATSAPP': return [['Sender number', details.senderNumber], ['Sender saved in contacts', details.unknownContact ? 'No' : ''],
            ['Marked "Forwarded many times"', details.forwardedManyTimes ? 'Yes' : '']];
        case 'UPI': return [['Request type', details.requestType !== 'UNKNOWN' ? UPI_REQUEST_TYPES[details.requestType] : ''],
            ['Payee UPI ID', details.payeeVpa], ['Amount', details.amount ? 'Rs ' + details.amount : '']];
        case 'EMAIL': return [['From', details.fromAddress], ['Subject', details.subject]];
    }
    return [];
}

/**
 * Full plain-text report for a complaint form. `result` and `input` may be null when the user reports
 * without analyzing a message first; then only the incident details are included.
 */
export function buildReport(result, input, { includeMessage = true, checkedAt = new Date(), incident = {} } = {}) {
    const incidentPart = incidentLines(incident);
    if (!result) {
        return ['SUSPECTED FRAUD: REPORT DETAILS', '', `Date of report: ${checkedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
            ...(incidentPart.length ? ['', ...incidentPart] : ['', '(Fill in the incident details, or analyze the message first to add it here.)'])].join('\n');
    }
    const lines = [
        'SUSPECTED FRAUD MESSAGE: REPORT DETAILS',
        '',
        `Date and time checked: ${checkedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
        `Received via: ${SOURCES[result.source].name}`,
        ...detailLines(input.details).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    ];
    if (incidentPart.length) lines.push('', ...incidentPart);
    lines.push('', `Assessment: ${CATEGORY_LABEL[result.category]} (${result.score}/100)` + (result.indicators.length ? `, likely ${SCAM_TYPES[result.scamType]}` : ''));
    if (result.indicators.length > 0) {
        lines.push('Warning signs found:');
        for (const i of result.indicators) {
            const ev = i.evidence.snippet ? (inText(i.evidence) ? ` (text: "${i.evidence.snippet}")` : ` (${i.evidence.snippet})`) : '';
            lines.push(`- ${i.title}${ev}`);
        }
    }
    if (includeMessage) lines.push('', 'Full message as received:', '"""', input.text.trim(), '"""');
    lines.push('', 'Prepared with ScamShield, an offline rule-based checker. The assessment is a warning, not proof. Keep the original message and screenshots as evidence.');
    return lines.join('\n');
}

/** Short text to warn friends or family, without the full message. */
export function buildSummary(result) {
    const top = result.indicators.slice(0, 3).map(i => i.title.replace(/\.$/, ''));
    const advice = result.recommendations.find(a => !a.startsWith('If you have already paid')) ?? result.recommendations[0];
    return [
        `ScamShield check: ${CATEGORY_LABEL[result.category]} (${result.score}/100)` + (result.indicators.length ? ` - looks like ${SCAM_TYPES[result.scamType]}.` : '.'),
        top.length ? `Warning signs: ${top.join('; ')}.` : 'No common scam patterns found, but stay careful.',
        `Advice: ${advice}`,
    ].join('\n');
}
