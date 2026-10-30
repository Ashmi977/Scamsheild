import { CATEGORIES, GROUPS, MAX_LENGTH, SCAM_TYPES, SOURCES, UPI_REQUEST_TYPES } from './engine/catalog.js';
import { analyze, createInput, parseAmount } from './engine/analyzer.js';
import { inText } from './engine/normalized-text.js';
import { SAMPLES } from './samples.js';
import { clearHistory, loadHistory, saveResult, toCsv } from './history.js';
import { applyTheme, loadSettings, onSettingsChanged, weightsFor } from './settings.js';
import { decodeQr, parseUpiLink, readImage, readText } from './image-check.js';
import { buildReport, buildSummary, reportDestinations } from './report.js';

const $ = id => document.getElementById(id);
const chromeApi = globalThis.chrome?.storage ? globalThis.chrome : null;
const CATEGORY_LABEL = { LOW: 'Low risk', MEDIUM: 'Medium risk', HIGH: 'High risk', CRITICAL: 'Critical risk' };
const isTab = () => document.body.classList.contains('tab');

let source = 'SMS';
let settings;
/** The last analysis shown, for the report and summary buttons. Kept in memory only. */
let last = null;

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key in node) node[key] = value;
        else node.setAttribute(key, value);
    }
    node.append(...children.filter(c => c != null));
    return node;
}

function setStatus(node, text, isError = false) {
    node.textContent = text;
    node.classList.toggle('error', isError);
}

let toastTimer;
function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

async function copy(text, done) {
    try {
        await navigator.clipboard.writeText(text);
        toast(done);
    } catch {
        toast('Copy failed. Select the text and press Ctrl+C.');
    }
}

