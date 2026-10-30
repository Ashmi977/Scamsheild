import { GROUPS, RULES, SOURCES } from './engine/catalog.js';
import { applyTheme, DEFAULT_SETTINGS, INLINE_SITES, loadSettings, saveSettings } from './settings.js';
import { clearHistory } from './history.js';

const $ = id => document.getElementById(id);
const TRUSTED_KEYS = ['smsSenders', 'whatsappNumbers', 'upiIds', 'emailDomains', 'linkDomains'];
let settings;

function el(tag, props = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k in n) n[k] = v;
        else n.setAttribute(k, v);
    }
    n.append(...children.filter(c => c != null));
    return n;
}

let savedTimer;
async function persist(message = 'Saved') {
    settings = await saveSettings(settings);
    const badge = $('saved');
    badge.textContent = message;
    badge.classList.add('show');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => badge.classList.remove('show'), 1600);
}

function setStatus(id, text, kind = '') {
    $(id).textContent = text;
    $(id).className = 'status' + (kind ? ' ' + kind : '');
}

// ---------------------------------------------------------------- Inline warnings

async function renderInline() {
    for (const [source, site] of Object.entries(INLINE_SITES)) {
        const granted = await chrome.permissions.contains({ origins: site.origins });
        $('inline' + source).checked = settings.inline[source] && granted;
    }
    $('inlineMinLevel').value = settings.inlineMinLevel;
}

function onInlineToggle(source) {
    const site = INLINE_SITES[source];
    const box = $('inline' + source);
    if (box.checked) {
        // permissions.request must run directly inside the click, before any await.
        chrome.permissions.request({ origins: site.origins }).then(async granted => {
            if (!granted) {
                box.checked = false;
                setStatus('inlineStatus', `Chrome did not grant access to ${site.label}, so inline warnings stay off.`, 'error');
                return;
            }
            settings.inline[source] = true;
            await persist();
            setStatus('inlineStatus', `On for ${site.label}. Open or reload ${site.label} to see badges.`, 'ok');
        });
    } else {
        settings.inline[source] = false;
        persist().then(() => chrome.permissions.remove({ origins: site.origins }))
            .then(() => setStatus('inlineStatus', `Off for ${site.label}. ScamShield no longer has access to it.`));
    }
}

// ---------------------------------------------------------------- Desktop dashboard

function connection(state, title, detail) {
    $('connection').dataset.state = state;
    $('connectionTitle').textContent = title;
    $('connectionDetail').textContent = detail;
}

async function testDashboard() {
    if (!settings.dashboard) { connection('off', 'Off', 'Switch it on to connect.'); return; }
    connection('busy', 'Connecting…', 'Starting the desktop connector.');
    const r = await chrome.runtime.sendMessage({ type: 'scamshield:dashboard-test' });
    if (r.ok) {
        connection('ok', `Connected to ${r.app} desktop ${r.version}`,
            `${r.events} result${r.events === 1 ? '' : 's'} stored in the desktop dashboard.` + (r.pending ? ` ${r.pending} still waiting.` : ''));
    } else {
        connection('error', 'Not connected', r.error + (r.pending ? ` ${r.pending} result(s) are waiting and will be sent once it connects.` : ''));
    }
}

async function syncDashboard() {
    connection('busy', 'Sending history…', 'This takes a moment.');
    const r = await chrome.runtime.sendMessage({ type: 'scamshield:dashboard-sync' });
    if (r.ok) connection('ok', 'History sent', `${r.total} saved analys${r.total === 1 ? 'is' : 'es'} sent. Results already in the dashboard were skipped.`);
    else connection('error', 'Not connected', r.error);
}

function renderDashboard() {
    $('dashboardOn').checked = settings.dashboard;
    $('testDashboard').disabled = $('syncDashboard').disabled = !settings.dashboard;
    if (settings.dashboard) testDashboard(); else connection('off', 'Off', 'Switch it on to connect.');
}

// ---------------------------------------------------------------- Trusted lists

function renderTrusted() {
    for (const key of TRUSTED_KEYS) $('trusted-' + key).value = settings.trusted[key].join('\n');
}

function onTrustedChange(key) {
    settings.trusted[key] = $('trusted-' + key).value.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
    persist().then(() => { $('trusted-' + key).value = settings.trusted[key].join('\n'); });
}

// ---------------------------------------------------------------- Rules

function weightOf(code) { return settings.weights[code] ?? RULES[code].weight; }

