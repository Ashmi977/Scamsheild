// Analysis history in chrome.storage.local. Only the channel, score, risk level, pattern and indicator
// titles are kept: never the message text or evidence snippets.
import { SCAM_TYPES, SOURCES } from './engine/catalog.js';

const KEY = 'history';
const MAX_ITEMS = 500;

const memory = {};
const area = globalThis.chrome?.storage?.local ?? {
    async get(key) { return { [key]: memory[key] }; },
    async set(values) { Object.assign(memory, values); },
};

export async function loadHistory() {
    const { [KEY]: items } = await area.get(KEY);
    return Array.isArray(items) ? items : [];
}

export async function saveResult(result) {
    const items = await loadHistory();
    const id = items.reduce((max, i) => Math.max(max, i.id), 0) + 1;
    items.unshift({
        id, at: new Date().toISOString(), source: result.source, score: result.score, category: result.category,
        scamType: result.scamType, indicators: result.indicators.map(i => i.title).join(' | '),
    });
    await area.set({ [KEY]: items.slice(0, MAX_ITEMS) });
}

export async function clearHistory() { await area.set({ [KEY]: [] }); }

/** Neutralizes cells that a spreadsheet would run as a formula, then quotes them. */
function csvCell(value) {
    let s = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
}

export function toCsv(items) {
    const rows = [['ID', 'When', 'Channel', 'Score', 'Risk', 'Likely pattern', 'Indicators']];
    for (const i of items) {
        rows.push([i.id, new Date(i.at).toLocaleString(), SOURCES[i.source]?.name ?? i.source, i.score, i.category,
            SCAM_TYPES[i.scamType] ?? i.scamType, i.indicators]);
    }
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