function download(text, filename, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------- Channel & form

function selectSource(next) {
    source = next;
    for (const b of $('channels').children) b.setAttribute('aria-pressed', String(b.dataset.source === next));
    for (const d of document.querySelectorAll('.details')) d.hidden = d.dataset.source !== next;
    $('channelDescription').textContent = SOURCES[next].description;
    $('samples').replaceChildren(el('option', { value: '' }, `Try a ${SOURCES[next].name} sample…`),
        ...SAMPLES[next].map((s, i) => el('option', { value: String(i) }, s.label)));
    chromeApi?.storage.local.set({ lastSource: next });
}

function readDetails() {
    switch (source) {
        case 'SMS': return { source, senderId: $('smsSender').value };
        case 'WHATSAPP': return { source, senderNumber: $('waNumber').value, unknownContact: $('waUnknown').checked, forwardedManyTimes: $('waForwarded').checked };
        case 'UPI': return { source, requestType: $('upiType').value, payeeVpa: $('upiVpa').value, amount: parseAmount($('upiAmount').value) };
        case 'EMAIL': return { source, fromAddress: $('emailFrom').value, subject: $('emailSubject').value };
    }
}

function writeDetails(d) {
    selectSource(d.source);
    switch (d.source) {
        case 'SMS': $('smsSender').value = d.senderId ?? ''; break;
        case 'WHATSAPP': $('waNumber').value = d.senderNumber ?? ''; $('waUnknown').checked = !!d.unknownContact; $('waForwarded').checked = !!d.forwardedManyTimes; break;
        case 'UPI': $('upiType').value = d.requestType ?? 'UNKNOWN'; $('upiVpa').value = d.payeeVpa ?? ''; $('upiAmount').value = d.amount ?? ''; break;
        case 'EMAIL': $('emailFrom').value = d.fromAddress ?? ''; $('emailSubject').value = d.subject ?? ''; break;
    }
}

function clearForm() {
    for (const id of ['smsSender', 'waNumber', 'upiVpa', 'upiAmount', 'emailFrom', 'emailSubject', 'message']) $(id).value = '';
    $('waUnknown').checked = $('waForwarded').checked = false;
    $('upiType').value = 'UNKNOWN';
    $('samples').value = '';
    updateCounter();
}

function updateCounter() {
    const n = $('message').value.length;
    $('counter').textContent = `${n.toLocaleString('en-IN')} / ${MAX_LENGTH.toLocaleString('en-IN')}`;
    $('counter').classList.toggle('over', n > MAX_LENGTH);
}

// ---------------------------------------------------------------- Analysis

/**
 * @param origin how the check started, for the desktop dashboard: popup, context-menu or image;
 *               null when it repeats a check already counted (an inline badge's "Full analysis")
 */
async function runAnalysis(origin = 'popup') {
    const status = $('status');
    let result, input;
    try {
        input = createInput(source, $('message').value, readDetails());
        result = analyze(input, weightsFor(settings), settings.trusted);
    } catch (e) {
        setStatus(status, e.message, true);
        return;
    }
    last = { result, input, at: new Date() };
    renderResult(result, input.text);
    // Summary only (no message text); the background forwards it only if the desktop dashboard is switched on.
    if (origin && chromeApi) chromeApi.runtime.sendMessage({ type: 'scamshield:record', origin, result }).catch(() => { });
    if (!settings.saveHistory) {
        setStatus(status, 'Analysis complete. History is switched off in Settings, so nothing was saved.');
        return;
    }
    setStatus(status, 'Analysis complete. History stores only the channel, score, risk level, pattern and warning-sign names, never the message.');
    try {
        await saveResult(result);
    } catch (e) {
        setStatus(status, 'Analysis complete, but history could not be saved: ' + e.message, true);
    }
}

function renderResult(r, text) {
    const box = $('result');
    box.hidden = false;
    box.classList.remove('reveal');
    void box.offsetWidth; // restart the reveal animation
    box.classList.add('reveal');
    box.dataset.risk = r.category;
    $('tip').hidden = true;
    drawGauge(r.score, r.category);
    $('category').textContent = CATEGORY_LABEL[r.category];
    $('pattern').textContent = r.indicators.length === 0 ? 'No scam pattern detected'
        : (r.category === 'LOW' ? 'Closest pattern: ' : 'Likely pattern: ') + SCAM_TYPES[r.scamType];

    $('notesCard').hidden = r.notes.length === 0;
    $('notes').replaceChildren(...r.notes.map(n => el('li', {}, n)));
    $('reportDot').hidden = r.category !== 'HIGH' && r.category !== 'CRITICAL';
    $('reportDot').dataset.risk = r.category;

    $('indicatorCount').textContent = String(r.indicators.length);
    $('indicators').replaceChildren(...(r.indicators.length === 0
        ? [el('li', { className: 'empty-note' }, `No scam indicators were detected for this ${SOURCES[r.source].name} message.`)]
        : r.indicators.map(i => el('li', { className: 'indicator' },
            el('div', { className: 'head' }, el('span', { className: 'title' }, i.title), el('span', { className: 'weight', title: 'Points added to the score' }, `+${i.weight}`)),
            el('span', { className: 'group' }, GROUPS[i.group]),
            el('p', {}, i.explanation),
            i.evidence.snippet ? el('p', { className: 'evidence' }, inText(i.evidence) ? `Matched: “${i.evidence.snippet}”` : i.evidence.snippet) : null))));

    renderHighlights(text, r.indicators);
    $('advice').replaceChildren(...r.recommendations.map(a => el('li', {}, a)));
    $('disclaimer').textContent = r.disclaimer;
    if (!isTab()) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Shows the original message with every matched range wrapped in <mark>; overlapping ranges are merged. */
function renderHighlights(text, indicators) {
    const ranges = indicators.filter(i => inText(i.evidence))
        .map(i => ({ start: i.evidence.start, end: i.evidence.end, titles: [i.title] }))
        .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of ranges) {
        const prev = merged.at(-1);
        if (prev && r.start < prev.end) { prev.end = Math.max(prev.end, r.end); prev.titles.push(...r.titles); }
        else merged.push({ ...r });
    }
    $('highlightCard').hidden = merged.length === 0;
    const parts = [];
    let pos = 0;
    for (const r of merged) {
        parts.push(text.substring(pos, r.start), el('mark', { title: r.titles.join('\n') }, text.substring(r.start, r.end)));
        pos = r.end;
    }
    parts.push(text.substring(pos));
    $('highlighted').replaceChildren(...parts);
}

// ---------------------------------------------------------------- Report & summary

/** Incident details typed on the Report tab. Read from the form each time; never stored. */
function readIncident() {
    return { amountLost: $('incAmount').value.trim(), date: $('incDate').value, transactionId: $('incTxn').value.trim(),
        paymentApp: $('incApp').value.trim(), notes: $('incNotes').value };
}

function renderReport() {
    const context = $('reportContext');
    if (last) {
        const { result, at } = last;
        context.dataset.risk = result.category;
        context.replaceChildren(
            el('div', { className: 'ctx-head' },
                el('span', { className: 'pill' }, String(result.score)),
                el('div', {},
                    el('b', {}, `${CATEGORY_LABEL[result.category]} · ${SOURCES[result.source].name}`),
                    el('p', { className: 'hint' }, (result.indicators.length ? SCAM_TYPES[result.scamType] : 'No scam pattern detected')
                        + ` · analyzed ${at.toLocaleTimeString(undefined, { timeStyle: 'short' })}`))),
            el('p', { className: 'hint' }, 'This report is based on your last analysis. ',
                el('a', { href: '#', onclick: e => { e.preventDefault(); showView('analyze'); } }, 'Analyze a different message')));
    } else {
        delete context.dataset.risk;
        context.replaceChildren(
            el('h2', {}, 'Report a scam'),
            el('p', { className: 'hint' }, 'No message analyzed yet. You can still prepare a report from the incident details, or ',
                el('a', { href: '#', onclick: e => { e.preventDefault(); showView('analyze'); } }, 'analyze the message first'),
                ' to add the warning signs and the message text.'));
    }
    $('urgentCard').classList.toggle('strong', !last || last.result.category === 'HIGH' || last.result.category === 'CRITICAL');
    $('destinations').replaceChildren(...reportDestinations(last?.result.source ?? null).map(d => el('li', {},
        el('b', {}, d.title), el('p', {}, d.text),
        d.href ? el('a', { href: d.href, target: '_blank', rel: 'noopener' }, d.label + ' ↗') : null)));
    $('includeMessageRow').hidden = !last;
    $('reportText').value = buildReport(last?.result ?? null, last?.input ?? null,
        { includeMessage: $('includeMessage').checked, checkedAt: last?.at ?? new Date(), incident: readIncident() });
}

// ---------------------------------------------------------------- Gauge

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const CX = 100, CY = 100, R = 80;
const point = (value, radius = R) => {
    const angle = Math.PI - (value / 100) * Math.PI;
    return [CX + radius * Math.cos(angle), CY - radius * Math.sin(angle)];
};
const gaugeParts = {};

/** Semicircular 0-100 gauge with LOW / MEDIUM / HIGH / CRITICAL bands; the needle animates between results. */
function drawGauge(score, category) {
    const g = $('gauge');
    if (!gaugeParts.needle) {
        const ends = [25, 50, 75, 100];
        let start = 0;
        gaugeParts.bands = CATEGORIES.map((cat, i) => {
            const [x1, y1] = point(start + (i ? 0.6 : 0)), [x2, y2] = point(ends[i] - (i < 3 ? 0.6 : 0));
            start = ends[i];
            return svg('path', { d: `M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`, fill: 'none', 'stroke-width': 16, stroke: `var(--${cat.toLowerCase()})` });
        });
        gaugeParts.needle = svg('line', { x1: CX - (R - 36), y1: CY, x2: CX - (R - 11), y2: CY, stroke: 'var(--text)', 'stroke-width': 4, 'stroke-linecap': 'round', class: 'needle' });
        gaugeParts.label = svg('text', { x: CX, y: CY - 4, 'text-anchor': 'middle', class: 'score' });
        const t0 = svg('text', { x: CX - R, y: CY + 15, 'text-anchor': 'middle', class: 'tick' }); t0.textContent = '0';
        const t100 = svg('text', { x: CX + R, y: CY + 15, 'text-anchor': 'middle', class: 'tick' }); t100.textContent = '100';
        g.append(...gaugeParts.bands, gaugeParts.needle, gaugeParts.label, t0, t100);
    }
    g.setAttribute('aria-label', `Risk score ${score} out of 100, ${CATEGORY_LABEL[category]}`);
    CATEGORIES.forEach((cat, i) => gaugeParts.bands[i].setAttribute('opacity', cat === category ? 1 : 0.22));
    requestAnimationFrame(() => { gaugeParts.needle.style.transform = `rotate(${score * 1.8}deg)`; });
    gaugeParts.label.setAttribute('fill', `var(--${category.toLowerCase()})`);
    gaugeParts.label.textContent = String(score);
}

// ---------------------------------------------------------------- Screenshots & QR codes

let thumbUrl = null;

function imageState({ title, hint = '', progress = null, error = false }) {
    $('imageTitle').textContent = title;
    $('imageTitle').style.color = error ? 'var(--danger)' : '';
    $('imageHint').textContent = hint;
    const bar = $('imageProgress');
    bar.hidden = progress === null;
    bar.classList.toggle('indeterminate', progress === 'busy');
    bar.firstElementChild.style.width = typeof progress === 'number' ? `${Math.round(progress * 100)}%` : '';
}

function resetImage() {
    $('imageCard').hidden = true;
    $('qrDetails').hidden = $('qrCallout').hidden = true;
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = null;
}

function showQrDetails(rows) {
    $('qrDetails').replaceChildren(...rows.filter(([, v]) => v).flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
    $('qrDetails').hidden = false;
}

async function handleImage(file) {
    resetImage();
    thumbUrl = URL.createObjectURL(file);
    $('imageThumb').src = thumbUrl;
    $('imageCard').hidden = false;
    $('analyze').disabled = true;
    imageState({ title: 'Looking for a QR code…', progress: 'busy' });
    let bitmap;
    try {
        bitmap = await readImage(file);
        const qr = await decodeQr(bitmap);
        if (qr) { await handleQr(qr); return; }
        imageState({ title: 'Reading text from the image…', hint: 'This takes a few seconds and happens on your device.', progress: 0 });
        const text = await readText(bitmap, p => imageState({ title: 'Reading text from the image…', hint: 'This takes a few seconds and happens on your device.', progress: p }));
        if (text.replace(/\W/g, '').length < 4) {
            imageState({ title: 'No QR code or readable text found', hint: 'Try a sharper screenshot that shows only the message, or type the message instead.', error: true });
            return;
        }
        imageState({ title: 'Text read from the image', hint: 'Check the text below for reading mistakes, and add the sender details above for a better result.' });
        $('message').value = text.slice(0, MAX_LENGTH);
        updateCounter();
        await runAnalysis('image');
    } catch (e) {
        imageState({ title: 'Could not read the image', hint: e.message, error: true });
    } finally {
        bitmap?.close();
        $('analyze').disabled = false;
    }
}

async function handleQr(data) {
    const upi = parseUpiLink(data);
    if (upi) {
        let amount = '';
        try { amount = parseAmount(upi.amount) ?? ''; } catch { /* leave blank */ }
        writeDetails({ source: 'UPI', requestType: upi.mandate ? 'AUTOPAY_MANDATE' : 'QR_PAYMENT', payeeVpa: upi.vpa, amount });
        $('message').value = upi.note || `UPI payment to ${upi.name || upi.vpa || 'an unknown payee'}`;
        imageState({ title: upi.mandate ? 'UPI AutoPay mandate QR code' : 'UPI payment QR code', hint: 'Read from the QR code. Nothing was opened or paid.' });
        showQrDetails([['Payee name', upi.name], ['UPI ID', upi.vpa], ['Amount', amount ? 'Rs ' + amount : 'Not fixed (payer types it)'], ['Note', upi.note]]);
        $('qrCallout').textContent = upi.mandate
            ? 'Approving this mandate lets the payee take money FROM your account repeatedly. Only approve mandates you set up yourself.'
            : 'Paying this code with your UPI PIN sends money FROM your account. A QR code can never be used to receive money, a refund or a prize.';
        $('qrCallout').hidden = false;
    } else if (/^(?:https?:\/\/|www\.)\S+$/i.test(data.trim())) {
        imageState({ title: 'QR code with a link', hint: 'The address was checked offline. The link was not opened.' });
        showQrDetails([['Link', data.trim()]]);
        $('message').value = data.trim();
    } else {
        imageState({ title: 'QR code with text', hint: 'The text inside the QR code is shown in the message box.' });
        $('message').value = data.slice(0, MAX_LENGTH);
    }
    updateCounter();
    await runAnalysis('image');
}

function imageFromClipboard(event) {
    const file = [...(event.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    showView('analyze');
    handleImage(file);
}

// ---------------------------------------------------------------- History view

let historyItems = [];

async function refreshHistory() {
    try {
        historyItems = await loadHistory();
        setStatus($('historyStatus'), '');
    } catch (e) {
        historyItems = [];
        setStatus($('historyStatus'), 'History unavailable: ' + e.message, true);
    }
    $('historyHint').textContent = settings.saveHistory
        ? 'Stored only in this browser. Message text is never saved.'
        : 'Saving is switched off in Settings. Older entries are shown below.';
    renderHistory();
}

function filteredHistory() {
    const fs = $('filterSource').value, fr = $('filterRisk').value;
    return historyItems.filter(i => (!fs || i.source === fs) && (!fr || i.category === fr));
}

function renderHistory() {
    const all = historyItems;
    $('historyTotal').textContent = String(all.length);
    $('historyTotal').title = 'Total analyses';
    const max = Math.max(1, ...CATEGORIES.map(c => all.filter(i => i.category === c).length));
    $('categoryBars').replaceChildren(...CATEGORIES.map(c => {
        const n = all.filter(i => i.category === c).length;
        return el('div', { className: 'bar', dataset: { risk: c } },
            el('span', {}, CATEGORY_LABEL[c].replace(' risk', '')),
            el('span', { className: 'track' }, el('span', { className: 'fill', style: `width:${(n / max) * 100}%` })),
            el('span', { className: 'n' }, String(n)));
    }));
    $('sourceTotals').replaceChildren(...Object.entries(SOURCES).map(([key, s]) =>
        el('span', { className: 'chip' }, `${s.name} `, el('b', {}, String(all.filter(i => i.source === key).length)))));

    const shown = filteredHistory();
    $('historyList').replaceChildren(...shown.map(i => el('li', {},
        el('span', { className: 'pill', dataset: { risk: i.category }, title: CATEGORY_LABEL[i.category] }, String(i.score)),
        el('div', {},
            el('div', { className: 'line1' }, el('strong', {}, SCAM_TYPES[i.scamType] ?? i.scamType),
                el('span', {}, `${SOURCES[i.source]?.name ?? i.source} · ${new Date(i.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`)),
            el('div', { className: 'inds', title: i.indicators }, i.indicators || 'No warning signs')))));
    $('historyEmpty').hidden = shown.length > 0;
    $('historyEmpty').textContent = all.length === 0
        ? 'No analyses yet. Results appear here after you analyze a message.' : 'No analyses match these filters.';
    $('exportCsv').disabled = shown.length === 0;
    $('clearHistory').disabled = all.length === 0;
}

function exportCsv() {
    const rows = filteredHistory();
    if (rows.length === 0) { setStatus($('historyStatus'), 'Nothing to export.'); return; }
    download(toCsv(rows), `scamshield-history-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    setStatus($('historyStatus'), `Exported ${rows.length} row${rows.length === 1 ? '' : 's'}.`);
}

let confirmTimer;
async function onClearHistory() {
    const btn = $('clearHistory');
    if (!btn.classList.contains('confirm')) {
        btn.classList.add('confirm');
        btn.textContent = 'Click again to delete all';
        confirmTimer = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = 'Clear history'; }, 4000);
        return;
    }
    clearTimeout(confirmTimer);
    btn.classList.remove('confirm');
    btn.textContent = 'Clear history';
    try {
        await clearHistory();
        setStatus($('historyStatus'), 'History cleared.');
    } catch (e) {
        setStatus($('historyStatus'), 'Could not clear history: ' + e.message, true);
    }
    await refreshHistory();
}

// ---------------------------------------------------------------- Tabs & startup

const VIEWS = { analyze: ['tabAnalyze', 'viewAnalyze'], history: ['tabHistory', 'viewHistory'], report: ['tabReport', 'viewReport'] };

function showView(name) {
    for (const [view, [tab, panel]] of Object.entries(VIEWS)) {
        $(tab).setAttribute('aria-selected', String(view === name));
        $(panel).hidden = view !== name;
    }
    if (name === 'history') refreshHistory();
    if (name === 'report') renderReport();
    window.scrollTo({ top: 0 });
}

function openFullTab(query = '') {
    if (!chromeApi) return;
    chromeApi.tabs.create({ url: chromeApi.runtime.getURL('popup.html?mode=tab' + query) });
    window.close();
}

function openSettings(event) {
    event?.preventDefault();
    if (!chromeApi) return;
    chromeApi.runtime.openOptionsPage();
    if (!isTab()) window.close(); // the full-tab view stays open
}

async function init() {
    const params = new URLSearchParams(location.search);
    if (params.get('mode') === 'tab') document.body.classList.add('tab');
    settings = await loadSettings();
    applyTheme(settings.theme);
    onSettingsChanged(s => { settings = s; applyTheme(s.theme); });

    $('channels').append(...Object.entries(SOURCES).map(([key, s]) =>
        el('button', { type: 'button', dataset: { source: key }, title: s.description, onclick: () => selectSource(key) }, s.name)));
    $('upiType').append(...Object.entries(UPI_REQUEST_TYPES).map(([k, v]) => el('option', { value: k }, v)));
    $('filterSource').append(el('option', { value: '' }, 'All channels'), ...Object.entries(SOURCES).map(([k, s]) => el('option', { value: k }, s.name)));
    $('filterRisk').append(el('option', { value: '' }, 'All levels'), ...CATEGORIES.map(c => el('option', { value: c }, CATEGORY_LABEL[c])));

    $('form').addEventListener('submit', e => { e.preventDefault(); runAnalysis(); });
    $('message').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runAnalysis(); } });
    $('message').addEventListener('input', updateCounter);
    $('clear').addEventListener('click', () => {
        clearForm();
        resetImage();
        last = null;
        $('reportDot').hidden = true;
        $('result').hidden = true;
        $('tip').hidden = false;
        setStatus($('status'), 'Cleared.');
        $('message').focus();
    });
    $('samples').addEventListener('change', () => {
        const index = $('samples').value;
        const sample = SAMPLES[source][Number(index)];
        if (index === '' || !sample) return;
        clearForm();
        resetImage();
        writeDetails(sample.details);
        $('message').value = sample.text;
        $('samples').value = index;
        updateCounter();
        setStatus($('status'), `Loaded sample: ${sample.label}. Press Analyze.`);
    });

    // Images: choose, paste or drop. In the small popup the file chooser can close the popup, so use a full tab.
    $('chooseImage').addEventListener('click', () => (isTab() || !chromeApi ? $('imageFile').click() : openFullTab('&image=1')));
    if (!isTab() && chromeApi) $('chooseImage').title = 'Opens a full tab where you can choose or drop the image';
    $('imageFile').addEventListener('change', () => { const f = $('imageFile').files[0]; $('imageFile').value = ''; if (f) handleImage(f); });
    $('removeImage').addEventListener('click', resetImage);
    document.addEventListener('paste', imageFromClipboard);
    const form = $('form');
    form.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); form.classList.add('dragging'); } });
    form.addEventListener('dragleave', e => { if (!form.contains(e.relatedTarget)) form.classList.remove('dragging'); });
    form.addEventListener('drop', e => {
        form.classList.remove('dragging');
        const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
        if (!file) return;
        e.preventDefault();
        handleImage(file);
    });

    $('openReport').addEventListener('click', () => showView('report'));
    $('includeMessage').addEventListener('change', renderReport);
    for (const id of ['incAmount', 'incDate', 'incTxn', 'incApp', 'incNotes']) $(id).addEventListener('input', renderReport);
    $('copyReport').addEventListener('click', () => copy($('reportText').value, 'Report copied'));
    $('downloadReport').addEventListener('click', () => download($('reportText').value, `scamshield-report-${new Date().toISOString().slice(0, 10)}.txt`, 'text/plain;charset=utf-8'));
    $('copySummary').addEventListener('click', () => last && copy(buildSummary(last.result), 'Summary copied'));

    $('tabAnalyze').addEventListener('click', () => showView('analyze'));
    $('tabHistory').addEventListener('click', () => showView('history'));
    $('tabReport').addEventListener('click', () => showView('report'));
    $('filterSource').addEventListener('change', renderHistory);
    $('filterRisk').addEventListener('change', renderHistory);
    $('exportCsv').addEventListener('click', exportCsv);
    $('clearHistory').addEventListener('click', onClearHistory);
    $('openTab').addEventListener('click', () => openFullTab());
    $('openSettings').addEventListener('click', openSettings);
    $('tipSettings').addEventListener('click', openSettings);

    const { lastSource } = chromeApi ? await chromeApi.storage.local.get('lastSource') : {};
    selectSource(SOURCES[lastSource] ? lastSource : 'SMS');
    updateCounter();

    // Text sent from the right-click menu or an inline badge: read it once, then remove it from session storage.
    const { pending } = chromeApi?.storage.session ? await chromeApi.storage.session.get('pending') : {};
    if (pending?.text) {
        await chromeApi.storage.session.remove('pending');
        if (pending.details?.source && SOURCES[pending.details.source]) writeDetails(pending.details);
        else if (pending.source) selectSource(pending.source);
        $('message').value = pending.text;
        updateCounter();
        await runAnalysis(pending.via === 'inline' ? null : 'context-menu');
    } else if (params.has('image')) {
        setStatus($('status'), 'Choose a screenshot or QR code, drop it on the form, or paste it with Ctrl+V.');
        $('chooseImage').focus();
    } else {
        $('message').focus();
    }
}

init();