function renderRules() {
    const groups = Object.keys(GROUPS).map(group => {
        const rules = Object.values(RULES).filter(r => r.group === group);
        return el('div', { className: 'rule-group', dataset: { group } },
            el('h3', {}, GROUPS[group]),
            ...rules.map(rule => {
                const weight = el('input', { type: 'number', min: 0, max: 100, step: 1, value: weightOf(rule.code), 'aria-label': `Points for ${rule.title}` });
                const toggle = el('input', { type: 'checkbox', role: 'switch', className: 'switch', checked: weightOf(rule.code) > 0, 'aria-label': `Enable ${rule.title}` });
                const row = el('div', { className: 'rule', dataset: { code: rule.code, search: `${rule.title} ${rule.explanation} ${GROUPS[group]} ${rule.channel ? SOURCES[rule.channel].name : ''}`.toLowerCase() } },
                    toggle,
                    el('div', {},
                        el('span', { className: 'title' }, rule.title),
                        rule.channel ? el('span', { className: 'tag' }, SOURCES[rule.channel].name + ' only') : null,
                        el('p', { className: 'desc' }, rule.explanation)),
                    el('div', { className: 'weight' }, weight, el('span', { className: 'default' }, `default ${rule.weight}`)));
                const refresh = () => {
                    const w = weightOf(rule.code);
                    weight.value = w;
                    toggle.checked = w > 0;
                    row.classList.toggle('off', w === 0);
                    row.classList.toggle('changed', w !== rule.weight);
                };
                toggle.addEventListener('change', () => {
                    settings.weights[rule.code] = toggle.checked ? (rule.weight || 10) : 0;
                    persist().then(refresh);
                });
                weight.addEventListener('change', () => {
                    const n = Math.round(Number(weight.value));
                    settings.weights[rule.code] = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : rule.weight;
                    persist().then(refresh);
                });
                refresh();
                return row;
            }));
    });
    $('ruleGroups').replaceChildren(...groups);
}

function filterRules() {
    const q = $('ruleFilter').value.trim().toLowerCase();
    for (const group of $('ruleGroups').children) {
        let any = false;
        for (const row of group.querySelectorAll('.rule')) {
            row.hidden = q !== '' && !row.dataset.search.includes(q);
            any ||= !row.hidden;
        }
        group.hidden = !any;
    }
}

// ---------------------------------------------------------------- Appearance & data

function renderTheme() {
    for (const r of document.querySelectorAll('input[name="theme"]')) r.checked = r.value === settings.theme;
    applyTheme(settings.theme);
}

const confirmTimers = {};
/** Two-step confirmation for destructive buttons instead of a blocking browser dialog. */
function confirmFirst(button, label, action) {
    if (!button.classList.contains('confirm')) {
        button.classList.add('confirm');
        button.dataset.label = button.textContent;
        button.textContent = label;
        confirmTimers[button.id] = setTimeout(() => { button.classList.remove('confirm'); button.textContent = button.dataset.label; }, 4000);
        return;
    }
    clearTimeout(confirmTimers[button.id]);
    button.classList.remove('confirm');
    button.textContent = button.dataset.label;
    action();
}

async function renderAll() {
    renderTheme();
    await renderInline();
    renderDashboard();
    renderTrusted();
    renderRules();
    filterRules();
    $('saveHistory').checked = settings.saveHistory;
}

async function init() {
    settings = await loadSettings();
    if (new URLSearchParams(location.search).has('welcome')) $('welcome').hidden = false;
    $('version').textContent = 'v' + chrome.runtime.getManifest().version;
    await renderAll();

    for (const source of Object.keys(INLINE_SITES)) $('inline' + source).addEventListener('change', () => onInlineToggle(source));
    $('inlineMinLevel').addEventListener('change', () => { settings.inlineMinLevel = $('inlineMinLevel').value; persist(); });
    $('dashboardOn').addEventListener('change', async () => { settings.dashboard = $('dashboardOn').checked; await persist(); renderDashboard(); });
    $('testDashboard').addEventListener('click', testDashboard);
    $('syncDashboard').addEventListener('click', syncDashboard);
    for (const key of TRUSTED_KEYS) $('trusted-' + key).addEventListener('change', () => onTrustedChange(key));
    $('ruleFilter').addEventListener('input', filterRules);
    $('resetRules').addEventListener('click', () => { settings.weights = {}; persist('Rules reset').then(() => { renderRules(); filterRules(); }); });
    for (const r of document.querySelectorAll('input[name="theme"]')) {
        r.addEventListener('change', () => { settings.theme = r.value; applyTheme(r.value); persist(); });
    }
    $('saveHistory').addEventListener('change', () => { settings.saveHistory = $('saveHistory').checked; persist(); });
    $('clearHistory').addEventListener('click', e => confirmFirst(e.currentTarget, 'Click again to delete', async () => {
        await clearHistory();
        setStatus('dataStatus', 'History cleared.', 'ok');
    }));
    $('resetAll').addEventListener('click', e => confirmFirst(e.currentTarget, 'Click again to reset', async () => {
        for (const site of Object.values(INLINE_SITES)) await chrome.permissions.remove({ origins: site.origins }).catch(() => { });
        settings = structuredClone(DEFAULT_SETTINGS);
        await persist('Settings reset');
        await renderAll();
        setStatus('dataStatus', 'All settings are back to their defaults. History was kept.', 'ok');
    }));
}

init();
